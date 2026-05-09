/**
 * B7 — Concurrent payment IPN
 * Goal: Ledger consistency under concurrent webhooks (idempotency + double-entry)
 * Method: 100 VUs × 2 min, 5% duplicate transactions
 * Threshold: Ledger debit == credit, zero duplicate ledger entries
 *
 * IMPORTANT: After test, run the SQL verification query printed at the end.
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BENCH_ID = 'b7_payment_concurrent';
const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const errorRate = new Rate('errors');
const duplicatesSent = new Counter('duplicates_sent');
const uniquesSent = new Counter('uniques_sent');

// Pre-generate a pool of transaction IDs; 5% of calls will re-use one from the pool
const TX_POOL_SIZE = 200;
let txPool = [];
for (let i = 0; i < TX_POOL_SIZE; i++) {
  txPool.push(`pool_tx_${Date.now()}_${i}`);
}

export const options = {
  scenarios: {
    ipn_flood: {
      executor: 'constant-vus',
      vus: 100,
      duration: '2m',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<300', 'p(99)<1000'],
    'http_req_failed': ['rate<0.01'],
    'errors': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

export default function () {
  let transactionId;
  const isDuplicate = Math.random() < 0.05;

  if (isDuplicate && txPool.length > 0) {
    // Re-use an existing tx_id to trigger idempotency logic
    transactionId = txPool[randInt(0, Math.min(99, txPool.length - 1))];
    duplicatesSent.add(1);
  } else {
    transactionId = `tx_${__VU}_${__ITER}_${Date.now()}`;
    uniquesSent.add(1);
  }

  const amount = randInt(50000, 2000000);
  const jobId = randInt(1, 100000);
  const gateway = ['vnpay', 'momo', 'zalopay'][randInt(0, 2)];

  const res = http.post(
    `${BASE_URL}/api/v1/payments/webhook`,
    JSON.stringify({
      gateway,
      transaction_id: transactionId,
      job_id: jobId,
      amount,
      status: 'SUCCESS',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        // FIX: Add Idempotency-Key to handle duplicate detection server-side
        'Idempotency-Key': transactionId,
      },
      tags: { type: 'payment_ipn' },
      timeout: '10s',
    },
  );

  let body;
  try { body = JSON.parse(res.body); } catch { body = {}; }

  // FIX: Accept 200 (processed), 409 (idempotent conflict — still a pass)
  const ok = check(res, {
    'status 200 or 409': r => r.status === 200 || r.status === 409,
    'processed or duplicate': () => body.status === 'processed' || body.idempotent === true,
  });
  errorRate.add(!ok);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 999;
  const errRate = data.metrics.http_req_failed?.values?.rate ?? 1;
  const dupsSent = data.metrics.duplicates_sent?.values?.count ?? 0;
  const uniqueCount = data.metrics.uniques_sent?.values?.count ?? 0;

  const summary = {
    benchmark: BENCH_ID,
    pass: null, // Final PASS/FAIL requires SQL verification below
    note: 'Run SQL verification query to confirm ledger consistency',
    thresholds: {
      'p95_ms': { value: p95, threshold: '<300ms', pass: p95 < 300 },
      'error_rate': { value: errRate, threshold: '<1%', pass: errRate < 0.01 },
      'duplicates_sent': { value: dupsSent, threshold: 'informational' },
      'uniques_sent': { value: uniqueCount, threshold: 'informational' },
    },
    sql_verification: `
-- Run this after test to verify ledger consistency (must equal 0):
SELECT
  (SELECT SUM(amount) FROM ledger_entries WHERE entry_type='debit') -
  (SELECT SUM(amount) FROM ledger_entries WHERE entry_type='credit') AS ledger_mismatch_vnd;

-- Check for duplicate ledger entries (must be 0):
SELECT job_id, entry_type, COUNT(*) cnt
FROM ledger_entries
GROUP BY job_id, entry_type
HAVING COUNT(*) > 2;

-- Check payment_ipn_log for duplicate transaction_ids (must be 0):
SELECT gateway, transaction_id, COUNT(*) cnt
FROM payment_ipn_log
GROUP BY gateway, transaction_id
HAVING COUNT(*) > 1;
    `.trim(),
    raw: data.metrics,
  };

  console.log('\n=== B7 Concurrent Payment IPN Result ===');
  console.log(`p95 latency: ${p95.toFixed(2)}ms — ${p95 < 300 ? 'PASS' : 'FAIL'}`);
  console.log(`error rate: ${(errRate * 100).toFixed(3)}% — ${errRate < 0.01 ? 'PASS' : 'FAIL'}`);
  console.log(`Duplicates sent: ${dupsSent}, Uniques sent: ${uniqueCount}`);
  console.log('\n*** MANUAL STEP REQUIRED ***');
  console.log('Run the SQL queries in results/b7_payment_concurrent_summary.json → sql_verification');
  console.log('Criteria 13 (ledger_mismatch = 0) and 14 (no duplicate charges) require SQL verification.');

  return {
    [`results/${BENCH_ID}_summary.json`]: JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(data, null, 2),
  };
}

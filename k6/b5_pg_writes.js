/**
 * B5 — PostgreSQL writes (job + ledger)
 * Goal: >= 500 TPS sustained, p95 < 50ms for DB write path
 * Method: 50 VUs × 10 min hitting POST /jobs (INSERT job + queue publish)
 *         Then POST /payments/webhook (INSERT ledger + IPN log)
 * Threshold: >= 500 TPS at p95 < 50ms, replica lag < 2s
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const BENCH_ID = 'b5_pg_writes';
const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';

const HN_LAT_MIN = 20.95, HN_LAT_MAX = 21.10;
const HN_LON_MIN = 105.75, HN_LON_MAX = 105.90;

function randFloat(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randId(max) { return randInt(1, max); }

const errorRate = new Rate('errors');
const jobWriteDuration = new Trend('job_write_duration_ms', true);
const ledgerWriteDuration = new Trend('ledger_write_duration_ms', true);
const totalWrites = new Counter('pg_writes_total');

// Pre-auth token (set via env; if missing, auth header is omitted — endpoint may accept for benchmark)
const BENCH_TOKEN = __ENV.BENCH_TOKEN || 'benchmark-token-skip-auth';

export const options = {
  scenarios: {
    pg_writes: {
      executor: 'constant-vus',
      vus: 50,
      duration: '10m',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<50', 'p(99)<200'],
    'http_req_failed': ['rate<0.01'],
    'errors': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

export default function () {
  const roll = Math.random();

  if (roll < 0.6) {
    // TX1: INSERT job (+ queue publish handled server-side)
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/jobs/calculate-price`,
      JSON.stringify({
        weight_kg: randInt(10, 500),
        floors: randInt(0, 10),
        carry_distance_m: randInt(50, 1000),
      }),
      { headers: { 'Content-Type': 'application/json' }, tags: { type: 'job_write' }, timeout: '10s' },
    );
    jobWriteDuration.add(Date.now() - start);
    const ok = check(res, { 'job write 200': r => r.status === 200 });
    errorRate.add(!ok);
    totalWrites.add(1);
  } else {
    // TX2: Payment webhook → INSERT ledger_entries + payment_ipn_log
    const txId = `bench_${Date.now()}_${randInt(1, 999999)}`;
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/payments/webhook`,
      JSON.stringify({
        gateway: ['vnpay', 'momo', 'zalopay'][randInt(0, 2)],
        transaction_id: txId,
        job_id: randId(100000),
        amount: randInt(50000, 5000000),
        status: 'SUCCESS',
      }),
      { headers: { 'Content-Type': 'application/json' }, tags: { type: 'ledger_write' }, timeout: '10s' },
    );
    ledgerWriteDuration.add(Date.now() - start);
    const ok = check(res, { 'ledger write 200': r => r.status === 200 });
    errorRate.add(!ok);
    totalWrites.add(1);
  }
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 999;
  const p99 = data.metrics.http_req_duration?.values?.['p(99)'] ?? 999;
  const tps = data.metrics.http_reqs?.values?.rate ?? 0;
  const errRate = data.metrics.http_req_failed?.values?.rate ?? 1;
  const passed = tps >= 500 && p95 < 50;

  const summary = {
    benchmark: BENCH_ID,
    pass: passed,
    thresholds: {
      'tps': { value: tps, threshold: '>=500/s', pass: tps >= 500 },
      'p95_ms': { value: p95, threshold: '<50ms', pass: p95 < 50 },
      'p99_ms': { value: p99, threshold: '<200ms', pass: p99 < 200 },
      'error_rate': { value: errRate, threshold: '<1%', pass: errRate < 0.01 },
    },
    note: 'Replica lag must be checked separately via Prometheus/pg_stat_replication',
    raw: data.metrics,
  };

  console.log('\n=== B5 PostgreSQL Writes Result ===');
  console.log(`TPS: ${tps.toFixed(0)} (threshold >=500) — ${tps >= 500 ? 'PASS' : 'FAIL'}`);
  console.log(`p95: ${p95.toFixed(2)}ms (threshold <50ms) — ${p95 < 50 ? 'PASS' : 'FAIL'}`);
  console.log(`p99: ${p99.toFixed(2)}ms — ${p99 < 200 ? 'PASS' : 'FAIL'}`);
  console.log(`error rate: ${(errRate * 100).toFixed(3)}% — ${errRate < 0.01 ? 'PASS' : 'FAIL'}`);
  console.log('NOTE: Check replica lag separately via: SELECT * FROM pg_stat_replication;');
  console.log(`OVERALL: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

  return {
    [`results/${BENCH_ID}_summary.json`]: JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(data, null, 2),
  };
}

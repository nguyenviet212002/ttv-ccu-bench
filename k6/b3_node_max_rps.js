/**
 * B3 — Node.js single-instance max RPS
 * Goal: Find max sustainable RPS where p95 < 300ms
 * Method: Ramp 100→10,000 RPS over 10 min, sustain peak 3 min
 * Endpoint mix: 60% calculate-price, 25% nearby-workers, 10% accept-job, 5% health
 * Threshold: Sustained >= 5,000 RPS at p95 < 300ms
 *
 * FIX: Increased maxVUs to 5000 from 2000 to allow higher concurrency
 */

import http from 'k6/http';
import { check, group } from 'k6';
import { Rate, Counter } from 'k6/metrics';

const BENCH_ID = 'b3_node_max_rps';
const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';

const HN_LAT_MIN = 20.95, HN_LAT_MAX = 21.10;
const HN_LON_MIN = 105.75, HN_LON_MAX = 105.90;

function randFloat(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const errorRate = new Rate('errors');
const reqCounter = new Counter('total_requests');

// Static bearer token for benchmarks (bypasses OTP flow, set in redis during warmup)
const BENCH_TOKEN = __ENV.BENCH_TOKEN || 'benchmark-token-skip-auth';

export const options = {
  scenarios: {
    ramp_rps: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 1000,
      maxVUs: 5000,  // FIX: Increased from 2000 to 5000 for higher concurrency
      stages: [
        { duration: '2m', target: 1000 },
        { duration: '2m', target: 2000 },
        { duration: '2m', target: 3000 },
        { duration: '2m', target: 5000 },
        { duration: '2m', target: 8000 },
        { duration: '3m', target: 8000 }, // sustain
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<300', 'p(99)<800'],
    'http_req_failed': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

export default function () {
  const roll = Math.random();
  let res;

  if (roll < 0.60) {
    // 60% calculate-price (pure compute, no DB)
    res = http.post(
      `${BASE_URL}/api/v1/jobs/calculate-price`,
      JSON.stringify({ weight_kg: randInt(10, 500), floors: randInt(0, 10), carry_distance_m: randInt(50, 1000) }),
      { headers: { 'Content-Type': 'application/json' }, tags: { type: 'price' }, timeout: '10s' },
    );
  } else if (roll < 0.85) {
    // 25% nearby workers (Redis GEO)
    const lat = randFloat(HN_LAT_MIN, HN_LAT_MAX).toFixed(6);
    const lon = randFloat(HN_LON_MIN, HN_LON_MAX).toFixed(6);
    res = http.get(`${BASE_URL}/api/v1/workers/nearby?lat=${lat}&lon=${lon}`, {
      tags: { type: 'geo' }, timeout: '10s',
    });
  } else if (roll < 0.95) {
    // 10% accept job (DB write)
    const jobId = randInt(1, 10000);
    res = http.post(
      `${BASE_URL}/api/v1/jobs/${jobId}/accept`,
      JSON.stringify({}),
      { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BENCH_TOKEN}` }, tags: { type: 'accept' }, timeout: '10s' },
    );
  } else {
    // 5% health check
    res = http.get(`${BASE_URL}/api/v1/health/snapshot`, { tags: { type: 'health' }, timeout: '5s' });
  }

  const ok = check(res, { 'status not 5xx': r => r.status < 500 });
  errorRate.add(!ok);
  reqCounter.add(1);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 999;
  const p99 = data.metrics.http_req_duration?.values?.['p(99)'] ?? 999;
  const rps = data.metrics.http_reqs?.values?.rate ?? 0;
  const errRate = data.metrics.http_req_failed?.values?.rate ?? 1;
  const passed = p95 < 300 && rps >= 5000;

  const summary = {
    benchmark: BENCH_ID,
    pass: passed,
    thresholds: {
      'p95_ms': { value: p95, threshold: '<300ms', pass: p95 < 300 },
      'p99_ms': { value: p99, threshold: '<800ms', pass: p99 < 800 },
      'peak_rps': { value: rps, threshold: '>=5000/s', pass: rps >= 5000 },
      'error_rate': { value: errRate, threshold: '<1%', pass: errRate < 0.01 },
    },
    raw: data.metrics,
  };

  console.log('\n=== B3 Node.js Max RPS Result ===');
  console.log(`Peak RPS: ${rps.toFixed(0)} (threshold >=5000) — ${rps >= 5000 ? 'PASS' : 'FAIL'}`);
  console.log(`p95: ${p95.toFixed(2)}ms (threshold <300ms) — ${p95 < 300 ? 'PASS' : 'FAIL'}`);
  console.log(`p99: ${p99.toFixed(2)}ms (threshold <800ms) — ${p99 < 800 ? 'PASS' : 'FAIL'}`);
  console.log(`error rate: ${(errRate * 100).toFixed(3)}% — ${errRate < 0.01 ? 'PASS' : 'FAIL'}`);
  console.log(`OVERALL: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

  return {
    [`results/${BENCH_ID}_summary.json`]: JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(data, null, 2),
  };
}
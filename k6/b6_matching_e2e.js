/**
 * B6 — Matching end-to-end
 * Goal: Full pipeline: job creation → GEORADIUS → ranking → response
 * Method: 20 VUs × 3 min, each creates a job at random Hanoi point
 * Threshold: Matching p95 < 2000ms, match success rate > 95%
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BENCH_ID = 'b6_matching_e2e';
const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';

const HN_LAT_MIN = 20.95, HN_LAT_MAX = 21.10;
const HN_LON_MIN = 105.75, HN_LON_MAX = 105.90;

function randFloat(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max)   { return Math.floor(Math.random() * (max - min + 1)) + min; }

const matchingDuration = new Trend('matching_e2e_duration_ms', true);
const matchSuccessRate = new Rate('match_success');
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    matching: {
      executor: 'constant-vus',
      vus: 20,
      duration: '3m',
    },
  },
  thresholds: {
    'matching_e2e_duration_ms': ['p(95)<2000'],
    'match_success': ['rate>0.95'],
    'http_req_failed': ['rate<0.05'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

export default function () {
  const lat = randFloat(HN_LAT_MIN, HN_LAT_MAX);
  const lon = randFloat(HN_LON_MIN, HN_LON_MAX);

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/v1/jobs`,
    JSON.stringify({
      pickup_lat: lat,
      pickup_lon: lon,
      weight_kg: randInt(10, 200),
      floors: randInt(0, 8),
      carry_distance_m: randInt(50, 500),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${__ENV.BENCH_TOKEN || 'benchmark-token-skip-auth'}`,
      },
      tags: { type: 'matching' },
      timeout: '10s',
    },
  );
  const duration = Date.now() - start;
  matchingDuration.add(duration);

  let body;
  try { body = JSON.parse(res.body); } catch { body = {}; }

  const hasWorkers = Array.isArray(body.matched_workers) && body.matched_workers.length > 0;
  const ok = check(res, {
    'status 201 or 200': r => r.status === 201 || r.status === 200,
    'has job_id': r => body.job_id !== undefined,
    'has matched_workers': () => hasWorkers,
  });

  matchSuccessRate.add(hasWorkers);
  errorRate.add(!ok);
}

export function handleSummary(data) {
  const p95 = data.metrics.matching_e2e_duration_ms?.values?.['p(95)'] ?? 9999;
  const p99 = data.metrics.matching_e2e_duration_ms?.values?.['p(99)'] ?? 9999;
  const successRate = data.metrics.match_success?.values?.rate ?? 0;
  const errRate = data.metrics.http_req_failed?.values?.rate ?? 1;
  const passed = p95 < 2000 && successRate > 0.95;

  const summary = {
    benchmark: BENCH_ID,
    pass: passed,
    thresholds: {
      'matching_p95_ms': { value: p95, threshold: '<2000ms', pass: p95 < 2000 },
      'matching_p99_ms': { value: p99, threshold: 'informational', pass: true },
      'match_success_rate': { value: successRate, threshold: '>95%', pass: successRate > 0.95 },
      'error_rate': { value: errRate, threshold: '<5%', pass: errRate < 0.05 },
    },
    raw: data.metrics,
  };

  console.log('\n=== B6 Matching E2E Result ===');
  console.log(`Matching p95: ${p95.toFixed(2)}ms (threshold <2000ms) — ${p95 < 2000 ? 'PASS' : 'FAIL'}`);
  console.log(`Match success rate: ${(successRate * 100).toFixed(1)}% (threshold >95%) — ${successRate > 0.95 ? 'PASS' : 'FAIL'}`);
  console.log(`OVERALL: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

  return {
    [`results/${BENCH_ID}_summary.json`]: JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(data, null, 2),
  };
}

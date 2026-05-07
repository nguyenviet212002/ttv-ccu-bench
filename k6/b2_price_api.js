/**
 * B2 — Price API benchmark
 * Goal: Pure-compute pricing endpoint p95 < 100ms, p99 < 200ms
 * Method: 100 VUs × 3 min, ramp-up 30s
 * Threshold: p95 < 100ms, p99 < 200ms, error rate < 0.1%
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const BENCH_ID = 'b2_price_api';
const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';

const errorRate = new Rate('errors');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '3m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<100', 'p(99)<200'],
    'errors': ['rate<0.001'],
    'http_req_failed': ['rate<0.001'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

export default function () {
  const body = JSON.stringify({
    weight_kg: randInt(10, 500),
    floors: randInt(0, 15),
    carry_distance_m: randInt(10, 2000),
  });

  const res = http.post(`${BASE_URL}/api/v1/jobs/calculate-price`, body, {
    headers: { 'Content-Type': 'application/json' },
    tags: { type: 'price' },
    timeout: '5s',
  });

  const ok = check(res, {
    'status 200': r => r.status === 200,
    'has total_vnd': r => {
      try { return JSON.parse(r.body).total_vnd > 0; } catch { return false; }
    },
  });
  errorRate.add(!ok);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 999;
  const p99 = data.metrics.http_req_duration?.values?.['p(99)'] ?? 999;
  const errRate = data.metrics.http_req_failed?.values?.rate ?? 1;
  const passed = p95 < 100 && p99 < 200 && errRate < 0.001;

  const summary = {
    benchmark: BENCH_ID,
    pass: passed,
    thresholds: {
      'p95_ms': { value: p95, threshold: '<100ms', pass: p95 < 100 },
      'p99_ms': { value: p99, threshold: '<200ms', pass: p99 < 200 },
      'error_rate': { value: errRate, threshold: '<0.1%', pass: errRate < 0.001 },
    },
    raw: data.metrics,
  };

  console.log('\n=== B2 Price API Result ===');
  console.log(`p95: ${p95.toFixed(2)}ms (threshold <100ms) — ${p95 < 100 ? 'PASS' : 'FAIL'}`);
  console.log(`p99: ${p99.toFixed(2)}ms (threshold <200ms) — ${p99 < 200 ? 'PASS' : 'FAIL'}`);
  console.log(`error rate: ${(errRate * 100).toFixed(3)}% (threshold <0.1%) — ${errRate < 0.001 ? 'PASS' : 'FAIL'}`);
  console.log(`OVERALL: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

  return {
    [`results/${BENCH_ID}_summary.json`]: JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(data, null, 2),
  };
}

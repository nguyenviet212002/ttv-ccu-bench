/**
 * B1 — Redis GEO benchmark
 * Goal: GEORADIUS p99 < 10ms with 500k worker points
 * Method: 50 VUs × 5 min hitting GET /workers/nearby with random Hanoi coords
 * Threshold: p99 < 10ms, throughput >= 5000 q/s
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Workload constants from §3
const BENCH_ID = 'b1_redis_geo';
const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';

// Hà Nội bounding box
const HN_LAT_MIN = 20.95, HN_LAT_MAX = 21.10;
const HN_LON_MIN = 105.75, HN_LON_MAX = 105.90;

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

const errorRate = new Rate('errors');
const geoQueryDuration = new Trend('geo_query_duration_ms', true);

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // ramp up
    { duration: '4m30s', target: 50 }, // sustained
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    // Acceptance criteria: GEORADIUS p99 < 10ms
    'geo_query_duration_ms': ['p(99)<10'],
    'http_req_duration': ['p(99)<50'],  // including HTTP overhead
    'errors': ['rate<0.001'],
    'http_req_failed': ['rate<0.001'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'p(99.9)', 'count'],
};

export default function () {
  const lat = randFloat(HN_LAT_MIN, HN_LAT_MAX).toFixed(6);
  const lon = randFloat(HN_LON_MIN, HN_LON_MAX).toFixed(6);

  const startTs = Date.now();
  const res = http.get(`${BASE_URL}/api/v1/workers/nearby?lat=${lat}&lon=${lon}`, {
    tags: { type: 'geo' },
    timeout: '5s',
  });
  const duration = Date.now() - startTs;

  geoQueryDuration.add(duration);

  const ok = check(res, {
    'status 200': r => r.status === 200,
    'returns array': r => {
      try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
    },
  });
  errorRate.add(!ok);
}

export function handleSummary(data) {
  const p99 = data.metrics.geo_query_duration_ms?.values?.['p(99)'] ?? 999;
  const throughput = data.metrics.iterations?.values?.rate ?? 0;
  const passed = p99 < 10 && throughput >= 5000;

  const summary = {
    benchmark: BENCH_ID,
    pass: passed,
    thresholds: {
      'geo_query_p99_ms': { value: p99, threshold: '<10ms', pass: p99 < 10 },
      'throughput_qps': { value: throughput, threshold: '>=5000/s', pass: throughput >= 5000 },
    },
    raw: data.metrics,
  };

  console.log('\n=== B1 Redis GEO Result ===');
  console.log(`geo_query p99: ${p99.toFixed(2)}ms (threshold <10ms) — ${p99 < 10 ? 'PASS' : 'FAIL'}`);
  console.log(`throughput: ${throughput.toFixed(0)} q/s (threshold >=5000/s) — ${throughput >= 5000 ? 'PASS' : 'FAIL'}`);
  console.log(`OVERALL: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

  return {
    [`results/${BENCH_ID}_summary.json`]: JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(data, null, 2),
  };
}

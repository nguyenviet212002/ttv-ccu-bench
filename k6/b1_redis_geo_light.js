// B1 lightweight — 10 VUs to diagnose concurrency issue
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';
const HN_LAT_MIN = 20.95, HN_LAT_MAX = 21.10;
const HN_LON_MIN = 105.75, HN_LON_MAX = 105.90;
function r(min, max) { return min + Math.random() * (max - min); }

const geo = new Trend('geo_ms', true);
const err = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '2m',  target: 10 },
    { duration: '10s', target: 0 },
  ],
  thresholds: { 'geo_ms': ['p(99)<50'] },
};

export default function () {
  const lat = r(HN_LAT_MIN, HN_LAT_MAX).toFixed(6);
  const lon = r(HN_LON_MIN, HN_LON_MAX).toFixed(6);
  const t = Date.now();
  const res = http.get(`${BASE_URL}/api/v1/workers/nearby?lat=${lat}&lon=${lon}`,
    { timeout: '10s' });
  geo.add(Date.now() - t);
  err.add(res.status !== 200);
}

export function handleSummary(data) {
  const g = data.metrics.geo_ms?.values;
  console.log('=== B1 Light (10 VUs) ===');
  console.log('p50:', g?.med?.toFixed(1), 'ms');
  console.log('p95:', g?.['p(95)']?.toFixed(1), 'ms');
  console.log('p99:', g?.['p(99)']?.toFixed(1), 'ms');
  console.log('RPS:', data.metrics.iterations?.values?.rate?.toFixed(0));
  return {};
}

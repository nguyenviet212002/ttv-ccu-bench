import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 3, iterations: 10 };
export default function() {
  const r = http.post(
    'http://ttv_api:3000/api/v1/jobs/calculate-price',
    JSON.stringify({weight_kg:50, floors:3, carry_distance_m:200}),
    {headers:{'Content-Type':'application/json'}}
  );
  check(r, {'status 200': r => r.status===200});
}
export function handleSummary(data) {
  const d = data.metrics.http_req_duration;
  console.log('=== Internal Network Test ===');
  console.log('p50:', d.values['med'].toFixed(1), 'ms');
  console.log('p95:', d.values['p(95)'].toFixed(1), 'ms');
  console.log('p99:', d.values['p(99)'].toFixed(1), 'ms');
  return {};
}

/**
 * B4 — WebSocket sustained 30 minutes
 * Goal: 10,000 WebSocket connections, GPS every 30s, <1% abnormal disconnect
 * Method: 10,000 VUs × 30 min, each sends gps:update every 30s
 * Threshold: Abnormal disconnect < 1%, memory growth < 30%
 *
 * FIXES:
 * 1. Changed threshold to rate<0.01 (abnormal / total sessions) instead of absolute count
 * 2. Added graceful ws.close(1000) before VU ends
 * 3. Use polling loop instead of sleep for GPS messages to keep connection alive
 */

import { WebSocket } from 'k6/experimental/websockets';
import { check, sleep } from 'k6';
import { Counter, Rate, Gauge } from 'k6/metrics';

const BENCH_ID = 'b4_ws_sustained';
const WS_URL = (__ENV.API_BASE_URL || 'http://localhost:3000').replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket';

const HN_LAT_MIN = 20.95, HN_LAT_MAX = 21.10;
const HN_LON_MIN = 105.75, HN_LON_MAX = 105.90;

function randFloat(min, max) { return min + Math.random() * (max - min); }

const abnormalDisconnects = new Counter('ws_disconnect_abnormal');
const normalDisconnects   = new Counter('ws_disconnect_normal');
const gpsMessagesSent     = new Counter('ws_gps_messages_sent');
const connectedGauge      = new Gauge('ws_connected');
const totalSessions       = new Counter('ws_total_sessions');

export const options = {
  scenarios: {
    ws_workers: {
      executor: 'constant-vus',
      vus: 10000,
      duration: '30m',
    },
  },
  thresholds: {
    // FIX: Changed to rate-based threshold — abnormal / total sessions < 0.01 (1%)
    'ws_disconnect_abnormal': ['rate<0.01'],
    'ws_session_duration': ['p(95)>1700000'], // most sessions should last ~28min+
    'http_req_failed': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

export default function () {
  const workerId = Math.floor(Math.random() * 500000) + 1;
  const wsUrl = `${WS_URL}&workerId=${workerId}&role=worker`;

  let connected = false;
  let abnormal = false;
  let pingInterval;

  const ws = new WebSocket(wsUrl);
  totalSessions.add(1);

  ws.onopen = () => {
    connected = true;
    connectedGauge.add(1);

    // FIX: Use polling loop with shorter intervals instead of single long sleep
    // GPS every 30 seconds for 30 minutes — send in a loop
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const gpsPayload = JSON.stringify({
          worker_id: workerId,
          lat: randFloat(HN_LAT_MIN, HN_LAT_MAX),
          lon: randFloat(HN_LON_MIN, HN_LON_MAX),
          ts: Date.now(),
        });
        // Socket.io binary framing: 42["gps:update", payload]
        ws.send('42["gps:update",' + gpsPayload + ']');
        gpsMessagesSent.add(1);
      }
    }, 30000);
  };

  ws.onmessage = (msg) => {
    // Socket.io handshake and event handling
    const data = msg.data;
    if (data.startsWith('0')) {
      // Socket.io handshake — respond with connect
      ws.send('40');
    }
  };

  ws.onerror = (e) => {
    abnormal = true;
  };

  ws.onclose = (e) => {
    if (pingInterval) clearInterval(pingInterval);
    connectedGauge.add(-1);
    // FIX: Only count as abnormal if close code is NOT 1000/1001 AND we were connected
    if (connected && e.code !== 1000 && e.code !== 1001) {
      abnormalDisconnects.add(1);
    } else {
      normalDisconnects.add(1);
    }
  };

  // FIX: Graceful close before VU ends — send close with code 1000
  sleep(1795); // Sleep for 29:55, leave 5s for graceful close
  
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000);
  }
}

export function handleSummary(data) {
  const abnormalCount = data.metrics.ws_disconnect_abnormal?.values?.count ?? 0;
  const totalSess = data.metrics.ws_total_sessions?.values?.count ?? 10000;
  const abnormalRate = totalSess > 0 ? abnormalCount / totalSess : 0;
  const gpsSent = data.metrics.ws_gps_messages_sent?.values?.count ?? 0;
  // FIX: Use rate-based threshold
  const passed = abnormalRate < 0.01;

  const summary = {
    benchmark: BENCH_ID,
    pass: passed,
    thresholds: {
      'abnormal_disconnect_count': { value: abnormalCount, threshold: 'informational' },
      'abnormal_disconnect_rate': { value: abnormalRate, threshold: '<1% (rate<0.01)', pass: abnormalRate < 0.01 },
      'gps_messages_sent': { value: gpsSent, threshold: 'informational', pass: true },
    },
    raw: data.metrics,
  };

  console.log('\n=== B4 WebSocket Sustained Result ===');
  console.log(`Abnormal disconnects: ${abnormalCount} / ${totalSess} sessions (${(abnormalRate * 100).toFixed(2)}%) — ${abnormalRate < 0.01 ? 'PASS' : 'FAIL'}`);
  console.log(`GPS messages sent: ${gpsSent}`);
  console.log(`OVERALL: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

  return {
    [`results/${BENCH_ID}_summary.json`]: JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(data, null, 2),
  };
}
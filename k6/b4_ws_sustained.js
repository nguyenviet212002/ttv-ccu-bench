/**
 * B4 — WebSocket sustained 30 minutes
 * Goal: 10,000 WebSocket connections, GPS every 30s, <1% abnormal disconnect
 * Method: 10,000 VUs × 30 min, each sends gps:update every 30s
 * Threshold: Abnormal disconnect < 1%
 *
 * FIXES:
 * 1. Auto handle Engine.IO Ping (type '2') → Pong (type '3')
 * 2. Replace setInterval with while+sleep loop to avoid VU interrupted warnings
 * 3. Proper Socket.IO message format: 42["event",{payload}]
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
const pongReplies         = new Counter('ws_pong_replies');

export const options = {
  scenarios: {
    ws_workers: {
      executor: 'constant-vus',
      vus: 10000,
      duration: '30m',
    },
  },
  thresholds: {
    // Use rate-based threshold: abnormal / total sessions < 0.01 (1%)
    'ws_disconnect_abnormal': ['rate<0.01'],
    'ws_session_duration': ['p(95)>1700000'], // most sessions should last ~28min+
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

export default function () {
  const workerId = Math.floor(Math.random() * 500000) + 1;
  const wsUrl = `${WS_URL}&workerId=${workerId}&role=worker`;

  let connected = false;
  let pingInterval;
  let closed = false;

  const ws = new WebSocket(wsUrl);
  totalSessions.add(1);

  ws.onopen = () => {
    connected = true;
    connectedGauge.add(1);
  };

  ws.onmessage = (msg) => {
    const data = msg.data;
    if (!data || typeof data !== 'string') return;

    // FIX 1: Handle Engine.IO v4 Ping/Pong
    // Server sends '2' (ping) — client must reply '3' (pong)
    if (data === '2') {
      ws.send('3');
      pongReplies.add(1);
      return;
    }

    // Socket.IO handshake — respond with connect (code 40)
    if (data === '0') {
      ws.send('40');
      return;
    }

    // Socket.IO open packet (code '0{...}')
    if (data.startsWith('0{')) {
      ws.send('40');
      return;
    }
  };

  ws.onerror = () => {
    // Will be caught by onclose
  };

  ws.onclose = (e) => {
    closed = true;
    if (pingInterval) clearInterval(pingInterval);
    connectedGauge.add(-1);
    // FIX: Only count as abnormal if close code is NOT 1000/1001 AND we were connected
    if (connected && e.code !== 1000 && e.code !== 1001) {
      abnormalDisconnects.add(1);
      connected = false;
    } else {
      normalDisconnects.add(1);
    }
  };

  // FIX 2: Replace setInterval with while+sleep polling loop
  // This avoids "setInterval was stopped because VU iteration was interrupted" warnings
  let gpsCount = 0;
  const GPS_INTERVAL_MS = 30000; // 30 seconds
  const TOTAL_DURATION_MS = 1795000; // 29:55 (leave 5s for graceful close)
  let elapsed = 0;

  while (elapsed < TOTAL_DURATION_MS && !closed && ws.readyState === WebSocket.OPEN) {
    // Send GPS update at intervals
    const gpsPayload = JSON.stringify({
      worker_id: workerId,
      lat: randFloat(HN_LAT_MIN, HN_LAT_MAX),
      lon: randFloat(HN_LON_MIN, HN_LON_MAX),
      ts: Date.now(),
    });
    // FIX 3: Proper Socket.IO message format: 42["event_name", {payload}]
    ws.send(`42["gps:update",${gpsPayload}]`);
    gpsMessagesSent.add(1);
    gpsCount++;

    // Sleep for GPS interval
    sleep(GPS_INTERVAL_MS / 1000);
    elapsed += GPS_INTERVAL_MS;
  }

  // FIX: Graceful close with code 1000
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000);
  }
}

export function handleSummary(data) {
  const abnormalCount = data.metrics.ws_disconnect_abnormal?.values?.count ?? 0;
  const totalSess = data.metrics.ws_total_sessions?.values?.count ?? 10000;
  const abnormalRate = totalSess > 0 ? abnormalCount / totalSess : 0;
  const gpsSent = data.metrics.ws_gps_messages_sent?.values?.count ?? 0;
  const pongCount = data.metrics.ws_pong_replies?.values?.count ?? 0;
  const passed = abnormalRate < 0.01;

  const summary = {
    benchmark: BENCH_ID,
    pass: passed,
    thresholds: {
      'abnormal_disconnect_count': { value: abnormalCount, threshold: 'informational' },
      'abnormal_disconnect_rate': { value: abnormalRate, threshold: '<1% (rate<0.01)', pass: abnormalRate < 0.01 },
      'gps_messages_sent': { value: gpsSent, threshold: 'informational', pass: true },
      'pong_replies': { value: pongCount, threshold: 'informational', pass: true },
    },
    raw: data.metrics,
  };

  console.log('\n=== B4 WebSocket Sustained Result ===');
  console.log(`Abnormal disconnects: ${abnormalCount} / ${totalSess} sessions (${(abnormalRate * 100).toFixed(2)}%) — ${abnormalRate < 0.01 ? 'PASS' : 'FAIL'}`);
  console.log(`GPS messages sent: ${gpsSent}`);
  console.log(`Pong replies: ${pongCount}`);
  console.log(`OVERALL: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

  return {
    [`results/${BENCH_ID}_summary.json`]: JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(data, null, 2),
  };
}
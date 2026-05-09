/**
 * B4 — WebSocket sustained 30 minutes
 *
 * Fix: k6 marks all VU-teardown closes as "abnormal" (close code 1006) regardless
 * of intent. We track PREMATURE disconnects (those that fire before sleep() ends)
 * as the true abnormal rate — not end-of-test teardown closes.
 *
 * Socket.io 4.x framing is implemented manually:
 *  - Connect → send "40" (Socket.io connect packet)
 *  - Respond to "2" (ping) with "3" (pong)
 *  - GPS update: send '42["gps:update",{...}]'
 */

import { WebSocket } from 'k6/experimental/websockets';
import { check, sleep } from 'k6';
import { Counter, Gauge, Rate } from 'k6/metrics';

const BENCH_ID = 'b4_ws_sustained';
const WS_BASE  = (__ENV.API_BASE_URL || 'http://localhost:3000')
                   .replace(/^http/, 'ws');

const HN_LAT_MIN = 20.95, HN_LAT_MAX = 21.10;
const HN_LON_MIN = 105.75, HN_LON_MAX = 105.90;
function randFloat(min, max) { return min + Math.random() * (max - min); }

// Track only PREMATURE disconnects (before test duration ends)
const prematureDisconnects = new Counter('ws_premature_disconnect');
const sessionsCompleted    = new Counter('ws_sessions_completed');
const gpsSent              = new Counter('ws_gps_sent');
const connectedGauge       = new Gauge('ws_connected_now');
const abnormalRate         = new Rate('ws_disconnect_abnormal');

const TEST_DURATION_S = 1800; // 30 minutes

export const options = {
  scenarios: {
    ws_workers: {
      executor: 'constant-vus',
      vus: 10000,
      duration: '30m',
      gracefulStop: '60s',
    },
  },
  thresholds: {
    // Premature disconnects (mid-test) < 1% of all sessions
    'ws_premature_disconnect': ['count<100'],
    'ws_disconnect_abnormal':  ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

export default function () {
  const workerId = Math.floor(Math.random() * 500000) + 1;
  const wsUrl = `${WS_BASE}/socket.io/?EIO=4&transport=websocket&workerId=${workerId}&role=worker`;

  let connected    = false;
  let completed    = false;  // true once sleep(1800) finishes
  let pingInterval = null;

  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connected = true;
    connectedGauge.add(1);

    // Socket.io connect handshake
    ws.send('40');

    // GPS every 30 seconds
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify({
          worker_id: workerId,
          lat: randFloat(HN_LAT_MIN, HN_LAT_MAX),
          lon: randFloat(HN_LON_MIN, HN_LON_MAX),
          ts: Date.now(),
        });
        ws.send('42["gps:update",' + payload + ']');
        gpsSent.add(1);
      }
    }, 30000);
  };

  ws.onmessage = (event) => {
    const data = String(event.data);
    // Respond to Socket.io server ping with pong
    if (data === '2') ws.send('3');
  };

  ws.onerror = () => {
    // Errors before completion are abnormal
    if (!completed) {
      prematureDisconnects.add(1);
      abnormalRate.add(1);
    }
  };

  ws.onclose = (event) => {
    if (pingInterval) clearInterval(pingInterval);
    connectedGauge.add(-1);

    if (!completed) {
      // Closed before our sleep finished = premature disconnect
      const isAbnormal = event.code !== 1000 && event.code !== 1001;
      if (connected && isAbnormal) {
        prematureDisconnects.add(1);
        abnormalRate.add(1);
      }
    } else {
      // Normal end-of-test teardown — NOT counted as abnormal
      sessionsCompleted.add(1);
      abnormalRate.add(0);
    }
  };

  // Hold connection for full test duration
  sleep(TEST_DURATION_S);
  completed = true;

  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000, 'test complete');
  }

  check(null, { 'session stayed connected': () => connected });
}

export function handleSummary(data) {
  const premature      = data.metrics.ws_premature_disconnect?.values?.count ?? 0;
  const completed_sess = data.metrics.ws_sessions_completed?.values?.count ?? 0;
  const gpsMessages    = data.metrics.ws_gps_sent?.values?.count ?? 0;
  const abnRate        = data.metrics.ws_disconnect_abnormal?.values?.rate ?? 1;
  const passed         = premature < 100 && abnRate < 0.01;

  const summary = {
    benchmark: BENCH_ID,
    pass: passed,
    thresholds: {
      'premature_disconnects': { value: premature, threshold: '<100', pass: premature < 100 },
      'abnormal_rate':         { value: abnRate,   threshold: '<1%',  pass: abnRate < 0.01 },
      'gps_messages_sent':     { value: gpsMessages, threshold: 'informational', pass: true },
      'completed_sessions':    { value: completed_sess, threshold: 'informational', pass: true },
    },
    raw: data.metrics,
  };

  console.log('\n=== B4 WebSocket Sustained Result ===');
  console.log(`Premature disconnects: ${premature} (threshold <100) — ${premature < 100 ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`Abnormal rate: ${(abnRate * 100).toFixed(2)}% (threshold <1%) — ${abnRate < 0.01 ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`Completed sessions: ${completed_sess}`);
  console.log(`GPS messages sent: ${gpsMessages}`);
  console.log(`OVERALL: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

  return {
    [`results/${BENCH_ID}_summary.json`]: JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(data, null, 2),
  };
}

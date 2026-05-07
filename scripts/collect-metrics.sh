#!/usr/bin/env bash
# Collect a snapshot of key Prometheus metrics after benchmark run
set -euo pipefail

PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
RESULTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/results"

mkdir -p "$RESULTS_DIR"

query() {
  local metric="$1"
  curl -sf "${PROMETHEUS_URL}/api/v1/query?query=${metric}" 2>/dev/null \
    | grep -o '"value":\[[^]]*\]' | head -1 | grep -o '[0-9.e+-]*$' || echo "N/A"
}

echo "Collecting Prometheus metrics snapshot..."

REDIS_SESSION_MEM=$(query 'redis_memory_used_bytes{instance="redis-session:6379"}')
REDIS_GEO_MEM=$(query 'redis_memory_used_bytes{instance="redis-geo:6379"}')
API_ACTIVE_CONNS=$(query 'nodejs_active_handles_total')
HTTP_DURATION_P95=$(query 'histogram_quantile(0.95,rate(http_request_duration_ms_bucket[5m]))')

cat > "${RESULTS_DIR}/prometheus_snapshot.json" << EOF
{
  "collected_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "redis_session_memory_bytes": "${REDIS_SESSION_MEM}",
  "redis_geo_memory_bytes": "${REDIS_GEO_MEM}",
  "api_active_handles": "${API_ACTIVE_CONNS}",
  "http_request_p95_ms_last5m": "${HTTP_DURATION_P95}",
  "prometheus_url": "${PROMETHEUS_URL}",
  "note": "For full metrics, open Grafana at http://localhost:3001 (admin/admin)"
}
EOF

echo "Metrics snapshot saved to ${RESULTS_DIR}/prometheus_snapshot.json"
cat "${RESULTS_DIR}/prometheus_snapshot.json"

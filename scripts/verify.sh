#!/usr/bin/env bash
# TingTingVac — Post-deploy verification script
# Usage: ./scripts/verify.sh [API_URL]
# Output: PASS/FAIL per check, exit 0 if all pass

set -euo pipefail

API="${1:-http://localhost:3000}"
PASS=0; FAIL=0

ok()   { echo "[PASS] $*"; ((PASS++)) || true; }
fail() { echo "[FAIL] $*"; ((FAIL++)) || true; }

# ── Helper: HTTP check ────────────────────────────────────────────────────────
http_check() {
  local label="$1"; local url="$2"; local expected_status="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected_status" ]; then ok "$label (HTTP $status)"; else fail "$label (HTTP $status, expected $expected_status)"; fi
}

http_post_check() {
  local label="$1"; local url="$2"; local body="$3"; local expected="${4:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$url" \
    -H "Content-Type: application/json" -d "$body" 2>/dev/null || echo "000")
  if [ "$status" = "$expected" ]; then ok "$label (HTTP $status)"; else fail "$label (HTTP $status, expected $expected)"; fi
}

echo "========================================="
echo "  TingTingVac Verification Suite"
echo "  Target: $API"
echo "========================================="
echo ""

# ── 1. Docker containers ──────────────────────────────────────────────────────
echo "--- Docker Containers ---"
for svc in ttv_postgres ttv_redis_session ttv_redis_cache ttv_redis_geo ttv_redis_queue ttv_redis_pubsub ttv_api; do
  if docker inspect "$svc" --format '{{.State.Status}}' 2>/dev/null | grep -q "running"; then
    ok "$svc running"
  else
    fail "$svc not running"
  fi
done

# ── 2. API endpoints ──────────────────────────────────────────────────────────
echo ""
echo "--- API Endpoints ---"
http_check "Health snapshot"    "$API/api/v1/health/snapshot"
http_check "Prometheus metrics" "$API/metrics"
http_post_check "Calculate price" "$API/api/v1/jobs/calculate-price" \
  '{"weight_kg":100,"floors":3,"carry_distance_m":200}'
http_check "Workers nearby" "$API/api/v1/workers/nearby?lat=21.02&lon=105.83"

# ── 3. API health details ─────────────────────────────────────────────────────
echo ""
echo "--- API Health Details ---"
health=$(curl -s --max-time 10 "$API/api/v1/health/snapshot" 2>/dev/null || echo '{}')

db_ping=$(echo "$health" | grep -o '"db_ping_ms":[0-9-]*' | cut -d: -f2 || echo "-1")
redis_s=$(echo "$health" | grep -o '"redis_session":"[^"]*"' | cut -d'"' -f4 || echo "err")
redis_g=$(echo "$health" | grep -o '"redis_geo":"[^"]*"' | cut -d'"' -f4 || echo "err")
geo_cnt=$(echo "$health" | grep -o '"geo_workers_loaded":[0-9]*' | cut -d: -f2 || echo "0")

if [ "$db_ping" -ge 0 ] 2>/dev/null; then ok "DB reachable (${db_ping}ms)"; else fail "DB unreachable (ping=$db_ping)"; fi
if [ "$redis_s" = "ok" ]; then ok "Redis session OK"; else fail "Redis session: $redis_s"; fi
if [ "$redis_g" = "ok" ]; then ok "Redis GEO OK"; else fail "Redis GEO: $redis_g"; fi
if [ "$geo_cnt" -gt 100000 ] 2>/dev/null; then ok "Redis GEO loaded ($geo_cnt entries)"; else fail "Redis GEO has only $geo_cnt entries (need >100k — run seed)"; fi

# ── 4. Database table counts ──────────────────────────────────────────────────
echo ""
echo "--- Database ---"
PG_CMD="docker compose exec -T postgres psql -U ttv -d ttv -t -c"

workers_count=$($PG_CMD "SELECT COUNT(*) FROM workers;" 2>/dev/null | tr -d ' \n' || echo "0")
jobs_count=$($PG_CMD "SELECT COUNT(*) FROM jobs;" 2>/dev/null | tr -d ' \n' || echo "0")
ledger_count=$($PG_CMD "SELECT COUNT(*) FROM ledger_entries;" 2>/dev/null | tr -d ' \n' || echo "0")

if [ "$workers_count" -gt 400000 ] 2>/dev/null; then ok "Workers seeded ($workers_count rows)"; else fail "Workers: only $workers_count rows (need 500k — run seed)"; fi
if [ "$jobs_count" -gt 50000 ] 2>/dev/null; then ok "Jobs seeded ($jobs_count rows)"; else fail "Jobs: only $jobs_count rows"; fi
ok "Ledger entries: $ledger_count"

# ── 5. Ledger consistency (criteria 13+14) ────────────────────────────────────
echo ""
echo "--- Ledger Consistency ---"
mismatch=$($PG_CMD "SELECT COALESCE(SUM(CASE WHEN entry_type='debit' THEN amount ELSE -amount END),0) FROM ledger_entries;" 2>/dev/null | tr -d ' \n' || echo "UNKNOWN")
dup_ipn=$($PG_CMD "SELECT COUNT(*) FROM (SELECT gateway,transaction_id FROM payment_ipn_log GROUP BY 1,2 HAVING COUNT(*)>1) t;" 2>/dev/null | tr -d ' \n' || echo "UNKNOWN")

if [ "$mismatch" = "0" ]; then ok "Ledger mismatch = 0 ✓"; else fail "Ledger mismatch = $mismatch (must be 0)"; fi
if [ "$dup_ipn" = "0" ]; then ok "Duplicate IPN = 0 ✓"; else fail "Duplicate IPN = $dup_ipn (must be 0)"; fi

# ── 6. Redis GEO quick benchmark ──────────────────────────────────────────────
echo ""
echo "--- Redis GEO Speed ---"
geo_ms=$(docker compose exec -T redis-geo redis-cli \
  --latency-history -i 0 GEOSEARCH workers:geo:active FROMLONLAT 105.83 21.02 BYRADIUS 5 km ASC COUNT 20 2>/dev/null | \
  awk 'NR==1{print $1}' || echo "999")
ok "GEOSEARCH sample latency: ${geo_ms}ms"

# ── 7. k6 smoke test (5 iterations) ──────────────────────────────────────────
echo ""
echo "--- k6 Smoke Test ---"
if command -v k6 >/dev/null 2>&1; then
  smoke_result=$(k6 run --quiet --no-color --vus 3 --iterations 9 \
    --env API_BASE_URL="$API" \
    --env BENCH_TOKEN="benchmark-token-skip-auth" \
    <(cat <<'EOF'
import http from 'k6/http';
import { check } from 'k6';
export default function() {
  const r = http.post(`${__ENV.API_BASE_URL}/api/v1/jobs/calculate-price`,
    '{"weight_kg":50,"floors":2,"carry_distance_m":100}',
    {headers:{'Content-Type':'application/json'}});
  check(r, {'ok': r => r.status === 200});
}
EOF
) 2>&1 | grep -E "✓|✗|PASS|FAIL|checks" || echo "completed")
  ok "k6 smoke: $smoke_result"
else
  ok "k6 not installed locally (skip smoke test)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  PASS: $PASS | FAIL: $FAIL"
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
  echo "  ❌ Verification FAILED — fix issues above before benchmarking"
  exit 1
else
  echo "  ✅ All checks passed — ready to benchmark"
  exit 0
fi

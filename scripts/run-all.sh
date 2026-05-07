#!/usr/bin/env bash
# TingTingVac 5K CCU Benchmark — Full Run Script
# Usage: ./scripts/run-all.sh [--force]
set -euo pipefail

FORCE=${1:-""}
RESULTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/results"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
BENCH_TOKEN="${BENCH_TOKEN:-benchmark-token-skip-auth}"

BENCHMARKS=(
  b1_redis_geo
  b2_price_api
  b3_node_max_rps
  b4_ws_sustained
  b5_pg_writes
  b6_matching_e2e
  b7_payment_concurrent
  b8_full_5k_ccu
)

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[run-all]${NC} $*"; }
warn() { echo -e "${YELLOW}[run-all]${NC} $*"; }
err()  { echo -e "${RED}[run-all]${NC} $*" >&2; }

# ── Step 0: Preflight ────────────────────────────────────────────────────────
log "Preflight checks..."
command -v docker   >/dev/null 2>&1 || { err "docker not found"; exit 1; }
command -v k6       >/dev/null 2>&1 || { err "k6 not found — install from https://k6.io/docs/get-started/installation/"; exit 1; }
command -v node     >/dev/null 2>&1 || { err "node not found"; exit 1; }
command -v psql     >/dev/null 2>&1 || warn "psql not found — schema migration will use docker exec"

mkdir -p "$RESULTS_DIR"

# ── Step 1: Bring up infrastructure ──────────────────────────────────────────
log "Step 1: Starting Docker stack..."
cd "$ROOT_DIR"
docker compose up -d
log "Waiting 15s for services to become healthy..."
sleep 15

# Wait for API to be ready
log "Waiting for API to respond..."
for i in $(seq 1 30); do
  if curl -sf "${API_BASE_URL}/api/v1/health/snapshot" >/dev/null 2>&1; then
    log "API is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    err "API did not become ready after 30 attempts"
    docker compose logs api | tail -50
    exit 1
  fi
  sleep 3
done

# ── Step 2: Run schema migrations ────────────────────────────────────────────
log "Step 2: Running schema migration..."
if docker compose exec -T postgres psql -U ttv -d ttv -f /seed/01_schema.sql 2>&1 | grep -q "ERROR"; then
  warn "Schema migration had errors (may be re-run, checking if tables exist)"
fi
docker compose exec -T postgres psql -U ttv -d ttv -f /seed/02_seed_workers.sql 2>&1 || true
log "Schema migration done"

# ── Step 3: Seed data ─────────────────────────────────────────────────────────
log "Step 3: Seeding data (500k workers + 100k jobs)..."
log "This may take 60-120 seconds..."
DATABASE_URL="postgresql://ttv:ttv_pass@localhost:5432/ttv" \
REDIS_GEO_EXTERNAL_URL="redis://localhost:6381" \
node "$ROOT_DIR/seed/03_seed_jobs.js"
log "Seeding complete"

# ── Step 4: Warmup ────────────────────────────────────────────────────────────
log "Step 4: Warming up API (avoid cold-start in measurements)..."
for i in $(seq 1 10); do
  curl -sf "${API_BASE_URL}/api/v1/health/snapshot" >/dev/null
  curl -sf -X POST "${API_BASE_URL}/api/v1/jobs/calculate-price" \
    -H "Content-Type: application/json" \
    -d '{"weight_kg":50,"floors":2,"carry_distance_m":100}' >/dev/null
done
log "Warmup done"

# ── Step 5: Generate benchmark JWT token ──────────────────────────────────────
# For benchmarks that need auth, generate a long-lived token via OTP flow
log "Step 5: Creating benchmark auth token..."
OTP_RESP=$(curl -sf -X POST "${API_BASE_URL}/api/v1/auth/otp/request" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+84901234567"}' 2>/dev/null || echo '{}')
REQUEST_ID=$(echo "$OTP_RESP" | grep -o '"request_id":"[^"]*"' | cut -d'"' -f4 || true)

if [ -n "$REQUEST_ID" ]; then
  # Get code from DB
  CODE=$(docker compose exec -T postgres psql -U ttv -d ttv -t -c \
    "SELECT code FROM otp_codes WHERE phone='+84901234567' AND consumed=FALSE ORDER BY created_at DESC LIMIT 1;" \
    2>/dev/null | tr -d ' \n' || echo "")

  if [ -n "$CODE" ]; then
    TOKEN_RESP=$(curl -sf -X POST "${API_BASE_URL}/api/v1/auth/otp/verify" \
      -H "Content-Type: application/json" \
      -d "{\"request_id\":\"${REQUEST_ID}\",\"code\":\"${CODE}\"}" 2>/dev/null || echo '{}')
    BENCH_TOKEN=$(echo "$TOKEN_RESP" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4 || echo "benchmark-token-skip-auth")
    log "Auth token obtained"
  fi
fi

export BENCH_TOKEN
export API_BASE_URL

# ── Step 6: Run benchmarks ────────────────────────────────────────────────────
log "Step 6: Running 8 benchmarks..."
echo ""

PASSED=0
FAILED=0
SKIPPED=0

for bench in "${BENCHMARKS[@]}"; do
  SUMMARY_FILE="${RESULTS_DIR}/${bench}_summary.json"

  # Skip if already exists and --force not set
  if [ -f "$SUMMARY_FILE" ] && [ "$FORCE" != "--force" ]; then
    warn "Skipping ${bench} — summary already exists (use --force to re-run)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  log "=== Running ${bench} ==="
  START_TS=$(date +%s)

  if k6 run \
      --summary-export="${SUMMARY_FILE}" \
      --env API_BASE_URL="${API_BASE_URL}" \
      --env BENCH_TOKEN="${BENCH_TOKEN}" \
      "${ROOT_DIR}/k6/${bench}.js" \
      2>&1 | tee "${RESULTS_DIR}/${bench}_stdout.log"; then
    BENCH_PASS=$(grep -o '"pass":[^,}]*' "$SUMMARY_FILE" 2>/dev/null | head -1 | grep -o 'true' || echo "")
    if [ "$BENCH_PASS" = "true" ]; then
      log "${bench}: PASS ✓"
      PASSED=$((PASSED + 1))
    else
      warn "${bench}: FAIL or needs manual check"
      FAILED=$((FAILED + 1))
    fi
  else
    err "${bench}: k6 run failed"
    FAILED=$((FAILED + 1))
  fi

  ELAPSED=$(( $(date +%s) - START_TS ))
  log "${bench} completed in ${ELAPSED}s"

  # Cooldown between benchmarks (except last)
  if [ "$bench" != "b8_full_5k_ccu" ]; then
    log "Cooldown 30s..."
    sleep 30
  fi
done

# ── Step 7: Collect host metrics ──────────────────────────────────────────────
log "Step 7: Collecting Prometheus metrics snapshot..."
"${ROOT_DIR}/scripts/collect-metrics.sh" 2>/dev/null || warn "collect-metrics.sh failed — check manually at http://localhost:9090"

# ── Step 8: B7 SQL verification ───────────────────────────────────────────────
log "Step 8: Running B7 ledger consistency SQL verification..."
LEDGER_MISMATCH=$(docker compose exec -T postgres psql -U ttv -d ttv -t -c \
  "SELECT COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE entry_type='debit'),0) - COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE entry_type='credit'),0);" \
  2>/dev/null | tr -d ' \n' || echo "UNKNOWN")

DUP_LEDGER=$(docker compose exec -T postgres psql -U ttv -d ttv -t -c \
  "SELECT COUNT(*) FROM (SELECT gateway, transaction_id FROM payment_ipn_log GROUP BY gateway, transaction_id HAVING COUNT(*)>1) t;" \
  2>/dev/null | tr -d ' \n' || echo "UNKNOWN")

log "Ledger mismatch (must be 0): ${LEDGER_MISMATCH}"
log "Duplicate IPN entries (must be 0): ${DUP_LEDGER}"

# Save to results
echo "{\"ledger_mismatch\": \"${LEDGER_MISMATCH}\", \"duplicate_ipn\": \"${DUP_LEDGER}\"}" \
  > "${RESULTS_DIR}/b7_sql_verification.json"

# ── Final summary ─────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════"
echo "  TingTingVac 5K CCU Benchmark — Run Complete"
echo "══════════════════════════════════════════════════════"
echo ""
echo "  Benchmarks PASS:   ${PASSED}"
echo "  Benchmarks FAIL:   ${FAILED}"
echo "  Benchmarks SKIP:   ${SKIPPED}"
echo ""
echo "  Ledger mismatch:   ${LEDGER_MISMATCH} (must be 0)"
echo "  Duplicate IPN:     ${DUP_LEDGER} (must be 0)"
echo ""
echo "  Results in: ${RESULTS_DIR}/"
echo ""
echo "  Next step: Fill in RESULTS.md with numbers from results/*.json"
echo "  Then submit RESULTS.md + results/*.json to the client."
echo "══════════════════════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi

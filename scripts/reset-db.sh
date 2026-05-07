#!/usr/bin/env bash
# Reset the benchmark database and Redis data — DESTRUCTIVE
# Usage: ./scripts/reset-db.sh [--confirm]
set -euo pipefail

CONFIRM=${1:-""}

if [ "$CONFIRM" != "--confirm" ]; then
  echo "This will DROP ALL DATA in Postgres and Redis."
  echo "Usage: ./scripts/reset-db.sh --confirm"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Resetting Postgres ==="
docker compose exec -T postgres psql -U ttv -d ttv -c "
  DROP TABLE IF EXISTS audit_log CASCADE;
  DROP TABLE IF EXISTS otp_codes CASCADE;
  DROP TABLE IF EXISTS sos_incidents CASCADE;
  DROP TABLE IF EXISTS payment_ipn_log CASCADE;
  DROP TABLE IF EXISTS ledger_entries CASCADE;
  DROP TABLE IF EXISTS jobs CASCADE;
  DROP TABLE IF EXISTS workers CASCADE;
  DROP TABLE IF EXISTS users CASCADE;
"
docker compose exec -T postgres psql -U ttv -d ttv -f /seed/01_schema.sql
echo "Postgres reset done"

echo "=== Resetting Redis ==="
docker compose exec -T redis-session redis-cli FLUSHALL
docker compose exec -T redis-cache redis-cli FLUSHALL
docker compose exec -T redis-geo redis-cli FLUSHALL
docker compose exec -T redis-queue redis-cli FLUSHALL
docker compose exec -T redis-pubsub redis-cli FLUSHALL
echo "Redis reset done"

echo "=== Clearing results ==="
rm -f "${ROOT_DIR}/results/"*.json "${ROOT_DIR}/results/"*.log
echo "Results cleared"

echo ""
echo "Reset complete. Run ./scripts/run-all.sh to start fresh."

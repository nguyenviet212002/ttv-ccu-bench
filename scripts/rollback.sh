#!/usr/bin/env bash
# TingTingVac — Rollback benchmark tuning to production-safe settings
# Usage: ./scripts/rollback.sh
# Run this AFTER benchmarking to restore safe production config

set -euo pipefail

log() { echo "[rollback] $*"; }

log "Restoring production-safe PostgreSQL settings..."
docker compose exec -T postgres psql -U ttv -d ttv -c "
  ALTER SYSTEM SET synchronous_commit = on;
  ALTER SYSTEM SET checkpoint_warning = '30s';
  SELECT pg_reload_conf();
" 2>/dev/null && log "PostgreSQL: synchronous_commit restored to ON"

log "Verifying pg_hba trust → production warning..."
log "WARNING: pg_hba.conf has trust auth for benchmarking."
log "On production, change to scram-sha-256 or md5."
log "Edit /var/lib/postgresql/data/pg_hba.conf and run: docker compose exec postgres psql -U ttv -c \"SELECT pg_reload_conf();\""

log "Stopping benchmark containers (optional)..."
log "To stop: docker compose down"
log "To wipe data: docker compose down -v"

log ""
log "=== Rollback complete ==="
log "Summary of production-unsafe benchmark settings that were applied:"
log "  - synchronous_commit=off  (now restored to on)"
log "  - pg_hba trust auth       (must be manually changed for production)"
log "  - Redis noeviction on GEO (keep this — correct for production too)"
log "  - Redis allkeys-lru on session/cache (keep — correct)"

-- ===================================================================
-- TingTingVac Schema Migration — Safe ALTER TABLE (no data loss)
-- Chạy: docker compose exec -T postgres psql -U ttv -d ttv -f /seed/fix_schema.sql
-- ===================================================================

BEGIN;

-- ── 1. Thêm cột thiếu cho users ──────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(15) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 2. Thêm cột thiếu cho workers ────────────────────────────────
ALTER TABLE workers ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS name VARCHAR(100) NOT NULL DEFAULT 'Worker';
ALTER TABLE workers ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) NOT NULL DEFAULT 5.00;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS trust_score INTEGER NOT NULL DEFAULT 100;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS trust_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS last_lat DECIMAL(9,6) NULL;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS last_lon DECIMAL(9,6) NULL;

-- ── 3. Indexes còn thiếu ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workers_matching ON workers(status, last_lat, last_lon) WHERE status = 'online';
CREATE INDEX IF NOT EXISTS idx_ledger_idempotency ON ledger_entries(job_id, entry_type, payment_state);
CREATE INDEX IF NOT EXISTS idx_jobs_matching ON jobs(state, pickup_lat, pickup_lon) WHERE state = 'CREATED';

COMMIT;
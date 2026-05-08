-- TingTingVac benchmark schema
-- Run: psql -U ttv -d ttv -f /seed/01_schema.sql

-- PostGIS optional: only needed for last_location column (benchmarks use Redis GEO instead)
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  phone VARCHAR(15) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('customer', 'worker', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workers (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  rating DECIMAL(3,2) NOT NULL DEFAULT 5.00,
  trust_score INTEGER NOT NULL DEFAULT 100,
  trust_level INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  last_lat DECIMAL(9,6) NULL,
  last_lon DECIMAL(9,6) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES users(id),
  worker_id BIGINT NULL REFERENCES workers(id),
  state VARCHAR(20) NOT NULL DEFAULT 'CREATED',
  pickup_lat DECIMAL(9,6) NOT NULL,
  pickup_lon DECIMAL(9,6) NOT NULL,
  weight_kg INTEGER NOT NULL,
  floors INTEGER NOT NULL,
  carry_distance_m INTEGER NOT NULL,
  price_breakdown JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_state_created ON jobs(state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(id),
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  account VARCHAR(50) NOT NULL,
  amount BIGINT NOT NULL,
  payment_state VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_job ON ledger_entries(job_id);
CREATE INDEX IF NOT EXISTS idx_ledger_state ON ledger_entries(payment_state);

CREATE TABLE IF NOT EXISTS payment_ipn_log (
  id BIGSERIAL PRIMARY KEY,
  gateway VARCHAR(20) NOT NULL,
  transaction_id VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(gateway, transaction_id)
);

CREATE TABLE IF NOT EXISTS sos_incidents (
  id BIGSERIAL PRIMARY KEY,
  triggered_by_user_id BIGINT NOT NULL REFERENCES users(id),
  job_id BIGINT NULL REFERENCES jobs(id),
  category VARCHAR(30) NOT NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at TIMESTAMPTZ NULL,
  alert_latency_ms INTEGER NULL
);
CREATE INDEX IF NOT EXISTS idx_sos_state ON sos_incidents(state);
CREATE INDEX IF NOT EXISTS idx_sos_triggered_at ON sos_incidents(triggered_at DESC);

CREATE TABLE IF NOT EXISTS otp_codes (
  id BIGSERIAL PRIMARY KEY,
  phone VARCHAR(15) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone_active ON otp_codes(phone) WHERE consumed = FALSE;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id BIGINT NULL,
  payload JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- Trigger: auto-update jobs.updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

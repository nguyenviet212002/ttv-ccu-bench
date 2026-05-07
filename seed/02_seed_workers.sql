-- Seed 50 admin users and 10,000 customer users quickly
-- Workers and jobs are seeded via 03_seed_jobs.js for bulk performance

-- Seed admins
INSERT INTO users (phone, type)
SELECT
  '+849900' || LPAD(i::text, 5, '0'),
  'admin'
FROM generate_series(1, 50) AS i
ON CONFLICT (phone) DO NOTHING;

-- Seed 10,000 customers
INSERT INTO users (phone, type)
SELECT
  '+8480' || LPAD(i::text, 7, '0'),
  'customer'
FROM generate_series(1, 10000) AS i
ON CONFLICT (phone) DO NOTHING;

-- Create worker user accounts (500,000) — done in batches via JS for speed
-- This SQL just verifies the schema is ready
SELECT COUNT(*) AS admin_count FROM users WHERE type = 'admin';
SELECT COUNT(*) AS customer_count FROM users WHERE type = 'customer';

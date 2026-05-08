#!/usr/bin/env node
/**
 * TingTingVac benchmark seed script
 * Seeds: 500,000 workers + 100,000 jobs (must complete in <2 minutes)
 * Also loads all workers into Redis GEO (workers:geo:active)
 */

'use strict';

const { Pool } = require('pg');
const Redis = require('ioredis');

// Config from env or defaults
const DB_URL = process.env.DATABASE_URL || 'postgresql://ttv:ttv_pass@localhost:5432/ttv';
const REDIS_GEO_URL = process.env.REDIS_GEO_EXTERNAL_URL || 'redis://localhost:6381';

const WORKER_COUNT = 500_000;
const CUSTOMER_COUNT = 10_000;
const JOB_COUNT = 100_000;
const BATCH_SIZE = 1_000;

// Hà Nội bounding box
const HN_LAT_MIN = 20.95, HN_LAT_MAX = 21.10;
const HN_LON_MIN = 105.75, HN_LON_MAX = 105.90;

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randHanoiLat() { return randFloat(HN_LAT_MIN, HN_LAT_MAX); }
function randHanoiLon() { return randFloat(HN_LON_MIN, HN_LON_MAX); }

const pool = new Pool({ connectionString: DB_URL, max: 20 });
const redis = new Redis(REDIS_GEO_URL, { lazyConnect: true });

async function ensureConnections() {
  await redis.connect();
  const client = await pool.connect();
  client.release();
  console.log('DB and Redis connections OK');
}

async function seedWorkerUsers() {
  console.log('Seeding 500,000 worker user accounts...');
  const start = Date.now();
  let inserted = 0;

  for (let batch = 0; batch < WORKER_COUNT / BATCH_SIZE; batch++) {
    const offset = batch * BATCH_SIZE;
    const values = [];
    const params = [];
    let pIdx = 1;

    for (let i = 0; i < BATCH_SIZE; i++) {
      const num = offset + i + 1;
      values.push(`($${pIdx++}, $${pIdx++})`);
      params.push(`+8470${String(num).padStart(6, '0')}`, 'worker');
    }

    await pool.query(
      `INSERT INTO users (phone, type) VALUES ${values.join(',')} ON CONFLICT (phone) DO NOTHING`,
      params
    );
    inserted += BATCH_SIZE;

    if (inserted % 50_000 === 0) {
      process.stdout.write(`  ${inserted}/${WORKER_COUNT} users (${((Date.now() - start) / 1000).toFixed(1)}s)\n`);
    }
  }
  console.log(`Worker users seeded in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function seedWorkerProfiles() {
  console.log('Seeding 500,000 worker profiles...');
  const start = Date.now();

  // Get all worker user IDs
  const { rows: userRows } = await pool.query(
    `SELECT id FROM users WHERE type = 'worker' ORDER BY id`
  );
  const userIds = userRows.map(r => r.id);
  console.log(`  Found ${userIds.length} worker user accounts`);

  const statuses = ['online', 'online', 'online', 'en_route', 'offline'];

  for (let batch = 0; batch < userIds.length / BATCH_SIZE; batch++) {
    const slice = userIds.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
    const values = [];
    const params = [];
    let pIdx = 1;

    for (let i = 0; i < slice.length; i++) {
      const lat = randHanoiLat();
      const lon = randHanoiLon();
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const name = `Worker ${slice[i]}`;
      const rating = (4.0 + Math.random()).toFixed(2);
      const trust = randInt(60, 100);

      values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
      params.push(slice[i], name, rating, trust, 1, status, lat, lon);
    }

    await pool.query(
      `INSERT INTO workers (user_id, name, rating, trust_score, trust_level, status, last_lat, last_lon)
       VALUES ${values.join(',')}
       ON CONFLICT DO NOTHING`,
      params
    );

    if ((batch + 1) % 50 === 0) {
      const done = Math.min((batch + 1) * BATCH_SIZE, userIds.length);
      process.stdout.write(`  ${done}/${userIds.length} profiles (${((Date.now() - start) / 1000).toFixed(1)}s)\n`);
    }
  }
  console.log(`Worker profiles seeded in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function loadWorkersToRedisGeo() {
  console.log('Loading 500,000 workers into Redis GEO (workers:geo:active)...');
  const start = Date.now();

  const { rows: workers } = await pool.query(
    `SELECT id, last_lat AS lat, last_lon AS lon FROM workers WHERE last_lat IS NOT NULL`
  );
  console.log(`  Loading ${workers.length} workers into Redis GEO...`);

  const REDIS_BATCH = 5_000;
  for (let i = 0; i < workers.length; i += REDIS_BATCH) {
    const slice = workers.slice(i, i + REDIS_BATCH);
    const args = ['workers:geo:active'];
    for (const w of slice) {
      args.push(w.lon, w.lat, `worker:${w.id}`);
    }
    await redis.geoadd(...args);
    // Set TTL for each worker (45s in production; no TTL for bench seed)
    if ((i / REDIS_BATCH) % 20 === 0) {
      process.stdout.write(`  ${Math.min(i + REDIS_BATCH, workers.length)}/${workers.length} (${((Date.now() - start) / 1000).toFixed(1)}s)\n`);
    }
  }
  console.log(`Redis GEO loaded in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function seedJobs() {
  console.log(`Seeding ${JOB_COUNT} historical jobs...`);
  const start = Date.now();

  const { rows: customers } = await pool.query(
    `SELECT id FROM users WHERE type = 'customer' LIMIT ${CUSTOMER_COUNT}`
  );
  const { rows: workerRows } = await pool.query(
    `SELECT id FROM workers LIMIT 5000`
  );

  if (customers.length === 0) {
    console.error('No customers found — run 02_seed_workers.sql first');
    process.exit(1);
  }

  const customerIds = customers.map(r => r.id);
  const workerIds = workerRows.map(r => r.id);
  const states = ['CREATED', 'MATCHED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED', 'COMPLETED'];

  for (let batch = 0; batch < JOB_COUNT / BATCH_SIZE; batch++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Build 1000-row batch — 9 params per row
      const batchJobs = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const customerId = customerIds[Math.floor(Math.random() * customerIds.length)];
        const workerId   = Math.random() > 0.3 ? workerIds[Math.floor(Math.random() * workerIds.length)] : null;
        const state      = states[Math.floor(Math.random() * states.length)];
        const kg         = randInt(10, 200);
        const floors     = randInt(0, 10);
        const dist       = randInt(50, 500);
        const price      = 15000 + (kg * 1500) + (floors * 10000) + (dist * 500);
        const breakdown  = { base: 15000, weight: kg * 1500, floors: floors * 10000, distance: dist * 500, total: price };
        batchJobs.push({ customerId, workerId, state, kg, floors, dist, price, breakdown });
      }

      // 9 columns per row: customer_id, worker_id, state, lat, lon, kg, floors, dist, breakdown
      const COLS = 9;
      const insertSQL = `
        INSERT INTO jobs (customer_id, worker_id, state, pickup_lat, pickup_lon, weight_kg, floors, carry_distance_m, price_breakdown)
        VALUES ${batchJobs.map((_, idx) => {
          const b = idx * COLS;
          return `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5}, $${b+6}, $${b+7}, $${b+8}, $${b+9})`;
        }).join(',')}
        RETURNING id
      `;

      const flatParams = [];
      for (const j of batchJobs) {
        flatParams.push(
          j.customerId,
          j.workerId,            // null is fine for BIGINT
          j.state,
          randHanoiLat(),
          randHanoiLon(),
          j.kg,
          j.floors,
          j.dist,
          JSON.stringify(j.breakdown),
        );
      }

      const { rows: insertedJobs } = await client.query(insertSQL, flatParams);

      // Insert ledger entries for COMPLETED jobs
      const completedJobs = insertedJobs.filter((_, idx) => batchJobs[idx].state === 'COMPLETED');
      if (completedJobs.length > 0) {
        const ledgerValues = [];
        const ledgerParams = [];
        let lIdx = 1;
        for (let i = 0; i < completedJobs.length; i++) {
          const jobId = completedJobs[i].id;
          const amount = batchJobs[insertedJobs.indexOf(completedJobs[i])].price;
          // debit customer
          ledgerValues.push(`($${lIdx++}, $${lIdx++}, $${lIdx++}, $${lIdx++}, $${lIdx++})`);
          ledgerParams.push(jobId, 'debit', 'customer_wallet', amount, 'SETTLED');
          // credit worker
          ledgerValues.push(`($${lIdx++}, $${lIdx++}, $${lIdx++}, $${lIdx++}, $${lIdx++})`);
          ledgerParams.push(jobId, 'credit', 'worker_wallet', amount, 'SETTLED');
        }
        await client.query(
          `INSERT INTO ledger_entries (job_id, entry_type, account, amount, payment_state) VALUES ${ledgerValues.join(',')}`,
          ledgerParams
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    if ((batch + 1) % 20 === 0) {
      process.stdout.write(`  ${Math.min((batch + 1) * BATCH_SIZE, JOB_COUNT)}/${JOB_COUNT} jobs (${((Date.now() - start) / 1000).toFixed(1)}s)\n`);
    }
  }

  console.log(`Jobs seeded in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function main() {
  const total = Date.now();
  console.log('=== TingTingVac Benchmark Seed Script ===');
  console.log(`Target: ${WORKER_COUNT} workers, ${JOB_COUNT} jobs`);
  console.log('');

  try {
    await ensureConnections();
    await seedWorkerUsers();
    await seedWorkerProfiles();
    await loadWorkersToRedisGeo();
    await seedJobs();

    // Final counts
    const { rows: counts } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE type = 'worker') AS workers,
        (SELECT COUNT(*) FROM users WHERE type = 'customer') AS customers,
        (SELECT COUNT(*) FROM users WHERE type = 'admin') AS admins,
        (SELECT COUNT(*) FROM jobs) AS jobs,
        (SELECT COUNT(*) FROM ledger_entries) AS ledger_entries
    `);
    console.log('\n=== Seed Complete ===');
    console.log('Final counts:', counts[0]);
    const geoCount = await redis.zcard('workers:geo:active');
    console.log(`Redis GEO workers:geo:active: ${geoCount} entries`);
    console.log(`Total time: ${((Date.now() - total) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
    redis.disconnect();
  }
}

main();

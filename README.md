# TingTingVac 5K CCU Benchmark Suite

Benchmark suite để chứng minh hệ thống TingTingVac chịu được **5,000 concurrent users** với workload thực tế.

Kết quả đo được từ suite này sẽ được nộp cho Bên A (Mạnh Trường An Co., Ltd.) theo yêu cầu trong thư TTV-FB-5000CCU-2026-002.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Docker + Docker Compose | ≥ 24 | https://docs.docker.com/get-docker/ |
| Node.js | ≥ 20 | https://nodejs.org |
| k6 | ≥ 0.49 | https://k6.io/docs/get-started/installation/ |
| psql (optional) | any | included with PostgreSQL client |

### OS tuning (required for B4 and B8)

```bash
# File descriptor limit — required for 10,000+ WebSocket connections
ulimit -n 65536

# Persist across reboots:
sudo tee /etc/security/limits.d/ttv-bench.conf << 'EOF'
*  soft  nofile  65536
*  hard  nofile  65536
EOF

# TCP port range for k6 outbound connections
sudo sysctl -w net.ipv4.ip_local_port_range="10000 65535"
sudo sysctl -w net.ipv4.tcp_tw_reuse=1

# Disable swap during benchmarking (swap skews latency)
sudo swapoff -a
```

---

## Quick Start

```bash
# 1. Clone / unzip this project
cd ttv-ccu-bench

# 2. Copy env file
cp .env.example .env

# 3. Run everything (schema + seed + all 8 benchmarks)
chmod +x scripts/*.sh
./scripts/run-all.sh
```

The script will:
1. Start Docker stack (Postgres + 5× Redis + NestJS API + Prometheus + Grafana)
2. Run schema migration
3. Seed 500k workers + 100k jobs (~90 seconds)
4. Run all 8 benchmarks in sequence
5. Write results to `results/`
6. Print PASS/FAIL summary

After completion, fill in `RESULTS.md` and submit.

---

## Individual Benchmark Run

```bash
# Set environment
export API_BASE_URL=http://localhost:3000
export BENCH_TOKEN=<jwt-token>  # optional, some endpoints skip auth in bench mode

# Run specific benchmark
k6 run --summary-export=results/b1_redis_geo_summary.json k6/b1_redis_geo.js
k6 run --summary-export=results/b2_price_api_summary.json k6/b2_price_api.js
k6 run --summary-export=results/b3_node_max_rps_summary.json k6/b3_node_max_rps.js
k6 run --summary-export=results/b4_ws_sustained_summary.json k6/b4_ws_sustained.js
k6 run --summary-export=results/b5_pg_writes_summary.json k6/b5_pg_writes.js
k6 run --summary-export=results/b6_matching_e2e_summary.json k6/b6_matching_e2e.js
k6 run --summary-export=results/b7_payment_concurrent_summary.json k6/b7_payment_concurrent.js
k6 run --summary-export=results/b8_full_5k_ccu_summary.json k6/b8_full_5k_ccu.js
```

---

## Project Structure

```
ttv-ccu-bench/
├── docker-compose.yml        # Full stack: Postgres, 5×Redis, API, Prometheus, Grafana
├── .env.example              # Environment variables template
├── api/                      # NestJS API (realistic, hits real PG + Redis)
│   ├── src/
│   │   ├── main.ts
│   │   ├── cluster.ts        # PM2-style cluster fork
│   │   ├── app.module.ts
│   │   ├── redis/            # 5 Redis instances injected
│   │   ├── database/         # PgBouncer pool
│   │   ├── common/
│   │   │   ├── middleware/   # RequestId, JwtAuth
│   │   │   └── interceptors/ # Prometheus metrics
│   │   ├── modules/
│   │   │   ├── auth/         # OTP request/verify → JWT + Redis session
│   │   │   ├── jobs/         # calculate-price, create-job, accept-job
│   │   │   ├── workers/      # GPS update (Redis GEO only), nearby
│   │   │   ├── sos/          # SOS trigger → P0 queue + WS broadcast
│   │   │   ├── payments/     # IPN webhook with idempotency + double-entry ledger
│   │   │   └── health/       # /health/snapshot + /metrics
│   │   └── gateways/         # Socket.io WebSocket: /worker /customer /admin
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── seed/
│   ├── 01_schema.sql         # PostGIS + 8 tables + indexes + triggers
│   ├── 02_seed_workers.sql   # 10k customers + 50 admins
│   └── 03_seed_jobs.js       # 500k workers + 100k jobs + Redis GEO load
├── k6/
│   ├── b1_redis_geo.js       # GEORADIUS p99 < 10ms @ 500k points
│   ├── b2_price_api.js       # Price endpoint p95 < 100ms
│   ├── b3_node_max_rps.js    # Find max RPS (target ≥ 5000 RPS)
│   ├── b4_ws_sustained.js    # 10k WS × 30 min, disconnect < 1%
│   ├── b5_pg_writes.js       # DB writes ≥ 500 TPS, p95 < 50ms
│   ├── b6_matching_e2e.js    # Full match pipeline p95 < 2s
│   ├── b7_payment_concurrent.js  # Idempotency + ledger consistency
│   └── b8_full_5k_ccu.js    # All 5k CCU groups × 30 min
├── scripts/
│   ├── run-all.sh            # Orchestrates full benchmark run
│   ├── collect-metrics.sh    # Prometheus snapshot
│   └── reset-db.sh           # Wipe all data (--confirm required)
├── grafana/
│   ├── prometheus.yml
│   └── provisioning/
│       ├── datasources/
│       └── dashboards/
├── results/                  # Created at runtime, holds JSON summaries + logs
└── RESULTS.md                # Template to fill in and submit to client
```

---

## Services and Ports

| Service | Port | Credentials |
|---|---|---|
| NestJS API | 3000 | — |
| PostgreSQL | 5432 | ttv / ttv_pass |
| PgBouncer | 5433 | ttv / ttv_pass |
| Redis Session | 6379 | — |
| Redis Cache | 6380 | — |
| Redis GEO | 6381 | — |
| Redis Queue | 6382 | — |
| Redis PubSub | 6383 | — |
| Prometheus | 9090 | — |
| Grafana | 3001 | admin / admin |

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/otp/request` | Public | Request OTP |
| POST | `/api/v1/auth/otp/verify` | Public | Verify OTP → JWT |
| POST | `/api/v1/jobs/calculate-price` | Public | Pure-compute price |
| POST | `/api/v1/jobs` | JWT | Create job + match |
| POST | `/api/v1/jobs/:id/accept` | JWT | Worker accepts job |
| POST | `/api/v1/workers/me/gps` | JWT | Update GPS (Redis only) |
| GET | `/api/v1/workers/nearby?lat=&lon=` | Public | GEORADIUS top 20 |
| POST | `/api/v1/sos/trigger` | JWT | Trigger SOS alert |
| POST | `/api/v1/payments/webhook` | Public | IPN webhook |
| GET | `/api/v1/health/snapshot` | Public | Health + metrics JSON |
| GET | `/metrics` | Public | Prometheus metrics |

---

## Workload Definition (5,000 CCU)

| Group | Count | GPS interval | HTTP req/min |
|---|---:|---|---:|
| Worker standby | 2,000 | 30–60 s | 2 |
| Worker en route | 500 | 10–15 s | 6 |
| Customer browsing | 1,500 | — | 8 |
| Customer tracking (WS) | 700 | — | 1 |
| Admin/Dispatcher | 50 | — | 12 |
| Job burst | 500 jobs/10min | — | — |

**Total WebSocket connections:** 3,250  
**GPS updates/sec (peak):** ~200/s  
**HTTP RPS (peak with job burst):** ~500/s

---

## Acceptance Criteria (All 15 must PASS)

| # | Metric | Threshold |
|:---:|---|---|
| 1 | API p95 normal | < 300 ms |
| 2 | API p99 normal | < 800 ms |
| 3 | Matching p95 E2E | < 2,000 ms |
| 4 | SOS to dispatcher | < 5,000 ms |
| 5 | WS abnormal disconnect | < 1% |
| 6 | GPS lag active job | < 20 s |
| 7 | Redis memory | < 70% cap |
| 8 | DB CPU | < 70% |
| 9 | DB replica lag | < 2 s |
| 10 | Queue delay normal | < 60 s |
| 11 | Queue delay SOS | < 5 s |
| 12 | Error rate | < 0.5% |
| 13 | **Ledger mismatch** | **= 0 (absolute)** |
| 14 | **Duplicate charges** | **= 0 (absolute)** |
| 15 | **Job state lost on restart** | **= 0 (absolute)** |

---

## Troubleshooting

### "API did not become ready"
```bash
docker compose logs api
# Common: port conflict on 3000, increase sleep in run-all.sh
```

### k6 "too many open files"
```bash
ulimit -n 65536
# Then re-run the benchmark
```

### "dial tcp: too many open files" in k6 WebSocket test
```bash
sysctl -w net.ipv4.ip_local_port_range="10000 65535"
sysctl -w net.ipv4.tcp_tw_reuse=1
```

### Seed script slow or crashes
```bash
# Increase Postgres shared_buffers or reduce BATCH_SIZE in seed/03_seed_jobs.js
# Default is 1000 rows per batch
```

### Reset everything and start fresh
```bash
./scripts/reset-db.sh --confirm
./scripts/run-all.sh --force
```

### Run k6 on separate machine (recommended for B8)
```bash
# On load generator machine:
export API_BASE_URL=http://<server-ip>:3000
k6 run k6/b8_full_5k_ccu.js
```

---

## Hardware Recommendation

For accurate results on target hardware (Contabo VPS 30 — 8 vCPU / 24 GB):
- Run Docker stack on the **target VPS**
- Run k6 on a **separate machine** (same datacenter/region) to avoid self-contention
- k6 for B8 needs ~4 GB RAM and 4 vCPU itself

---

*TingTingVac 5K CCU Benchmark Suite — Sprint 0 evidence package*  
*Ref: TTV-FB-5000CCU-2026-002*

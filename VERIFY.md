# 🔍 VERIFY.md — Verification Checklist

> Run these commands after applying all fixes to confirm everything works.

## 1. Docker Compose — Stack khởi động OK
```bash
docker compose up -d
sleep 30
docker compose ps --format "table {{.Name}}\t{{.Status}}"
```
✅ Tất cả 10 containers (postgres, pgbouncer, 5x redis, api, prometheus, grafana) phải `Up` / `Healthy`

## 2. Redis GEO — Tắt persistence
```bash
docker compose exec redis-geo redis-cli CONFIG GET appendonly
docker compose exec redis-geo redis-cli CONFIG GET save
docker compose exec redis-geo redis-cli CONFIG GET maxmemory
docker compose exec redis-geo redis-cli CONFIG GET maxmemory-policy
```
✅ `appendonly` = no, `save` = "", `maxmemory` = 4294967296 (4GB), `maxmemory-policy` = allkeys-lru

## 3. PostgreSQL — Buffer pool tuned
```bash
docker compose exec postgres psql -U ttv -d ttv -c "SHOW shared_buffers;"
docker compose exec postgres psql -U ttv -d ttv -c "SHOW effective_cache_size;"
docker compose exec postgres psql -U ttv -d ttv -c "SHOW wal_buffers;"
```
✅ `shared_buffers` = 4GB, `effective_cache_size` = 12GB, `wal_buffers` = 16MB

## 4. Node.js — Heap 4GB
```bash
docker compose exec api node -e "const v8 = require('v8'); console.log(JSON.stringify(v8.getHeapStatistics(), null, 2));"
```
✅ `heap_size_limit` ≈ 4294967296 (4GB)

## 5. Seed Data — 500K workers in Hanoi box
```bash
DATABASE_URL="postgresql://ttv:ttv_pass@localhost:5434/ttv" REDIS_GEO_EXTERNAL_URL="redis://localhost:6381" node seed/03_seed_jobs.js
```
✅ Hoàn thành < 2 phút
✅ `Final counts: workers=500000`
✅ `GEO verification (GEORADIUS 105.8 21.05 5km): 5 workers found`

Kiểm tra thêm:
```bash
docker compose exec postgres psql -U ttv -d ttv -c "SELECT COUNT(*) FROM workers WHERE status='online';"
```
✅ = 500000

```bash
docker compose exec redis-geo redis-cli GEORADIUS workers:geo:active 105.8 21.05 5 km COUNT 5
```
✅ Trả về list worker IDs (không rỗng)

## 6. B1 — Redis GEO Benchmark
```bash
k6 run k6/b1_redis_geo.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth
```
✅ `geo_query p99 < 10ms` — PASS
✅ `throughput >= 5000/s` — PASS

## 7. B3 — Max RPS Benchmark
```bash
k6 run k6/b3_node_max_rps.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth
```
✅ `Peak RPS >= 5000` — PASS
✅ `p95 < 300ms` — PASS
✅ `error rate < 1%` — PASS

## 8. B4 — WebSocket Sustained
```bash
k6 run k6/b4_ws_sustained.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth
```
✅ `abnormal_disconnect_rate < 0.01` — PASS

## 9. B6 — Matching E2E
```bash
k6 run k6/b6_matching_e2e.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth
```
✅ `match_success rate > 0.95` — PASS
✅ `matching_e2e_duration_ms p(95) < 2000ms` — PASS

## 10. B7 — Payment + Ledger Verification
```bash
k6 run k6/b7_payment_concurrent.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth
```
Sau đó:
```bash
docker compose exec postgres psql -U ttv -d ttv -c "SELECT COALESCE(SUM(CASE WHEN entry_type='debit' THEN amount ELSE -amount END),0) AS mismatch FROM ledger_entries;"
```
✅ Ledger mismatch = 0

## 11. B8 — Full 5K CCU (30 phút) ⭐
```bash
k6 run k6/b8_full_5k_ccu.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth
```
✅ 14/15 criteria PASS
✅ WS abnormal disconnect chỉ còn rate-based

## 12. Run-all script
```bash
cd /root/ttv-ccu-bench && chmod +x scripts/run-all.sh && ./scripts/run-all.sh
```
✅ Script chạy từ B1→B8 end-to-end không lỗi
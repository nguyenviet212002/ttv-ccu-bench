# TingTingVac 5K CCU Benchmark Suite

Bộ benchmark chứng minh hệ thống TingTingVac chịu được **5,000 concurrent users** với workload thực tế.  
Kết quả từ suite này sẽ nộp cho Bên A (Mạnh Trường An Co., Ltd.) theo thư TTV-FB-5000CCU-2026-002.

---

## Yêu cầu cài đặt (Prerequisites)

Cài **3 tool** này trước khi chạy:

| Tool | Download | Ghi chú |
|---|---|---|
| **Docker Desktop** | https://www.docker.com/products/docker-desktop/ | Bật WSL2 khi cài. Sau khi cài phải **mở Docker Desktop** trước khi chạy lệnh |
| **Node.js 20 LTS** | https://nodejs.org | Chọn bản LTS |
| **k6** | https://dl.k6.io/msi/k6-latest-amd64.msi | Tải file .msi, cài xong restart terminal |

> **Kiểm tra cài đặt thành công:**
> ```powershell
> docker --version    # Docker Desktop v24+
> node --version      # v20.x.x
> k6 version          # v0.49+
> ```

---

## Chạy nhanh (Windows — Docker Desktop)

Mở **PowerShell** và chạy theo thứ tự:

```powershell
# 1. Clone repo
git clone https://github.com/nguyenviet212002/ttv-ccu-bench.git
cd ttv-ccu-bench

# 2. Copy file cấu hình
copy .env.example .env

# 3. Build API image (chỉ cần làm 1 lần)
docker compose build api

# 4. Cài thư viện cho seed script
npm install

# 5. Chạy toàn bộ benchmark (tự động hoàn toàn)
.\scripts\run-all.ps1
```

**Script tự động làm:**
1. Khởi động Docker stack (Postgres + 5×Redis + NestJS API + Prometheus + Grafana)
2. Chạy schema migration (tạo 8 bảng)
3. Seed 500,000 workers + 100,000 jobs (~60 giây)
4. Warmup API
5. Chạy 8 benchmark B1 → B8 lần lượt (~100 phút tổng)
6. Kiểm tra SQL ledger (tiêu chí 13 + 14)
7. In bảng PASS/FAIL tổng kết

Sau khi xong → điền kết quả vào `RESULTS.md` → nộp cho khách hàng.

---

## Chạy từng benchmark riêng lẻ

```powershell
# Set biến môi trường một lần
$env:API_BASE_URL = "http://localhost:3000"
$env:BENCH_TOKEN  = "benchmark-token-skip-auth"

# Chạy từng benchmark
k6 run --summary-export=results\b1_redis_geo_summary.json     --env API_BASE_URL=$env:API_BASE_URL k6\b1_redis_geo.js
k6 run --summary-export=results\b2_price_api_summary.json     --env API_BASE_URL=$env:API_BASE_URL k6\b2_price_api.js
k6 run --summary-export=results\b3_node_max_rps_summary.json  --env API_BASE_URL=$env:API_BASE_URL k6\b3_node_max_rps.js
k6 run --summary-export=results\b4_ws_sustained_summary.json  --env API_BASE_URL=$env:API_BASE_URL k6\b4_ws_sustained.js
k6 run --summary-export=results\b5_pg_writes_summary.json     --env API_BASE_URL=$env:API_BASE_URL k6\b5_pg_writes.js
k6 run --summary-export=results\b6_matching_e2e_summary.json  --env API_BASE_URL=$env:API_BASE_URL k6\b6_matching_e2e.js
k6 run --summary-export=results\b7_payment_concurrent_summary.json --env API_BASE_URL=$env:API_BASE_URL k6\b7_payment_concurrent.js
k6 run --summary-export=results\b8_full_5k_ccu_summary.json   --env API_BASE_URL=$env:API_BASE_URL k6\b8_full_5k_ccu.js
```

---

## Thời gian chạy

| Benchmark | Mô tả | Thời gian |
|---|---|---|
| B1 Redis GEO | GEOSEARCH 500k points, p99 < 10ms | ~6 phút |
| B2 Price API | Pure compute, p95 < 100ms | ~4 phút |
| B3 Max RPS | Tìm max RPS ≥ 5,000 | ~14 phút |
| B4 WebSocket | 10,000 WS connections × 30 phút | **30 phút** |
| B5 PG Writes | ≥ 500 TPS, p95 < 50ms | ~10 phút |
| B6 Matching E2E | Full pipeline p95 < 2s | ~3 phút |
| B7 Payment IPN | Idempotency + ledger consistency | ~2 phút |
| B8 Full 5K CCU | Tất cả user groups × 30 phút | **30 phút** |
| **Tổng cộng** | | **~100 phút** |

---

## Xem kết quả

```powershell
# Xem file kết quả
ls results\

# Xem chi tiết 1 benchmark
Get-Content results\b2_price_api_summary.json | ConvertFrom-Json | ConvertTo-Json -Depth 3

# Mở Grafana dashboard (admin / admin)
start http://localhost:3001
```

---

## Services và Ports

| Service | URL | Thông tin đăng nhập |
|---|---|---|
| NestJS API | http://localhost:3000 | — |
| API Health | http://localhost:3000/api/v1/health/snapshot | — |
| Grafana | http://localhost:3001 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| PostgreSQL | localhost:5432 | ttv / ttv_pass |
| Redis Session | localhost:6379 | — |
| Redis GEO | localhost:6381 | — |

---

## Cấu trúc dự án

```
ttv-ccu-bench/
├── docker-compose.yml        # Toàn bộ stack: Postgres, 5×Redis, API, Prometheus, Grafana
├── .env.example              # Mẫu biến môi trường
├── package.json              # Dependencies cho seed script (pg + ioredis)
├── api/                      # NestJS API — kết nối thật PG + Redis
│   ├── src/
│   │   ├── main.ts           # Bootstrap + helmet + validation
│   │   ├── cluster.ts        # Fork theo số CPU
│   │   ├── modules/
│   │   │   ├── auth/         # OTP → JWT → Redis session
│   │   │   ├── jobs/         # calculate-price, create-job, accept-job
│   │   │   ├── workers/      # GPS (Redis GEO only, không ghi PG)
│   │   │   ├── sos/          # SOS → P0 queue + WebSocket broadcast
│   │   │   ├── payments/     # IPN webhook, idempotency, double-entry ledger
│   │   │   └── health/       # /health/snapshot + /metrics
│   │   └── gateways/         # Socket.io: /worker /customer /admin
│   └── Dockerfile
├── seed/
│   ├── 01_schema.sql         # 8 bảng + PostGIS + indexes
│   ├── 02_seed_workers.sql   # 10k customers + 50 admins
│   └── 03_seed_jobs.js       # 500k workers + 100k jobs + Redis GEO
├── k6/
│   ├── b1_redis_geo.js       # B1: Redis GEO benchmark
│   ├── b2_price_api.js       # B2: Price API
│   ├── b3_node_max_rps.js    # B3: Max RPS
│   ├── b4_ws_sustained.js    # B4: WebSocket 30 phút
│   ├── b5_pg_writes.js       # B5: PostgreSQL writes
│   ├── b6_matching_e2e.js    # B6: Matching end-to-end
│   ├── b7_payment_concurrent.js  # B7: Payment IPN
│   └── b8_full_5k_ccu.js    # B8: Full 5K CCU (benchmark chính)
├── scripts/
│   ├── run-all.ps1           # Windows: chạy toàn bộ tự động
│   ├── run-all.sh            # Linux/Mac: chạy toàn bộ tự động
│   ├── collect-metrics.sh    # Snapshot Prometheus
│   └── reset-db.sh           # Xóa toàn bộ data (cần --confirm)
├── grafana/                  # Cấu hình Prometheus + Grafana
├── results/                  # JSON + logs (tạo tự động khi chạy)
└── RESULTS.md                # Template điền kết quả để nộp khách hàng
```

---

## 15 Tiêu chí nghiệm thu (Acceptance Criteria)

| # | Metric | Ngưỡng | Đo bởi |
|:---:|---|---|---|
| 1 | API p95 (normal) | < 300 ms | B3, B8 |
| 2 | API p99 (normal) | < 800 ms | B3, B8 |
| 3 | Matching p95 E2E | < 2,000 ms | B6, B8 |
| 4 | SOS đến dispatcher | < 5,000 ms | B8 |
| 5 | WS abnormal disconnect | < 1% | B4, B8 |
| 6 | GPS lag active job | < 20 s | B8 |
| 7 | Redis memory | < 70% cap | B8 (Prometheus) |
| 8 | DB CPU | < 70% | B8 (host) |
| 9 | DB replication lag | < 2 s | B5, B8 |
| 10 | Queue delay (normal) | < 60 s | B8 |
| 11 | Queue delay (SOS) | < 5 s | B8 |
| 12 | Error rate | < 0.5% | Tất cả |
| 13 | **Ledger mismatch** | **= 0** | B7 SQL |
| 14 | **Duplicate charges** | **= 0** | B7 SQL |
| 15 | **Job state mất khi restart** | **= 0** | Manual chaos |

---

## Troubleshooting

### `docker` không nhận trong PowerShell
Docker Desktop chưa mở hoặc chưa cài đúng. Mở **Docker Desktop** từ Start Menu, đợi icon dưới taskbar chuyển thành running (icon cá voi không còn loading), rồi mở lại PowerShell.

### API không start (`docker compose logs api`)
```powershell
docker compose logs api
# Kiểm tra lỗi — thường là port 3000 bị chiếm
# Đổi port trong .env: PORT=3001
```

### Seed script lỗi `Cannot find module 'pg'`
```powershell
# Chạy npm install ở thư mục gốc trước
npm install
node seed/03_seed_jobs.js
```

### k6 lỗi `too many open files` (B4, B8)
```powershell
# Trên Windows Docker Desktop không cần ulimit
# Nếu chạy k6 trên Linux riêng:
ulimit -n 65536
```

### Reset và chạy lại từ đầu
```powershell
# Dừng và xóa tất cả containers + volumes
docker compose down -v

# Xóa kết quả cũ
Remove-Item results\*.json, results\*.log -ErrorAction SilentlyContinue

# Chạy lại
.\scripts\run-all.ps1
```

### Chạy k6 trên máy riêng (khuyến nghị cho B8)
```powershell
# Máy riêng trỏ vào server target
$env:API_BASE_URL = "http://<server-ip>:3000"
k6 run k6\b8_full_5k_ccu.js
```

---

## Hardware khuyến nghị (để có số chính xác)

Benchmark B8 (Full 5K CCU) cần tài nguyên lớn:

| Phần | Khuyến nghị |
|---|---|
| Server chạy Docker stack | VPS ≥ 8 vCPU / 16 GB RAM (target: Contabo VPS 30) |
| Máy chạy k6 | Máy riêng ≥ 4 CPU / 8 GB RAM — **không** chạy k6 và server cùng máy |
| Network | Cùng datacenter / cùng region để giảm latency |

---

*TingTingVac 5K CCU Benchmark Suite — Sprint 0 evidence package*  
*Ref: TTV-FB-5000CCU-2026-002*

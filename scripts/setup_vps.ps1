# =====================================================
# 🌐 HƯỚNG DẪN SETUP VPS TỪ POWERSHELL - TỪNG BƯỚC
# IP: 103.166.185.115 | User: root | Pass: my4P7Nm0tSK1n7W4
# =====================================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  HƯỚNG DẪN SETUP VPS ROCKY LINUX" -ForegroundColor Yellow
Write-Host "  Copy từng block và paste vào PowerShell" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Cyan

# =====================================================
# BƯỚC 0: Kill các session SSH cũ còn treo
# =====================================================
Write-Host "`n[STEP 0] Kill SSH sessions cũ..." -ForegroundColor Green
ssh -o StrictHostKeyChecking=no root@103.166.185.115 "exit"
# Nếu lỗi "Connection reset", đừng lo, xuống Bước 1

# =====================================================
# CÁCH DÙNG:
# Copy từng block dưới đây (từ "# === BLOCK" đến hết)
# Paste vào PowerShell và Enter
# =====================================================

# =====================================================
# BLOCK 1: SSH VÀO VPS
# =====================================================
# Sau lệnh này, nó hỏi password thì gõ: my4P7Nm0tSK1n7W4
# (khi gõ password sẽ không thấy chữ hiện lên, gõ xong Enter)
ssh -o StrictHostKeyChecking=no root@103.166.185.115

# =====================================================
# SAU KHI SSH THÀNH CÔNG, terminal sẽ hiện:
# [root@instance-91789989 ~]#
# Lúc này gõ TIẾP các lệnh dưới đây (từ BLOCK 2 đến BLOCK 6)
# =====================================================

# =====================================================
# BLOCK 2: CÀI DOCKER (gõ trên VPS - từng dòng 1)
# =====================================================
# Copy từng dòng dưới đây (không copy dòng có dấu #)
dnf install -y git
curl -s https://download.docker.com/linux/rhel/docker-ce.repo -o /etc/yum.repos.d/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl start docker
systemctl enable docker
docker --version
docker compose version

# =====================================================
# BLOCK 3: CÀI NODE.JS + K6
# =====================================================
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
npm install -g k6
node --version
k6 version

# =====================================================
# BLOCK 4: CLONE PROJECT (repo PUBLIC)
# =====================================================
cd /root
git clone https://github.com/nguyenviet212002/ttv-ccu-bench.git
cd ttv-ccu-bench

# =====================================================
# BLOCK 5: START DOCKER STACK
# =====================================================
docker compose up -d
# ĐỢI 30 GIÂY rồi gõ tiếp:
sleep 30
docker compose ps --format "table {{.Name}}\t{{.Status}}"

# Phải thấy 9 containers đều Up / Healthy

# =====================================================
# BLOCK 6: SEED DATA (500K workers, chạy ~10-15 phút)
# =====================================================
DATABASE_URL="postgresql://ttv:ttv_pass@localhost:5432/ttv" REDIS_GEO_EXTERNAL_URL="redis://localhost:6381" node seed/03_seed_jobs.js

# Kiểm tra seed xong:
docker compose exec postgres psql -U ttv -d ttv -c "SELECT COUNT(*) FROM workers;"
# Phải ra 500000

# =====================================================
# BLOCK 7: CHẠY BENCHMARK (chạy từng cái 1)
# =====================================================

# B1 - Redis Geo (2 phút)
k6 run k6/b1_redis_geo.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth

# B2 - Price API (2 phút)
k6 run k6/b2_price_api.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth

# B5 - PG Writes (2 phút)
k6 run k6/b5_pg_writes.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth

# B6 - Matching E2E (3 phút)
k6 run k6/b6_matching_e2e.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth

# B7 - Payment IPN (2 phút)
k6 run k6/b7_payment_concurrent.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth

# Kiểm tra ledger sau B7:
docker compose exec postgres psql -U ttv -d ttv -c "SELECT COALESCE(SUM(CASE WHEN entry_type='debit' THEN amount ELSE -amount END),0) AS mismatch FROM ledger_entries;"

# B3 - Max RPS (14 phút)
k6 run k6/b3_node_max_rps.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth

# B4 - WebSocket (30 phút)
k6 run k6/b4_ws_sustained.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth

# ========== QUAN TRỌNG NHẤT: B8 - FULL 5K CCU (30 phút) ==========
k6 run k6/b8_full_5k_ccu.js --env API_BASE_URL=http://localhost:3000 --env BENCH_TOKEN=benchmark-token-skip-auth

# =====================================================
# KHI CHẠY XONG: COPY KẾT QUẢ VỀ MÁY WINDOWS
# Mở PowerShell MỚI trên máy bạn (không phải trên VPS)
# =====================================================
# Trên PowerShell mới của máy Windows, gõ:
mkdir C:\Users\Admin\Downloads\LoadTest\ttv-ccu-bench\results\vps -Force
scp root@103.166.185.115:/root/ttv-ccu-bench/results/*.json C:\Users\Admin\Downloads\LoadTest\ttv-ccu-bench\results\vps\
# Gõ password: my4P7Nm0tSK1n7W4 khi được hỏi

# =====================================================
# XÓA VPS KHI KHÔNG DÙNG (để khỏi mất phí)
# =====================================================
# Vào Dashboard VPS → Instances → chọn server → Delete/Terminate

Write-Host "`n✅ Hoàn tất! Liên hệ tôi nếu gặp vấn đề." -ForegroundColor Green
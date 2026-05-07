# TingTingVac 5K CCU Benchmark — Windows PowerShell Runner
# Dùng với Docker Desktop (WSL2)
# Usage: .\scripts\run-all.ps1 [-Force]
param([switch]$Force)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ROOT      = Split-Path $PSScriptRoot -Parent
$RESULTS   = Join-Path $ROOT "results"
$API_URL   = "http://localhost:3000"
$DB_URL    = "postgresql://ttv:ttv_pass@localhost:5432/ttv"
$GEO_URL   = "redis://localhost:6381"
$BENCH_TOK = "benchmark-token-skip-auth"

$BENCHMARKS = @(
  "b1_redis_geo",
  "b2_price_api",
  "b3_node_max_rps",
  "b4_ws_sustained",
  "b5_pg_writes",
  "b6_matching_e2e",
  "b7_payment_concurrent",
  "b8_full_5k_ccu"
)

function Log($msg)  { Write-Host "[run-all] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[run-all] $msg" -ForegroundColor Yellow }
function Err($msg)  { Write-Host "[run-all] ERROR: $msg" -ForegroundColor Red }

# ── Preflight ────────────────────────────────────────────────────────────────
Log "=== TingTingVac 5K CCU Benchmark ==="
Log "Checking prerequisites..."

foreach ($cmd in @("docker","k6","node")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Err "$cmd not found. Install it first."
    exit 1
  }
}
Log "docker: $(docker --version)"
Log "k6: $(k6 version)"
Log "node: $(node --version)"

New-Item -ItemType Directory -Force -Path $RESULTS | Out-Null

# ── Step 1: Docker stack up ──────────────────────────────────────────────────
Log ""
Log "Step 1: Starting Docker stack..."
Set-Location $ROOT
docker compose up -d
if ($LASTEXITCODE -ne 0) { Err "docker compose up failed"; exit 1 }

Log "Waiting for services to be ready..."
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  Start-Sleep 3
  try {
    $h = Invoke-RestMethod "http://localhost:3000/api/v1/health/snapshot" -TimeoutSec 3 -EA Stop
    if ($h.status -eq "ok") { Log "API ready!"; break }
  } catch {}
  Write-Host "." -NoNewline
}
Write-Host ""

# Final check
try {
  $h = Invoke-RestMethod "http://localhost:3000/api/v1/health/snapshot" -TimeoutSec 5 -EA Stop
  Log "API: $($h.status) | DB: $($h.db_ping_ms)ms | Redis: $($h.redis_session)"
} catch {
  Err "API not reachable after 60s. Check: docker compose logs api"
  exit 1
}

# ── Step 2: Schema migration ─────────────────────────────────────────────────
Log ""
Log "Step 2: Running schema migration..."
docker compose exec -T postgres psql -U ttv -d ttv -f /seed/01_schema.sql
docker compose exec -T postgres psql -U ttv -d ttv -f /seed/02_seed_workers.sql
Log "Schema migration done."

# ── Step 3: Seed data ────────────────────────────────────────────────────────
Log ""
Log "Step 3: Seeding 500k workers + 100k jobs (~60-90 seconds)..."
$env:DATABASE_URL         = $DB_URL
$env:REDIS_GEO_EXTERNAL_URL = $GEO_URL
node (Join-Path $ROOT "seed\03_seed_jobs.js")
if ($LASTEXITCODE -ne 0) { Err "Seed failed"; exit 1 }

# ── Step 4: Warmup ───────────────────────────────────────────────────────────
Log ""
Log "Step 4: Warming up API (10 requests)..."
1..10 | ForEach-Object {
  try { Invoke-RestMethod "http://localhost:3000/api/v1/health/snapshot" -EA SilentlyContinue | Out-Null } catch {}
  try {
    Invoke-RestMethod "http://localhost:3000/api/v1/jobs/calculate-price" -Method POST `
      -ContentType "application/json" -Body '{"weight_kg":50,"floors":2,"carry_distance_m":100}' `
      -EA SilentlyContinue | Out-Null
  } catch {}
}
Log "Warmup done."

# ── Step 5: Run benchmarks ───────────────────────────────────────────────────
Log ""
Log "Step 5: Running 8 benchmarks..."
$passed = 0; $failed = 0; $skipped = 0

foreach ($bench in $BENCHMARKS) {
  $summaryFile = Join-Path $RESULTS "${bench}_summary.json"
  $logFile     = Join-Path $RESULTS "${bench}_stdout.log"

  if ((Test-Path $summaryFile) -and -not $Force) {
    Warn "SKIP ${bench} (summary exists, use -Force to re-run)"
    $skipped++
    continue
  }

  Log ""
  Log "=== $bench ==="
  $start = Get-Date

  $k6Args = @(
    "run",
    "--summary-export=$summaryFile",
    "--env", "API_BASE_URL=$API_URL",
    "--env", "BENCH_TOKEN=$BENCH_TOK",
    (Join-Path $ROOT "k6\${bench}.js")
  )

  k6 @k6Args 2>&1 | Tee-Object -FilePath $logFile

  $elapsed = [int]((Get-Date) - $start).TotalSeconds
  $exitCode = $LASTEXITCODE

  if ($exitCode -eq 0) {
    Log "${bench}: PASS ✓ (${elapsed}s)"
    $passed++
  } elseif ($exitCode -eq 99) {
    # k6 exit 99 = threshold violated — still collect results
    Warn "${bench}: threshold violation (${elapsed}s) — check results"
    $failed++
  } else {
    Err "${bench}: k6 failed with exit $exitCode"
    $failed++
  }

  # Cooldown between benchmarks
  if ($bench -ne "b8_full_5k_ccu") {
    Log "Cooldown 30s..."
    Start-Sleep 30
  }
}

# ── Step 6: B7 SQL verification ──────────────────────────────────────────────
Log ""
Log "Step 6: Ledger consistency check (B7 criteria 13+14)..."
$mismatch = docker compose exec -T postgres psql -U ttv -d ttv -t -c `
  "SELECT COALESCE(SUM(CASE WHEN entry_type='debit' THEN amount ELSE -amount END),0) FROM ledger_entries;" `
  2>$null
$dupIPN = docker compose exec -T postgres psql -U ttv -d ttv -t -c `
  "SELECT COUNT(*) FROM (SELECT gateway,transaction_id FROM payment_ipn_log GROUP BY 1,2 HAVING COUNT(*)>1) t;" `
  2>$null

$mismatch = $mismatch.Trim()
$dupIPN   = $dupIPN.Trim()
Log "Ledger mismatch (must be 0): $mismatch"
Log "Duplicate IPN (must be 0):   $dupIPN"

@{ ledger_mismatch = $mismatch; duplicate_ipn = $dupIPN } |
  ConvertTo-Json | Out-File (Join-Path $RESULTS "b7_sql_verification.json") -Encoding UTF8

# ── Final summary ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Benchmark Suite Complete" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  PASS:    $passed" -ForegroundColor Green
Write-Host "  FAIL:    $failed" -ForegroundColor $(if ($failed -gt 0) {"Red"} else {"Green"})
Write-Host "  SKIPPED: $skipped" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Ledger mismatch : $mismatch (must = 0)"
Write-Host "  Duplicate IPN   : $dupIPN (must = 0)"
Write-Host ""
Write-Host "  Results: $RESULTS\" -ForegroundColor Cyan
Write-Host "  Next: Fill in RESULTS.md and submit." -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan

if ($failed -gt 0) { exit 1 }

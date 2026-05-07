# TingTingVac 5K CCU Benchmark — Measured Results

> **Operator Instructions:** Run `./scripts/run-all.sh`, then fill in every `[___]` field below.
> Submit this file + `results/*.json` to the client as technical evidence.

---

**Run date:** [___]
**Operator:** [___]
**Hardware:** [VPS provider, CPU cores, RAM, disk]
**OS:** [Ubuntu/Debian version, kernel]
**Software versions:**
- Node.js: [___]
- PostgreSQL: [___]
- Redis: [___]
- k6: [___]
- Docker: [___]

---

## B1 — Redis GEO (500k worker points GEORADIUS)

| Metric | Value |
|---|---|
| GEORADIUS p50 | [___] ms |
| GEORADIUS p95 | [___] ms |
| GEORADIUS p99 | [___] ms |
| Sustained throughput | [___] queries/sec |
| Error rate | [___] % |

**Threshold:** p99 < 10ms, throughput ≥ 5,000 q/s
**PASS/FAIL:** [___]

---

## B2 — Price API (pure compute endpoint)

| Metric | Value |
|---|---|
| p50 | [___] ms |
| p95 | [___] ms |
| p99 | [___] ms |
| Error rate | [___] % |
| RPS sustained | [___] req/s |

**Threshold:** p95 < 100ms, p99 < 200ms, error rate < 0.1%
**PASS/FAIL:** [___]

---

## B3 — Node.js Max RPS (single instance breaking point)

| Metric | Value |
|---|---|
| Peak RPS achieved | [___] req/s |
| p95 at peak | [___] ms |
| p99 at peak | [___] ms |
| Error rate at peak | [___] % |
| RPS where p95 first crossed 300ms | [___] req/s |

**Threshold:** Sustained ≥ 5,000 RPS at p95 < 300ms
**PASS/FAIL:** [___]

---

## B4 — WebSocket Sustained 30 Minutes (10,000 connections)

| Metric | Value |
|---|---|
| Total WS connections opened | [___] |
| Abnormal disconnects | [___] |
| Abnormal disconnect rate | [___] % |
| GPS messages sent | [___] |
| API memory at start | [___] MB RSS |
| API memory at end | [___] MB RSS |
| Memory growth | [___] % |

**Threshold:** Abnormal disconnect < 1%, memory growth < 30%
**PASS/FAIL:** [___]

---

## B5 — PostgreSQL Writes (job + ledger)

| Metric | Value |
|---|---|
| TPS (sustained) | [___] TPS |
| p95 write latency | [___] ms |
| p99 write latency | [___] ms |
| Error rate | [___] % |
| Replica lag (max observed) | [___] ms |

**Threshold:** ≥ 500 TPS at p95 < 50ms, replica lag < 2s
**PASS/FAIL:** [___]

---

## B6 — Matching End-to-End

| Metric | Value |
|---|---|
| Matching p50 | [___] ms |
| Matching p95 | [___] ms |
| Matching p99 | [___] ms |
| Match success rate | [___] % |
| Total jobs created | [___] |

**Threshold:** Matching p95 < 2,000ms, match success rate > 95%
**PASS/FAIL:** [___]

---

## B7 — Concurrent Payment IPN (idempotency + ledger consistency)

| Metric | Value |
|---|---|
| p95 IPN latency | [___] ms |
| p99 IPN latency | [___] ms |
| Duplicates sent | [___] |
| Error rate | [___] % |

### SQL Verification Results (MANDATORY)

```
-- Run: docker compose exec postgres psql -U ttv -d ttv

SELECT
  (SELECT SUM(amount) FROM ledger_entries WHERE entry_type='debit') -
  (SELECT SUM(amount) FROM ledger_entries WHERE entry_type='credit') AS ledger_mismatch_vnd;
```
**Ledger mismatch (must = 0):** [___] VND

```
SELECT COUNT(*) FROM (
  SELECT gateway, transaction_id FROM payment_ipn_log
  GROUP BY gateway, transaction_id HAVING COUNT(*) > 1
) t;
```
**Duplicate transaction IDs (must = 0):** [___]

**Threshold:** Ledger mismatch = 0, duplicate transactions = 0
**PASS/FAIL:** [___]

---

## B8 — Full 5,000 CCU Mix (30 minutes)

| # | Metric | Threshold | Measured | PASS/FAIL |
|:---:|---|---|---|:---:|
| 1 | API p95 normal endpoints | < 300 ms | [___] ms | [___] |
| 2 | API p99 normal endpoints | < 800 ms | [___] ms | [___] |
| 3 | Matching p95 E2E | < 2,000 ms | [___] ms | [___] |
| 4 | SOS alert to dispatcher p95 | < 5,000 ms | [___] ms | [___] |
| 5 | WS abnormal disconnect rate | < 1% | [___] % | [___] |
| 6 | GPS lag during active job | < 20 s | [___] s | [___] |
| 7 | Redis memory utilization | < 70% of cap | [___] % | [___] |
| 8 | DB CPU during main test | < 70% | [___] % | [___] |
| 9 | DB replication lag | < 2 s | [___] ms | [___] |
| 10 | Queue delay normal jobs | < 60 s | [___] s | [___] |
| 11 | Queue delay SOS | < 5 s | [___] s | [___] |
| 12 | Error rate (all endpoints) | < 0.5% | [___] % | [___] |
| 13 | Ledger mismatch | = 0 (absolute) | [___] | [___] |
| 14 | Duplicate charge/payout | = 0 (absolute) | [___] | [___] |
| 15 | Job state lost on app restart | = 0 (absolute) | [___] | [___] |

**B8 OVERALL PASS/FAIL:** [___]

### B8 Chaos Test (Criterion 15)

Steps:
1. During B8 run (after minute 5), kill the API container: `docker compose kill api`
2. Wait 5 seconds, restart: `docker compose start api`
3. Query: `SELECT COUNT(*) FROM jobs WHERE state IN ('IN_PROGRESS','ACCEPTED') AND updated_at < NOW() - INTERVAL '1 min';`
4. Result (must = 0 lost jobs): [___]

---

## Resource Utilization During B8

| Resource | Peak | Average |
|---|---|---|
| API container CPU | [___] % | [___] % |
| API container RAM | [___] MB | [___] MB |
| PostgreSQL CPU | [___] % | [___] % |
| PostgreSQL RAM | [___] MB | [___] MB |
| Redis GEO CPU | [___] % | [___] % |
| Redis GEO RAM (used) | [___] MB | [___] MB |
| Network in | [___] Mbps | [___] Mbps |
| Network out | [___] Mbps | [___] Mbps |

---

## Anomalies / Notes

[Operator: write any unexpected behavior, errors, timeouts, OOM kills, or surprising metrics here]

---

## Operator's Overall Assessment

- [ ] **System is ready for 5,000 CCU production load.** All 15 criteria PASS.
- [ ] **System has minor gaps.** Specifically: [___]
- [ ] **System is not ready.** Critical gaps: [___]

---

*Generated by TingTingVac 5K CCU Benchmark Suite — ref: TTV-FB-5000CCU-2026-002*

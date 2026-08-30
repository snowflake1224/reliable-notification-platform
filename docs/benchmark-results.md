# Reliable Notification Platform — Benchmark Results

**Machine:** local Windows + Docker Compose  
**Date:** 2026-08-18 (UTC) / 2026-08-19 IST  
**Method:** `node load-tests/run-bench.mjs`  
**Target:** `http://localhost:8080` (Nginx → API ×2)  
**Stack at test time:** API ×2, Worker ×3, Scheduler ×1, PostgreSQL, Redis, Provider simulator, Prometheus, Grafana

These numbers were measured on a laptop Docker Compose setup. They are **not** production capacity. Re-run `node load-tests/run-bench.mjs` to refresh results on your machine. Raw dumps under `load-tests/results/` are gitignored; this file is the committed snapshot.

---

## Load profile

| Parameter | Value |
|---|---|
| Offered rate | 25 requests/second |
| Duration | 20 seconds |
| Concurrency | 20 in-flight client requests |
| Total intended submits | 500 |
| Channels | email / SMS / push (round-robin, **simulated** providers) |
| Failure injection | none (all-success provider) |
| Auth | demo tenant API key |

---

## Client-side accept results

| Metric | Value |
|---|---|
| Submitted | 500 |
| Accepted (HTTP 202) | 500 |
| Failed | 0 |
| Success rate | 100% |
| Client accept RPS | **25.00** |
| Accept latency p50 | **468.3 ms** |
| Accept latency p95 | **1011.6 ms** |
| Accept latency p99 | **1241.0 ms** |

Interpretation: the accept path kept up with the offered 25 RPS with no client failures. p95 accept latency was about 1 second on this laptop Compose setup.

---

## Prometheus snapshot — after load (+15s settle)

| Metric | Value |
|---|---|
| API requests/s | **25.60** |
| Notifications accepted/s | **12.28** |
| Worker jobs/s | **13.84** |
| Deliveries/s | **13.84** |
| Retries/s | 0 observed |
| Queue depth | **513** |
| Pending entries (PEL) | 0 |
| DLQ size | 0 |
| Outbox backlog | 0 |
| E2E latency p95 | **1.832 s** |
| Provider latency p95 | **0.151 s** |

Notes:

- `rate(...[30s])` averages over a scrape window that includes idle time around the burst, so “accepted/s” can read lower than the client’s pure 25 RPS.
- Client-side RPS (25.00) is the ground truth for the accept path during the active load window.
- Queue depth **513** with worker throughput **~14/s** shows delivery lagged accept: workers/provider were the bottleneck, not Nginx/API accept capacity.

---

## Bottleneck conclusion (this run)

1. **Accept path** sustained the offered **25 RPS** (500/500 accepted).
2. **Delivery path** processed roughly **14 jobs/s**, so the Redis stream queue grew (~513 depth).
3. **Provider p95 (~151 ms)** was modest; E2E p95 (~1.8 s) includes queueing + worker scheduling + DB updates.
4. **No retries / DLQ** under all-success provider mode.
5. **Outbox backlog stayed 0** — publication kept up; the backlog was in the stream after publish, not unpublished outbox rows.

Practical takeaway: scaling API replicas improves accept RPS; draining this queue needs more worker concurrency/instances or a faster provider path.

---

## How to reproduce

```bash
docker compose up --build -d
# wait until migrate has finished and APIs are ready
curl -s http://localhost:8080/health/ready
node load-tests/run-bench.mjs
```

Heavier profile example (PowerShell):

```powershell
$env:RATE="40"; $env:DURATION_SEC="30"; $env:CONCURRENCY="30"; node load-tests/run-bench.mjs
```

Dashboards:

- Grafana: http://localhost:3001 (admin / admin) → **Reliable Notification Platform**
- Prometheus: http://localhost:9090

Also see `docs/how-to-measure.md`.

---

## Resume-safe wording (from this run only)

- Load-tested notification acceptance locally at **25 RPS** for 20s (**500/500 HTTP 202**, accept p95 **~1.0 s**).
- Observed delivery throughput of about **14 jobs/s** with **3 workers**, with queue depth rising to **~513**, identifying workers/delivery—not accept—as the bottleneck under that offer load.
- Measured end-to-end p95 latency of about **1.8 s** and provider p95 of about **151 ms** with zero DLQ entries in the all-success run.

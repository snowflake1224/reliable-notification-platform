# Benchmarks

Measured numbers from one local Docker Compose run (2026-08-18) are in **[benchmark-results.md](benchmark-results.md)**. They are laptop figures, not production capacity. Re-run the commands below on your machine if you need fresh results.

## Recorded local run (2026-08-18)

| Metric | Value |
|---|---|
| Offered / accepted | **25 RPS**, **500/500 HTTP 202** |
| Accept p50 / p95 | **468 ms / 1.01 s** |
| Delivery throughput | **13.84 jobs/s** (3 workers) |
| Queue depth after load | **513** |
| End-to-end p95 | **1.832 s** |
| Provider p95 | **151 ms** |

**Conclusion from that run:** delivery lagged accept. Workers/provider were the bottleneck, not Nginx/API accept capacity.

Providers in this repo are **simulated** (optional MailHog for email). Do not claim Twilio, SendGrid, or FCM.

## Setup

```bash
docker compose up --build -d
# wait until migrate has finished and APIs are ready
curl -s http://localhost:8080/health/ready
```

Requires [k6](https://k6.io/) for the scripts below. The committed snapshot used `node load-tests/run-bench.mjs` (no k6 install).

## Scripts

| Script | What it stresses |
|---|---|
| `load-tests/k6/submit.js` | accept path + outbox + workers (all-success provider) |
| `load-tests/k6/failures.js` | mixed transient failures → retries / DLQ |
| `load-tests/k6/status.js` | smoke list + readiness |
| `load-tests/run-bench.mjs` | accept + Prometheus E2E snapshot used for the committed results |

```bash
node load-tests/run-bench.mjs
k6 run load-tests/k6/submit.js
RATE=40 DURATION=45s k6 run load-tests/k6/submit.js
k6 run load-tests/k6/failures.js
```

## What to write down

From k6:

- `http_reqs` → API throughput
- `http_req_duration` p50/p95 → accept latency
- `nplat_accept_fail` (custom) → non-202 rate

From Grafana / Prometheus while the test runs:

- `rate(nplat_worker_jobs_total[1m])` → worker throughput
- `nplat_queue_depth`, `nplat_queue_pending_entries`
- `rate(nplat_retries_total[1m])`, `nplat_dlq_size`
- `nplat_e2e_latency_seconds` histogram
- `nplat_postgres_latency_seconds`, `nplat_redis_latency_seconds`

## Worker-count experiment

1. Run `RATE=30 DURATION=60s k6 run load-tests/k6/submit.js` with 3 workers. Snapshot queue depth and worker rate.
2. `docker compose up -d --scale` is not wired (workers are named services). Stop `worker-3` (`docker compose stop worker-3`) and repeat, or add a `worker-4` service clone.
3. Compare: if queue depth grows after removing a worker and shrinks after adding one, workers were the bottleneck. If depth stays high and Postgres p95 climbs, stop adding workers.

## Provider failure run

`failures.js` sets `_test.failureMode=transient` on 25% of payloads (`ALLOW_TEST_FAILURES=true` in Compose). Expect retry count to rise and e2e latency to stretch by backoff. That is load on Postgres (extra updates) and the scheduler, not just the stream.

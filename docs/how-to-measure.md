# How to get performance numbers

Logs tell you *what happened*. Metrics tell you *how fast / how much*.

## 1. Live dashboard (easiest)

1. Open Grafana: http://localhost:3011 (admin / admin)
2. Open dashboard **Reliable Notification Platform**
3. Run load (section 3), then watch the panels update every ~5s

Key panels:

| Panel | Meaning |
|---|---|
| API requests /s | Accept-path throughput |
| Accepted notifications /s | Successful 202 creates |
| Queue depth | Work waiting in Redis Stream |
| Worker throughput | Jobs finished per second |
| Delivery outcomes | success / retry / dead |
| E2E / provider latency | How long delivery takes |

## 2. Prometheus instant queries

Open http://localhost:9093 → Graph, paste:

```promql
sum(rate(nplat_api_requests_total[1m]))
sum(rate(nplat_notifications_accepted_total[1m]))
sum(rate(nplat_worker_jobs_total[1m]))
sum(rate(nplat_deliveries_total[1m]))
max(nplat_queue_depth)
max(nplat_dlq_size)
histogram_quantile(0.95, sum(rate(nplat_e2e_latency_seconds_bucket[1m])) by (le))
```

## 3. One-command benchmark (no k6 install needed)

With Compose healthy:

```powershell
node load-tests/run-bench.mjs
```

Custom load:

```powershell
$env:RATE="40"; $env:DURATION_SEC="30"; $env:CONCURRENCY="30"; node load-tests/run-bench.mjs
```

It prints:

- client-side accept RPS + p50/p95/p99
- Prometheus snapshot before and after (queue depth, worker RPS, deliveries, retries, DLQ, e2e p95)

## 4. Optional k6 (if installed)

```powershell
k6 run load-tests/k6/submit.js
$env:RATE="40"; $env:DURATION="45s"; k6 run load-tests/k6/submit.js
```

## What “good” looks like locally

On a laptop Compose stack, expect:

- Accept RPS roughly near the offered `RATE` until Postgres/outbox saturates
- Queue depth should spike then fall once workers catch up
- With 3 workers healthy, delivery RPS should rise vs 1 worker
- If queue depth keeps climbing while workers are busy → workers/provider are the bottleneck
- If accept p95 climbs and outbox backlog rises → DB/dispatcher bottleneck

Do not put invented numbers on a resume. Copy the numbers this script prints after you run it.

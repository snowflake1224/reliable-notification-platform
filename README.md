# Reliable Notification Platform

Production-shaped asynchronous notification platform for an SDE-1 / early-SDE-2 backend portfolio.

The API never delivers a notification in the request path. It writes a notification and an outbox event in one PostgreSQL transaction. A dispatcher publishes to a Redis Stream. A worker consumer group delivers through simulated email / SMS / push providers. Signed webhooks update delivery history. Everything is tenant-isolated, idempotent at the important boundaries, and observable.

```
Client → Nginx → API → PostgreSQL (notification + outbox)
                         ↓
                   Outbox dispatcher
                         ↓
                   Redis Stream (consumer group)
                         ↓
                   Workers + Redis lock
                         ↓
                   Provider simulator → HMAC webhook → API
```

This is **at-least-once** delivery with **idempotent processing**. It is not exactly-once.

## Quick start

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| API (via Nginx) | http://localhost:8080 |
| Grafana | http://localhost:3001 (admin / admin) |
| Prometheus | http://localhost:9090 |
| MailHog UI | http://localhost:8025 |
| Provider simulator | http://localhost:4000 |

Local demo credentials (seeded, not for production):

- Tenant API key: `nplat_live_dev_demo_key_do_not_use_in_prod`
- Admin: `admin@nplat.local` / `admin-dev-password`

```bash
curl -s http://localhost:8080/v1/notifications \
  -H "x-api-key: nplat_live_dev_demo_key_do_not_use_in_prod" \
  -H "idempotency-key: demo-1" \
  -H "content-type: application/json" \
  -d '{"userId":"user-1","type":"order.shipped","channel":"email","payload":{"name":"Ada","orderId":"42"}}'
```

## Repository layout

```
apps/api                 stateless HTTP API + outbox dispatcher
apps/worker              Redis Streams consumer group
apps/scheduler           due / retry enqueue (send_at)
apps/provider-simulator  email / SMS / push + HMAC webhooks + MailHog
packages/shared          DB, queue, locks, metrics, state machine
infra/                   Nginx, Prometheus, Grafana, Docker
docs/                    architecture and interview notes
tests/                   Vitest + Testcontainers
load-tests/k6            reproducible k6 scripts
```

## Why this shape

Synchronous delivery inside `POST /notifications` couples accept latency to provider latency, loses work on API crash, and cannot retry independently. PostgreSQL cannot atomically commit a row and an `XADD`. The outbox is the integration so the database remains the source of truth and publication is retried until it succeeds.

Redis Streams are used instead of BullMQ so the consumer-group, PEL, ack, and `XCLAIM` semantics are visible in this repo. BullMQ would be a reasonable production wrapper over the same Redis ideas; see [docs/queue-design.md](docs/queue-design.md).

## Commands

```bash
npm install
npm test
npm run typecheck
k6 run load-tests/k6/submit.js
k6 run load-tests/k6/failures.js
```

Compose starts two API instances, three workers, one scheduler, Postgres, Redis, Nginx, the provider simulator, Prometheus, Grafana, and MailHog.

## Documentation

- [Architecture](docs/architecture.md)
- [Database schema](docs/database-schema.md)
- [Queue design](docs/queue-design.md)
- [Transactional outbox](docs/outbox.md)
- [State machine](docs/state-machine.md)
- [Retry and idempotency](docs/retry-and-idempotency.md)
- [Scheduling](docs/scheduling.md)
- [Failure modes](docs/failure-modes.md)
- [Observability](docs/observability.md)
- [Scaling](docs/scaling.md)
- [Benchmarks](docs/benchmarks.md)
- [Measured local results](docs/benchmark-results.md)
- [Testing](docs/testing.md)
- [Interview questions](docs/interview-questions.md)

One local Docker Compose run (2026-08-18) is recorded in `docs/benchmark-results.md` (25 RPS, 500/500 accepted, ~14 deliveries/s, ~1.8 s E2E p95). Those are laptop numbers; do not invent additional figures. Re-run with `node load-tests/run-bench.mjs`.

Quick local numbers (no k6 needed):

```bash
node load-tests/run-bench.mjs
```

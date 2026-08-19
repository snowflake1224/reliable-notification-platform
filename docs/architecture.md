# Architecture

## Request path

```
Client
  → Nginx (least_conn across api-1, api-2)
    → API instance (stateless)
      → BEGIN
         INSERT notifications (pending)
         INSERT outbox_events (pending)     # immediate sends only
         INSERT idempotency_records
      → COMMIT
      → 202 Accepted
```

The HTTP handler never calls a provider. That is the whole point: accept latency stays a database write, providers can fail independently, and workers scale separately from the API.

## Async path

```
Outbox dispatcher (runs in each API process)
  → SELECT … FOR UPDATE SKIP LOCKED
  → status = publishing
  → XADD nplat:jobs
  → status = published
  → notification pending|retrying → queued

Worker consumer group
  → XREADGROUP
  → Redis lock nplat:lock:notif:{id}
  → conditional UPDATE → processing
  → provider adapter (timeout / transient / permanent / rate limit)
  → delivered | retrying | dead
  → XACK   (retries are re-enqueued later, not left to retry-storm the PEL)

Provider simulator
  → optional MailHog SMTP for email
  → HMAC webhook POST /v1/webhooks/:provider
  → webhook_events unique (provider, provider_event_id)
```

Scheduled notifications skip the outbox on accept. The scheduler inserts the outbox row when `send_at <= now()`. Retries do the same when `next_attempt_at <= now()`.

## Processes

| Process | State | Why it exists |
|---|---|---|
| API × N | stateless | accept, auth, read models, webhooks, outbox publish |
| Worker × N | stateless | consume stream, call providers |
| Scheduler × 1+ | stateless | due scan; Redis lock + SKIP LOCKED |
| Provider simulator | ephemeral | realistic failure modes without Twilio/SendGrid |
| PostgreSQL | durable source of truth | notifications, outbox, attempts, audit |
| Redis | ephemeral / distributed | stream, locks, rate limits |
| Nginx | LB | hide instance count from clients |
| Prometheus / Grafana | observe | SLIs, not business logic |

There is no extra “queue service.” Redis Streams *are* the queue. Kafka is omitted on purpose: it would add operational weight without changing the outbox or idempotency lessons.

## Consistency model

- **Strong** for accept + idempotency (one Postgres transaction).
- **Eventual** for “accepted → delivered.” The UI must read `notifications.status`, not assume the 202 means the email arrived.
- **At-least-once** from outbox to worker: publish can be retried; PEL reclaim redelivers.
- **Effectively-once processing** via unique keys, conditional state updates, and provider idempotency keys.

## Auth

- Tenant API keys: `nplat_live_…`, stored as prefix + SHA-256(pepper ∥ key), revocable and rotatable.
- Admin JWT (HS256) for `/admin/*` only. Tenant keys cannot call admin routes.

## What is intentionally not here

Kubernetes, Kafka, multi-region replication, real ESPs/SMS/push vendors, and a product UI. The Compose stack is the reproducible local production shape.

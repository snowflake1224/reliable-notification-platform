# Retry and idempotency

## Delivery guarantees (use these words in interviews)

- **At-most-once:** publish or process without retry. Lose messages on crash. We do not do this on the delivery path.
- **At-least-once:** retry until ack. Duplicates possible. This is the queue/outbox contract.
- **Exactly-once:** requires a single atomic commit spanning all side effects (DB + provider + queue). Network providers do not offer that. **Do not claim it.**
- **Effectively-once / idempotent processing:** at-least-once transport + idempotent handlers so duplicates do not double-send in the common case.

## Idempotency boundaries

| Boundary | Mechanism |
|---|---|
| Repeated `POST /v1/notifications` | `Idempotency-Key` + `idempotency_records` (hash of canonical body). Same key + same body → stored response. Same key + different body → 409. |
| Duplicate stream delivery | Terminal status → ack. Redis lock. Conditional `queued→processing`. |
| Worker crash after provider accept | Provider stores `x-idempotency-key = notificationId`. Replay returns the same `providerMessageId`. |
| Provider timeout after accept | Same as above; webhook may also mark `delivered`. |
| Duplicate webhook | `UNIQUE (provider, provider_event_id)` + `ON CONFLICT DO NOTHING`. |
| Worker restart | PEL reclaim + idempotent `processJob`. |

## Retry policy

Implemented in `packages/shared/src/retry.ts` and the worker:

- Classify: success / transient (5xx, 408, 429, timeout, network, rate limit) / permanent (most 4xx).
- Exponential backoff with **full jitter**: `sleep = random(0, min(max, base * 2^(attempt-1)))`.
- Cap: `max_attempts` (default 5, column on the row).
- Durable state: `status = retrying`, `next_attempt_at`, `delivery_attempts` row.
- After exhaustion or permanent error: `dead` + DLQ stream.

Jitter exists so a provider outage does not produce a synchronized retry thundering herd.

## Why retry state is in Postgres

If backoff lived only in the worker process, a restart would either drop the retry or retry immediately. Postgres is what survives process death. Redis Streams are the *transport*, not the policy.

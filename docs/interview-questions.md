# Interview questions and answers

Answers match this codebase. Do not claim exactly-once delivery.

---

**Why not send the email inside `POST /notifications`?**

Accept latency becomes provider latency. A timeout looks like a client failure even if the provider sent. An API crash after SendGrid accepted but before you wrote “sent” loses or double-sends. You cannot scale senders independently of the accept tier. This API writes Postgres and returns 202.

**Why a queue?**

To decouple accept from deliver, absorb spikes, retry independently, and run N workers. The queue is Redis Streams; the *policy* (backoff, max attempts) lives in Postgres.

**Why the outbox? Why not `INSERT` then `XADD` in the handler?**

Those are two systems. If `XADD` fails after commit, the notification exists and never moves. If you `XADD` before commit and then roll back, the worker processes a ghost. The outbox makes “I intend to publish this” durable in the same commit as the notification.

**Why can’t Postgres and Redis be one transaction?**

No shared commit coordinator in this stack (and 2PC across a cache/broker is rarely what you want). You choose a source of truth (Postgres) and make publication retryable.

**At-least-once vs at-most-once vs exactly-once?**

At-most-once: fire and forget, drop on crash. At-least-once: retry until ack, duplicates happen. Exactly-once: one atomic side effect across all systems — not available once a third-party provider is involved. We do at-least-once + idempotent handlers (effectively-once).

**Where is idempotency enforced?**

API key+body hash, unique idempotency key, worker lock, conditional status updates, provider `notificationId:attempt`, webhook `(provider, event_id)`.

**How do retries not become a retry storm?**

Full jitter, ack-then-reenqueue via `next_attempt_at` instead of hot-looping the PEL, max attempts, channel rate limits, outbox backlog cap.

**What is a DLQ for?**

Poison / permanent / exhausted messages so they stop blocking the hot path. Inspect `nplat:jobs:dlq` and `status = 'dead'`.

**What is a PEL / visibility timeout?**

`XREADGROUP` gives you a message; until `XACK` it stays pending for that consumer. If the consumer dies, `XPENDING` + `XCLAIM` after idle ≥ visibility timeout hands it to someone else. Redis does not auto-timeout PEL entries; we implement that.

**Why Redis locks if you have consumer groups?**

Groups partition *messages*. Two messages can still name the same `notificationId` (duplicate publish, retry + reclaim). The lock serializes the *aggregate*. The lock has a TTL so a crashed holder does not deadlock. We do not use an in-process mutex.

**What if the lock expires while the provider call is in flight?**

Another worker may start. Conditional SQL and provider idempotency keys make a double *successful* send unlikely; a double *attempt* is possible (at-least-once). Webhooks are deduped.

**Eventual consistency?**

Client sees 202 and `pending`. Delivery is later. Read models must tolerate `queued` / `processing` / `retrying`.

**Provider failures?**

Normalized `success | transient | permanent | timeout | rate_limited`. Transient → retry. Permanent → dead. Timeout treated transient because the provider may have accepted.

**Backpressure?**

503 when outbox backlog exceeds `MAX_OUTBOX_BACKLOG`. Token buckets on API tenants and channels. Worker concurrency caps in-flight provider calls.

**How do you scale?**

More API replicas for accept+dispatch. More workers in the same group for delivery. Split streams if one Redis stream or one tenant dominates. Watch which metric moves first (see `scaling.md`).

**Database bottlenecks?**

Hot `UPDATE notifications` rows, outbox claim contention (mitigated by `SKIP LOCKED`), pool exhaustion, missing `(tenant_id, …)` indexes. Accept QPS is a write-QPS problem.

**Redis down?**

Accept can continue until backlog cap. Workers stop. After Redis returns, dispatchers `XADD` unpublished outbox rows. A wiped stream is not a wiped outbox. A wiped Redis *after* publish-and-ack can lose queued-but-unprocessed messages unless you backfill — say this out loud.

**SLOs / capacity?**

SLO on e2e accept→delivered, not on 202-only. Capacity plan: target a max queue depth and p95 e2e; add workers until the next bottleneck (provider RPS or Postgres) appears. Measure with k6 + Grafana; do not invent numbers.

**Nginx?**

Two API containers, `least_conn`. Clients see one origin. Request id forwarded.

**Multi-tenant isolation?**

Shared DB, `tenant_id` on every tenant row, unique keys scoped by tenant, API auth binds the key to a tenant, queries always filter `tenant_id`.

**Scheduled send vs cron?**

`send_at` is a column. Scheduler is a due scanner, not an in-memory `setTimeout`. Restarts and dual schedulers are handled with locks + `SKIP LOCKED` + unique inflight outbox.

**Why TypeScript/Node rather than Java/Go?**

Portfolio constraint. The patterns (outbox, consumer groups, conditional updates) are language-independent; be ready to map them to the interviewer’s stack.

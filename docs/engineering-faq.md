# Engineering FAQ

## 1. Why return `202` with a Transactional Outbox instead of pushing directly to Redis inside the HTTP handler?

If `POST /v1/notifications` committed to PostgreSQL and then called Redis `XADD`, a crash or network blip between those two steps would leave a committed `"pending"` row that never enters the stream. Conversely, pushing to Redis before committing could let a worker read a notification that doesn't exist if Postgres rolls back. Writing `notifications`, `outbox_events`, `audit_events`, and `idempotency_records` in **one ACID transaction** makes durability and enqueue intent atomic.

## 2. How do you guarantee a retry never sends a second email?

Three coordinated defenses:
1. **Ingress (`Idempotency-Key`):** `idempotency_records` stores `request_hash = sha256(user, type, payload)`. Identical retries replay the original `202` body; altered bodies get `409 Conflict`.
2. **Worker (`Redis SET NX PX` + CAS DB update):** Only one worker holds `nplat:lock:notif:<id>`, checked out with an instance token and released atomically via `UNLOCK_LUA`.
3. **Provider idempotency key:** Workers pass `notificationId` as the provider's idempotency key. Even if a worker crashes *after* SMTP delivery and *before* saving `submitted` (triggering PEL `XCLAIM`), the provider returns the original `providerMessageId` instead of sending twice.

## 3. Why is delivery called "at-least-once" if idempotency prevents duplicate emails?

Transport delivery between the Redis stream and workers is **at-least-once**: visibility timeouts (`XCLAIM`) and crashes can cause two workers to execute the same job over time. Making the *end effect* look like once-only delivery requires idempotent state transitions on the Postgres side (`status`, `version`) **and** idempotency support from the downstream provider.

## 4. How do multiple API instances poll the same outbox without double-publishing?

`claimOutboxBatch` uses `SELECT id FROM outbox_events ... ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED` inside an `UPDATE ... FROM cte`. Each dispatcher grabs disjoint rows without waiting on locks held by sibling instances. If a dispatcher crashes mid-publish (`status = 'publishing'`), rows become reclaimable after `outboxClaimTimeoutMs`.

## 5. Why keep `retrying` scheduling in Postgres + a Scheduler process instead of Redis `ZSET` delay queues?

Keeping `next_attempt_at` in PostgreSQL keeps all authoritative retry state durable across Redis restarts and lets the existing partial unique index (`idx_outbox_one_inflight`) prevent duplicate inflight outbox jobs. The single-active-tick scheduler holds a short Redis distributed lock (`scheduler:scan`) and uses `FOR UPDATE SKIP LOCKED` to move due notifications back into `outbox_events`.

## 6. What are the known security or scaling limits you'd change for production?

- **Webhook authentication:** Replace the shared `x-webhook-secret` header check (`apps/api/src/routes/webhooks.ts`) with HMAC-SHA256 signature verification (`t=<timestamp>, v1=<hmac>`) and a tight timestamp tolerance window.
- **Outbox polling vs CDC:** Polling every `outboxPollMs` works well at moderate throughput; at 10x–100x scale, tailing Postgres WAL with Debezium / logical replication removes polling queries entirely.
- **Channel / priority isolation:** Currently one `nplat:jobs` stream serves all tenants and priorities; high-volume noisy tenants can starve critical transactional alerts unless split into priority streams or per-tenant fair-scheduling queues.
- **Database partitioning:** Partition `notifications`, `delivery_attempts`, and `audit_events` by `created_at` month so old partitions can drop cleanly without vacuum bloat.

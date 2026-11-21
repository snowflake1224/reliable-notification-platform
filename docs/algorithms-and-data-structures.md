# Algorithms, Concurrency & State Guarantees

## 1. Exponential Backoff with Full Jitter

Implemented in `packages/shared/src/retry.ts` (`computeBackoffMs`):

$$\text{cap} = \min(\text{maxMs},\; \text{baseMs} \times 2^{\max(0,\; \text{attempt} - 1)})$$

With `jitterRatio = 1` (used in `apps/worker/src/processor.ts` with `baseMs = 500`, `maxMs = 30_000`):

$$\text{delayMs} = \lfloor U(0, 1) \times \text{cap} \rfloor$$

- **Why Full Jitter:** AWS-style full jitter spreads retried jobs uniformly across `[0, cap]` instead of clumping at exact exponential steps (`500 ms`, `1 s`, `2 s`, ...), preventing synchronized retry storms when an upstream email provider recovers from an outage.
- **Rate-Limit Override (`429 Retry-After`):** When the provider returns `rate_limited` with an explicit `retryAfterMs`, `scheduleRetry` clamps it to `[1, 120_000]` ms instead of computing jittered backoff.
- **HTTP Status Classification (`classifyHttpStatus`):** `2xx -> success`, `408 | 429 | >= 500 -> transient`, other `4xx -> permanent`.

## 2. Atomic Redis Distributed Lock with Ownership Token

Implemented in `packages/shared/src/locking/lock.ts`:

- **Acquire (`O(1)`):** `SET nplat:lock:notif:<id> <workerId> PX <visibilityTimeoutMs> NX`. Only succeeds if no holder exists.
- **Release (`UNLOCK_LUA`, `O(1)`):**

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
```

Checking `GET == token` atomically inside Lua guarantees that a stalled Worker A (whose lock expired past `visibilityTimeoutMs`) cannot accidentally delete Worker B's freshly acquired lock when Worker A's `finally` block finally runs.

## 3. Outbox & Retry Queue Fairness (`FOR UPDATE SKIP LOCKED`)

Both `claimOutboxBatch` and `claimDueRetries` use PostgreSQL row-level locking with `SKIP LOCKED`:

- **Time Complexity:** `O(batchSize log N)` via partial indexes `idx_outbox_claim` (`WHERE status IN ('pending', 'publishing')`) and `idx_notif_retry` (`WHERE status = 'retrying'`).
- **Why `SKIP LOCKED`:** Multiple API instances or failover dispatchers never block waiting on each other's uncommitted batch locks; disjoint batches flow concurrently with zero double-publishing.
- **One In-Flight Outbox Invariant:** Partial unique index `idx_outbox_one_inflight ON outbox_events (aggregate_id) WHERE status IN ('pending', 'publishing')` guarantees at the database layer that scheduler retries or admin replays cannot enqueue two concurrent outbox jobs for the same notification.

## 4. State Machine & Monotonic Terminal Guard

Enforced in `packages/shared/src/stateMachine.ts`:

- `ALLOWED` transitions:
  - `pending -> queued | dead`
  - `queued -> processing | dead`
  - `processing -> submitted | retrying | dead`
  - `submitted -> delivered | dead`
  - `retrying -> queued | dead`
  - `delivered -> []` *(terminal)*
  - `dead -> []` *(terminal)*
- Combined with `version = version + 1` and `WHERE status IN (...)` on every SQL update, stale workers or out-of-order webhooks cannot regress a `delivered` or `dead` notification.

## 5. Request Payload Canonical Hashing

`notificationService.ts` computes `sha256(JSON.stringify({ user, type, payload }))` before inserting `idempotency_records`. Reusing an `Idempotency-Key` with the exact same normalized tuple replays the saved `202` response (`"replay": true`), while changing recipient, type, or payload raises `409 ConflictError`.

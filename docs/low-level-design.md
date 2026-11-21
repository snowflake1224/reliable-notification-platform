# Low-Level Design (LLD)

## Module Map

| Path | Role | Key Exports / Responsibilities |
| --- | --- | --- |
| `apps/api/src/services/notificationService.ts` | Ingestion orchestration | `createNotification` — SHA-256 request digest, `FOR UPDATE` idempotency lookup, template render, atomic insert of `notifications` + `outbox_events` + `audit_events` + `idempotency_records`. |
| `apps/api/src/routes/notifications.ts` | Tenant Notification API | `POST /v1/notifications`, `GET /v1/notifications/:id`, audit & attempt inspection routes. |
| `apps/api/src/routes/webhooks.ts` | Provider status callback | `POST /v1/webhooks/email` — verifies `x-webhook-secret`, inserts `webhook_events` (`ON CONFLICT DO NOTHING`), transitions non-terminal rows to `delivered` or `dead`. |
| `apps/api/src/routes/admin.ts` | Admin control plane | JWT auth, tenant creation, API key create/revoke, **transactional** API key rotation (`withTransaction`), outbox stats, stuck-notification replay, Redis queue/DLQ stats. |
| `apps/api/src/routes/home.ts` | Service root | JSON readiness info or HTML architecture overview (`GET /`). |
| `packages/shared/src/outbox/dispatcher.ts` | Outbox publisher loop | `OutboxDispatcher` — `claimOutboxBatch`, `publishJob` (`XADD`), `markOutboxPublished`, `markOutboxFailed` (`attempts >= 20` marks `'failed'`). |
| `packages/shared/src/db/queries.ts` | Core SQL primitives | `claimOutboxBatch` (`FOR UPDATE SKIP LOCKED`), `transitionNotification` (optimistic `version` check), `claimDueRetries`, `insertAudit`, `insertOutbox`. |
| `packages/shared/src/locking/lock.ts` | Distributed Redis lock | `acquireLock` (`SET key token PX ttl NX`), `DistributedLock.release` (`UNLOCK_LUA`), `DistributedLock.extend` (`EXTEND_LUA`). |
| `packages/shared/src/stateMachine.ts` | Lifecycle rules | `ALLOWED` state transitions, `canTransition`, `assertTransition`, `isTerminal`, `isClaimable`. |
| `packages/shared/src/retry.ts` | Backoff & error triage | `computeBackoffMs` (exponential backoff + jitter), `nextAttemptAt`, `classifyHttpStatus`. |
| `apps/worker/src/processor.ts` | Job processor | `processJob` — Redis lock -> terminal/claimable guard -> conditional `processing` update -> `delivery_attempts` insert -> `sendToProvider` -> `submitted` / `scheduleRetry` / `moveToDead`. |
| `apps/worker/src/reclaim.ts` | PEL recovery | `reclaimStale` — `listStalePending` (`XPENDING`) + `claimMessages` (`XCLAIM`) after `VISIBILITY_TIMEOUT_MS`. |
| `apps/scheduler/src/index.ts` | Retry scheduler | `tick` — acquires `scheduler:scan` lock, `claimDueRetries`, checks `outbox_events` (`pending`/`publishing`) for existing inflight row, inserts retry outbox row. |

## Critical Execution Paths

### 1. Transactional Accept (`createNotification`)

```text
POST /v1/notifications (x-api-key, idempotency-key)
  └─ withTransaction(pool):
       1. SELECT ... FROM idempotency_records WHERE tenant_id=$1 AND key=$2 FOR UPDATE
            ├─ Hit & request_hash != sha256 -> 409 ConflictError
            └─ Hit & request_hash == sha256 -> return stored 202 body (replay: true)
       2. Lookup user (tenant_id, external_id), notification_type, published email template
       3. Render subject & body with {{variable}} template helper
       4. INSERT INTO notifications (...) VALUES (..., 'pending', ...) ON CONFLICT DO NOTHING
       5. INSERT INTO outbox_events (event_type='notification.requested')
       6. INSERT INTO audit_events (action='accepted', to_status='pending')
       7. INSERT INTO idempotency_records (response_status=202, response_body, notification_id)
  └─ COMMIT -> return HTTP 202
```

### 2. Multi-Dispatcher Outbox Polling (`claimOutboxBatch`)

Multiple API replicas run `OutboxDispatcher` concurrently without colliding because `claimOutboxBatch` runs:

```sql
WITH cte AS (
  SELECT id FROM outbox_events
  WHERE available_at <= now()
    AND (
      status = 'pending'
      OR (status = 'publishing' AND claimed_at < now() - ($3 * interval '1 millisecond'))
    )
  ORDER BY created_at
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events o
SET status = 'publishing', claimed_at = now(), claimed_by = $1, attempts = o.attempts + 1
FROM cte
WHERE o.id = cte.id
RETURNING o.*;
```

If an API crashes after marking a row `publishing` and before `XADD`, another dispatcher reclaims it once `claimed_at` ages past `outboxClaimTimeoutMs`.

### 3. Worker Lock & Conditional Status Transitions

1. `acquireLock(redis, "notif:" + id, workerId, visibilityTimeoutMs)` runs `SET key token PX ttl NX`. If held by another worker, `processJob` returns `"retry_later"` (does not `XACK`).
2. `isTerminal(notification.status)` returns early and `XACK`s duplicate deliveries (`delivered` or `dead`).
3. The worker executes an atomic SQL `UPDATE notifications SET status = 'processing', attempt_count = attempt_count + 1, version = version + 1 ... WHERE id = $1 AND tenant_id = $2 AND status IN ('queued', 'retrying', 'pending', 'processing')`.
4. Only if `status = 'processing'` when the provider responds 2xx does it advance to `submitted`.
5. `finally` runs `UNLOCK_LUA` so only the lock holder token deletes `nplat:lock:notif:<id>`.

### 4. Admin API Key Rotation Fix (`apps/api/src/routes/admin.ts`)

`POST /admin/tenants/:id/api-keys/:keyId/rotate` executes both the old-key `UPDATE ... SET revoked_at = now()` and the new-key `INSERT INTO tenant_api_keys` inside `withTransaction`. If the key ID is unknown or already revoked, the transaction rolls back with `404 NotFoundError`, preventing orphan rotated keys.

## Failure Modes & Recovery Matrix

| Failure Scenario | Mechanism | System Outcome |
| --- | --- | --- |
| Client times out before reading 202 & retries | `idempotency_records` + `request_hash` | Returns original `202` payload with `"replay": true`; 0 extra emails. |
| Client reuses `Idempotency-Key` with changed body | `request_hash !== sha256` | Throws `409 ConflictError`. |
| API dies right after 202 commit | Unclaimed `outbox_events` row (`pending`) | Surviving API dispatcher picks it up within `outboxPollMs`. |
| Worker crashes mid-send | Stream PEL + `XCLAIM` (`reclaimStale`) + lock TTL | After `visibilityTimeoutMs`, another worker reclaims & calls provider with same `idempotencyKey`. |
| Provider succeeds, worker dies before saving `submitted` | Provider idempotency cache on `notificationId` | Second worker receives original `providerMessageId` without sending a second SMTP message. |
| Provider returns 429 / 5xx / timeout | `scheduleRetry` sets `retrying` + `next_attempt_at` | `apps/scheduler` re-inserts into `outbox_events` once due, up to `max_attempts`. |
| Permanent error (4xx) or `attempt_count >= max_attempts` | `moveToDead` sets `dead` + `publishDlq` | Job recorded in `nplat:jobs:dlq`; requires manual inspection or replay. |

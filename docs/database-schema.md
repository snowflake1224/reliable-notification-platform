# Database schema

PostgreSQL is the durable source of truth. Redis can vanish; after a restart the outbox dispatcher republishes unpublished events.

## Tenancy

Every tenant-owned table has `tenant_id` with a foreign key to `tenants`. Lookups used by the API always include `tenant_id` in `WHERE`. Unique keys are tenant-scoped (`(tenant_id, external_id)`, `(tenant_id, idempotency_key)`, `(tenant_id, key)`).

## Tables

| Table | Role |
|---|---|
| `tenants` | tenant registry (`active` / `suspended`) |
| `tenant_api_keys` | hashed, prefixed, revocable keys |
| `admin_users` | scrypt password hashes for JWT login |
| `users` | recipients (`external_id` is the tenant’s user id) |
| `notification_types` | `order.shipped`, category transactional/marketing |
| `templates` | per type × channel |
| `template_versions` | versioned body; one published version per template |
| `user_preferences` | opt-in per type × channel |
| `notifications` | lifecycle aggregate |
| `delivery_attempts` | durable per-try history |
| `outbox_events` | transactional publication buffer |
| `webhook_events` | provider event-id dedup |
| `audit_events` | state / actor history |
| `idempotency_records` | API replay cache |

## Constraints that encode invariants

- `UNIQUE (tenant_id, idempotency_key)` on `notifications` — one logical send per key.
- `UNIQUE (notification_id, attempt_number)` on `delivery_attempts`.
- `UNIQUE (provider, provider_event_id)` on `webhook_events`.
- Partial unique index: one published `template_versions` row per template.
- Partial unique index: at most one `pending`/`publishing` outbox row per notification. Concurrent schedulers cannot enqueue twice.
- Status CHECKs match the state machine.

## Indexes (why they exist)

- `notifications (tenant_id, status)` and `(tenant_id, created_at DESC)` — tenant list/detail.
- Partial `send_at` where `status = 'pending'` — scheduler due scan.
- Partial `next_attempt_at` where `status = 'retrying'` — retry scan.
- Partial outbox `(available_at)` where pending/publishing — dispatcher claim.
- API key `(key_prefix)` where not revoked — constant-time-ish lookup then hash compare.

## Conditional updates

Workers never do `SET status = 'delivered'` blindly. They use:

```sql
UPDATE notifications
SET status = 'delivered', version = version + 1
WHERE id = $1 AND tenant_id = $2 AND status = 'processing'
```

A stale worker cannot move `delivered` back to `processing`. Version increments on every successful transition.

## Transactions

Accept path: notification + outbox + idempotency row in one `BEGIN/COMMIT`. If the API crashes after commit, the client may retry with the same idempotency key and receive the stored 202. If the process crashes before `XADD`, the dispatcher still sees the outbox row.

Provider calls are **outside** the accept transaction. Holding a DB transaction open across a network call is how you stall the pool and take down the API.

## Connection pooling

Each process uses `pg.Pool` (`DATABASE_POOL_MAX`, default 10) plus `statement_timeout`. Two APIs + three workers + scheduler ≈ 60 connections; stay under Postgres `max_connections`.

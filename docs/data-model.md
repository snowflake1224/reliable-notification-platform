# Data Model (PostgreSQL)

Defined across `packages/shared/migrations/001_init.sql` and `002_submitted_status.sql`.

## Core Tables

| Table | Purpose | Key Constraints & Indexes |
| --- | --- | --- |
| `tenants` | Isolated tenant organizations (`active` / `suspended`) | `slug UNIQUE` |
| `tenant_api_keys` | Hashed tenant API keys (`key_prefix` + `key_hash`) | Partial index `idx_api_keys_prefix (key_prefix) WHERE revoked_at IS NULL` |
| `admin_users` | Console/admin login accounts (bcrypt/scrypt password hash) | `email UNIQUE` |
| `users` | Tenant-scoped recipients (`external_id`, `email`) | `UNIQUE (tenant_id, external_id)` |
| `notification_types` | Named notification categories (`transactional` / `marketing`) | `UNIQUE (tenant_id, key)` |
| `templates` | Channel templates linked to `notification_types` | `UNIQUE (tenant_id, notification_type_id, channel)` |
| `template_versions` | Versioned subject/body with draft/published lifecycle | `UNIQUE (template_id, version)`, partial unique `idx_template_one_published WHERE status = 'published'` |
| `notifications` | Core notification ledger & optimistic `version` counter | `UNIQUE (tenant_id, idempotency_key)`, partial `idx_notif_retry (next_attempt_at) WHERE status = 'retrying'` |
| `outbox_events` | Transactional outbox rows polled by dispatchers | Partial `idx_outbox_claim`, partial unique `idx_outbox_one_inflight ON (aggregate_id) WHERE status IN ('pending', 'publishing')` |
| `idempotency_records` | Saved HTTP response + `request_hash` per `(tenant_id, key)` | `UNIQUE (tenant_id, key)` |
| `delivery_attempts` | Per-attempt latency, worker ID, error code/class | `UNIQUE (notification_id, attempt_number)` |
| `webhook_events` | Provider callback deduplication log | `UNIQUE (provider, provider_event_id)` |
| `audit_events` | Append-only audit trail of state changes & replays | `idx_audit_notif (tenant_id, notification_id, created_at DESC)` |

## Historical Schema Compatibility Note

`001_init.sql` was retained intact for backward database compatibility after the platform was narrowed to **email-only**:

- Columns `users.phone`, `users.push_token`, `notifications.send_at`, and table `user_preferences` exist in the base DDL, as do `sms`/`push`/`cancelled` `CHECK` options.
- Active application code (`createNotification` and `webhookRoutes`) restricts all writes and template lookups strictly to `channel = 'email'` and immediate outbox queuing.

# State machine

```
pending ──► queued ──► processing ──► delivered
   │                      │
   │                      ├──► retrying ──► queued ──► processing …
   │                      └──► dead
   └──► cancelled          (marketing opt-out)
```

Allowed transitions are in `packages/shared/src/stateMachine.ts`. Terminal: `delivered`, `dead`, `cancelled`.

## Who moves what

| From | To | Actor |
|---|---|---|
| (insert) | `pending` | API transaction |
| `pending` | `cancelled` | API (marketing opt-out) |
| `pending` / `retrying` | `queued` | Outbox dispatcher after `XADD` |
| `queued` / `retrying` / `pending` | `processing` | Worker conditional update |
| `processing` | `delivered` | Worker (provider success) or webhook |
| `processing` | `retrying` | Worker (transient / timeout / rate limit) |
| `processing` | `dead` | Worker (permanent or max attempts) |

## Stale workers

A worker that pauses for longer than the lock TTL can lose the lock. When it later writes, the `WHERE status = 'processing'` (or `IN ('queued',…)`) matches zero rows. It cannot set `delivered → processing`.

`version` increments on each successful update so lost updates are visible in audit/debug.

## Reading status

`GET /v1/notifications/:id` is the source of truth the client should poll. `202` means “accepted,” not “delivered.”

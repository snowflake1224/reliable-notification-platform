# State machine

```
pending ──► queued ──► processing ──► submitted ──► delivered
   │                      │                │
   │                      ├──► retrying    └──► dead (bounce/failure webhook)
   │                      └──► dead
   └──► cancelled
```

Allowed transitions are in `packages/shared/src/stateMachine.ts`. Terminal: `delivered`, `dead`, `cancelled`.

## Who moves what

| From | To | Actor |
|---|---|---|
| (insert) | `pending` | API transaction |
| `pending` | `cancelled` | API (marketing opt-out) |
| `pending` / `retrying` | `queued` | Outbox dispatcher after `XADD` |
| `queued` / `retrying` / `pending` | `processing` | Worker conditional update |
| `processing` | `submitted` | Worker after the provider accepts the message |
| `submitted` | `delivered` | Signed provider delivery webhook |
| `submitted` | `dead` | Signed provider bounce/failure webhook |
| `processing` | `retrying` | Worker (transient / timeout / rate limit) |
| `processing` | `dead` | Worker (permanent or max attempts) |

## Stale workers

A worker that pauses for longer than the lock TTL can lose the lock. When it later writes, the conditional update matches zero rows. It cannot move `submitted`, `delivered`, or `dead` back to `processing`.

`version` increments on each successful update so lost updates are visible in audit/debug.

## Reading status

`GET /v1/notifications/:id` is the source of truth the client should poll. `202` means the database accepted the notification. `submitted` means the provider accepted it. Only a signed `delivered` webhook produces `delivered`.

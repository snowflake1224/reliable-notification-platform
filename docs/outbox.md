# Transactional outbox

Postgres commit and Redis `XADD` are not one transaction. A two-step “insert then publish” loses messages when the process dies between them, or duplicates them when publish succeeds and the process dies before you record that fact.

## Write path

In one transaction the API inserts:

1. `notifications` (`pending`)
2. `outbox_events` (`pending`) — only if `send_at` is due now
3. `idempotency_records`

Then it returns 202. Publication is someone else’s job.

## Dispatcher

Each API process runs `OutboxDispatcher`:

1. Claim a batch with `FOR UPDATE SKIP LOCKED` where
   - `status = 'pending' AND available_at <= now()`, or
   - `status = 'publishing' AND claimed_at` older than `OUTBOX_CLAIM_TIMEOUT_MS` (crashed publisher)
2. Set `publishing`, `claimed_by`, increment `attempts`
3. `XADD`
4. `published` + move notification `pending|retrying → queued`

`SKIP LOCKED` lets concurrent dispatchers (two API containers) split the backlog without blocking each other.

## Failure cases the dispatcher is built for

| Event | What happens |
|---|---|
| DB commit OK, process dies before `XADD` | Row stays `pending` or stale `publishing`; next claim publishes |
| `XADD` OK, process dies before `published` | Stale `publishing` is reclaimed; `XADD` runs again (duplicate stream message; worker is idempotent) |
| Redis down | Claimed rows go back to `pending` with a short delay; backlog metric rises; API 503s if backlog exceeds cap |
| Two dispatchers | `SKIP LOCKED` + one inflight outbox per notification |

There is no “insert then hope.” Unpublished work is durable in Postgres.

## Why not listen/notify or CDC only?

`LISTEN/NOTIFY` is lost on restart and is not a queue. Logical decoding / Debezium is a valid production outbox consumer; it is operationally heavier than a poller for this local system. The poller is correct and interview-explainable.

## Duplicate publication

Safe because:

- Worker lock per `notificationId`
- Conditional status update
- Terminal states are ack-and-ignore
- Provider receives `notificationId:attempt` as an idempotency key

# Scheduling

One-shot `send_at` only. No cron / recurring series.

## Immediate vs scheduled

- `sendAt` omitted or in the past: outbox row is inserted in the **same** accept transaction.
- `sendAt` in the future: notification is `pending`, **no** outbox row. The scheduler inserts the outbox when due.

## Scheduler

`apps/scheduler` polls every `SCHEDULER_POLL_MS`:

1. Redis lock `scheduler:scan` so duplicate scheduler replicas do not stampede.
2. `SELECT … FOR UPDATE SKIP LOCKED` for
   - `pending AND send_at <= now()`
   - `retrying AND next_attempt_at <= now()`
3. Skip if an inflight outbox row already exists (backed by a partial unique index).
4. Insert `notification.scheduled` or `notification.retry`.

Missed schedules (process down over `send_at`) are picked up on the next tick — the due predicate is `<= now()`, not “exactly this minute.”

## Failure / restart

Schedule state is the `notifications` row. Memory is not involved. Two schedulers racing lose at the unique inflight-outbox index or at `SKIP LOCKED`.

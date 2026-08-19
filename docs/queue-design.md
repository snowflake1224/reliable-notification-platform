# Queue design

Core queue: **Redis Streams + consumer groups**. Not BullMQ.

## Keys

| Key | Type | Purpose |
|---|---|---|
| `nplat:jobs` | stream | notification jobs |
| `nplat:jobs:dlq` | stream | exhausted / permanent failures |
| `nplat:lock:notif:{id}` | string + PX + NX | one logical processor |
| `nplat:lock:scheduler:scan` | lock | one due-scan at a time |
| `nplat:rl:api:{tenant}` | hash | API token bucket |
| `nplat:rl:provider:{channel}` | hash | channel token bucket |

Consumer group: `workers`. Each worker process is a consumer named after `INSTANCE_ID`.

## Job payload

```
outboxEventId  notificationId  tenantId  attempt  enqueuedAt
```

Stream message IDs are Redis-assigned (`*`). They are not used as business identifiers; `notificationId` is.

## Consumer-group operations (implemented)

| Command | Use |
|---|---|
| `XGROUP CREATE … MKSTREAM` | startup; ignore `BUSYGROUP` |
| `XADD` | dispatcher publish |
| `XREADGROUP GROUP workers {consumer} STREAMS nplat:jobs >` | new work |
| `XACK` | after durable status change |
| `XPENDING` | find PEL entries |
| `XCLAIM` | steal idle messages from a dead consumer |
| `XLEN` | queue depth / DLQ size gauges |

`>` means “messages never delivered to this group.” Unacked messages live in the **Pending Entries List (PEL)** until `XACK` or `XCLAIM`.

## Visibility / lease

There is no native TTL on a PEL entry. The worker’s reclaim loop treats idle time ≥ `VISIBILITY_TIMEOUT_MS` as a crashed worker and `XCLAIM`s the id. Combined with the Redis lock TTL, a dead worker cannot hold a notification forever.

If reclaim fires while the original worker is still running, the lock or the conditional `UPDATE … status IN ('queued','retrying','pending')` drops the duplicate.

## Why retries are not “leave it in the PEL”

Leaving a failed job unacked makes Redis redeliver it immediately after reclaim. All workers then hammer a down provider (retry storm). This system **acks** after recording `retrying` + `next_attempt_at` in Postgres. The scheduler creates a new outbox event when the backoff elapses.

## Dead letter

After `max_attempts` or a permanent provider error, the worker sets `status = 'dead'` and `XADD`s `nplat:jobs:dlq`. Humans / ops inspect DLQ size via metrics and admin `GET /admin/queue/stats`.

## Backpressure

If unpublished outbox rows ≥ `MAX_OUTBOX_BACKLOG`, `POST /v1/notifications` returns 503. The API refuses to accept work it cannot see a path to publish.

## How BullMQ would simplify production

BullMQ (or similar) would give you retries, backoff, and a DLQ as library features, still on Redis. This repo implements the primitives so you can explain `XREADGROUP` / PEL / `XCLAIM` in an interview. In a company codebase, wrapping Streams is reasonable; replacing Postgres as source of truth is not.

# Scaling

## Horizontal pieces

| Layer | Scale unit | Constraint |
|---|---|---|
| Nginx | 1 in Compose | Becomes the client VIP |
| API | N containers | Stateless; each runs a dispatcher |
| Workers | N containers, same consumer group | Throughput ≈ min(workers × concurrency, provider RPS, DB) |
| Scheduler | 1 is enough; 2 is safe | Lock + unique inflight outbox |
| Postgres | vertical first | Accepts, outbox claims, status updates |
| Redis | vertical first | `XADD` / `XREADGROUP` / locks / rate limits |

## Queue partitioning (concept vs this repo)

Redis Streams can be sharded by key (e.g. one stream per tenant or channel) so a hot tenant does not head-of-line block others. This Compose stack uses **one stream** (`nplat:jobs`) for operational clarity. The consumer group already parallelizes across workers. If a single stream CPU-bounds Redis, split streams and keep the outbox payload’s stream name derived from `tenant_id` or `channel`.

Kafka partitions are the same idea with stronger ordering per key. Not used here.

## What actually bottlenecks

Measure, in order:

1. **Queue depth rising while workers idle** — workers crashed, group missing, or provider timeouts occupying concurrency.
2. **Queue depth rising while workers busy** — add workers until provider rate limits or Postgres p95 climbs.
3. **Provider errors / 429s** — you hit the channel token bucket or simulated failure rate. More workers make this worse, not better.
4. **Postgres latency up, Redis flat** — connection pool, `UPDATE notifications` row contention, or missing tenant indexes.
5. **Outbox backlog up, stream depth low** — dispatcher/Redis publish path, not workers.

Adding API replicas increases accept QPS and dispatcher parallelism. It does not increase delivery QPS if workers or the provider are saturated.

## Connection math

`instances × DATABASE_POOL_MAX` must stay under `max_connections`. Prefer more workers with a smaller pool over a few workers that each open 50 connections.

## Redis failure vs scale

Scaling Redis replicas for HA is different from scaling throughput. This project treats Redis as ephemeral: durability is the outbox. A Redis restart empties the stream; dispatchers refill from `pending`/`publishing` and from due retries. In-flight PEL messages that were already `published` but not acked are recovered only if the notification is not yet terminal — the dispatcher will not republish `published` rows. **Workers must finish or the scheduler must re-enqueue retries.** After a total Redis wipe, unpublished outbox rows and due retries recover automatically. `queued`/`processing` rows with no inflight outbox are recovered via admin `POST /admin/outbox/replay-stuck`. That hatch exists because Redis is ephemeral and Postgres is the source of truth.

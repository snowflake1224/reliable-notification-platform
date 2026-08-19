# Observability

Prometheus scrapes API, workers, scheduler, and the provider simulator. Grafana loads `infra/grafana/dashboards/notifications.json`.

## Metrics (all implemented)

| Metric | Meaning |
|---|---|
| `nplat_api_requests_total` | HTTP method / route / status |
| `nplat_notifications_accepted_total` | 202 path |
| `nplat_queue_depth` | `XLEN nplat:jobs` |
| `nplat_queue_pending_entries` | PEL size |
| `nplat_dlq_size` | `XLEN` DLQ |
| `nplat_outbox_backlog` | unpublished outbox rows |
| `nplat_worker_jobs_total` | worker outcomes |
| `nplat_processing_latency_seconds` | worker handle time |
| `nplat_deliveries_total` | success / retry / dead |
| `nplat_retries_total` | retry decisions |
| `nplat_provider_latency_seconds` | provider RTT |
| `nplat_provider_errors_total` | provider kinds |
| `nplat_webhook_events_total` | processed / duplicate / bad signature |
| `nplat_postgres_latency_seconds` | pooled query time |
| `nplat_redis_latency_seconds` | command time |
| `nplat_scheduler_lag_seconds` | age of oldest due row |
| `nplat_e2e_latency_seconds` | accept timestamp → delivered |

## Logs

Pino JSON. Bindings include `requestId`, `tenantId`, `notificationId`, `workerId`, `providerId` when known. Recipient bodies, emails, phones, tokens, and secrets are redacted in `packages/shared/src/logging.ts`.

## Health

- `GET /health/live` — process up
- `GET /health/ready` — Postgres `SELECT 1` + Redis `PING`

Nginx should route traffic only to ready APIs in a real deployment; Compose uses process start.

## SLOs (how to talk about them, not invented numbers)

Example SLO shape: “99% of accepted transactional notifications reach `delivered` or a terminal `dead` within 60s under a given offer load.” Measure with `nplat_e2e_latency_seconds` and `nplat_deliveries_total`. Capacity: raise workers until queue depth stays flat; if Postgres p95 rises first, the DB is the bottleneck, not the consumer group.

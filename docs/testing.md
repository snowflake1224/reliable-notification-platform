# Testing

Stack: **Vitest**, **Supertest**, **Testcontainers** (Postgres 16 + Redis 7).

```bash
npm test
```

Docker Desktop (or another container runtime) must be running for Testcontainers. Unit tests always run. Integration suites skip if no runtime is found, and fail closed if Docker is present but a test assertion fails.

## Map to required cases

| Case | Where |
|---|---|
| Transactional outbox + rollback | `tests/integration/platform.test.ts` |
| Duplicate publish / stale publishing | same |
| API idempotency + conflict | same |
| Concurrent workers | same |
| Transient retry + backoff timestamp | same |
| DLQ after max attempts | same |
| Permanent provider failure | same |
| Duplicate queue delivery after delivered | same |
| Webhook dedup | same |
| Scheduler due vs future `send_at` | same |
| Tenant isolation + API key auth | same |
| Admin JWT | same |
| Marketing opt-out | same |
| Stale PEL reclaim (`XCLAIM`) | `tests/integration/reclaim.test.ts` |
| State machine / backoff / HMAC | `tests/unit/*` |

## How to extend

Add a Testcontainers harness method in `tests/helpers/harness.ts` rather than talking to Compose from unit tests. Compose is for manual / k6 runs so local ports stay stable (`8080`, `5432`, `6379`).

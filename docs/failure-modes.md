# Failure modes

Every row is what the code actually does.

| Failure | User-visible | Recovery |
|---|---|---|
| PostgreSQL down | API readiness 503; accepts fail | No silent queue publish. Restart Postgres; nothing to “catch up” except in-flight HTTP. |
| Redis down | Accepts still commit (outbox stays `pending`) until backlog cap → 503. Workers idle. Rate limits fail closed / error. | Dispatcher retries `XADD`. Unpublished work is in Postgres. |
| Queue (stream) unavailable | Same as Redis | Same |
| API crash after COMMIT, before 202 | Client may retry; same idempotency key returns the stored body | Outbox dispatcher publishes |
| API crash before COMMIT | Client error; no row | Safe |
| Dispatcher crash mid-publish | Stale `publishing` reclaimed after claim timeout | Possible duplicate `XADD`; workers idempotent |
| Worker crash mid-provider | Message stays in PEL; lock expires | `XCLAIM` + lock + conditional update |
| Worker crash after DB `delivered`, before `XACK` | Reclaim → worker sees terminal → ack | No second send |
| Provider unavailable (transient) | Notification `retrying` | Backoff, scheduler re-enqueues |
| Provider timeout | Same as transient; provider may have accepted | Provider idempotency key + webhook |
| Provider permanent error | `dead` + DLQ | Manual replay / fix recipient |
| Provider rate limit | Transient retry | Channel token bucket + backoff |
| Duplicate webhook | `200 { status: "duplicate" }` | Unique `(provider, event_id)` |
| Nginx / one API instance down | Other API keeps serving | Outbox dispatchers on remaining APIs continue |
| Scheduler down | Immediate sends still flow; scheduled/retries wait | Next scheduler tick catches `<= now()` |
| Outbox backlog exceeds cap | New accepts 503 | Scale dispatchers/workers or shed load |

## Isolation

Provider latency cannot block accept transactions. A bad email provider does not hold Postgres connections. Channel rate limits are separate from API tenant limits so one chatty tenant does not exhaust the simulated ESP budget for everyone without first hitting the tenant API bucket.

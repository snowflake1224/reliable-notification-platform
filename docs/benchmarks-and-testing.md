# Benchmarks, Load Testing & Verification

## Automated Test Suite (Vitest + Testcontainers)

Tests live in `tests/unit/` and `tests/integration/`:

| Suite | File(s) | Coverage | Count |
| --- | --- | --- | ---: |
| **Unit** | `tests/unit/api-errors.test.ts` | Error codes, HTTP mapping, validation errors | 2 |
| **Unit** | `tests/unit/retry.test.ts` | Full-jitter backoff bounds, HTTP transient vs permanent status classification | 3 |
| **Unit** | `tests/unit/state-machine.test.ts` | Allowed/disallowed status transitions & terminal state guards | 3 |
| **Unit** | `tests/unit/template.test.ts` | Mustache-like variable substitution and missing placeholder behavior | 1 |
| **Integration (Testcontainers)** | `tests/integration/platform.test.ts`, `reclaim.test.ts` | Real Postgres + Redis end-to-end accept, idempotency replay/conflict, outbox dispatch, worker delivery, retries, DLQ, and stale PEL `XCLAIM` recovery | 15 |
| **Total** | | | **24** |

### Running Checks

```bash
npm ci
npm run typecheck
npm run build
npx vitest run tests/unit
npx vitest run tests/integration   # requires running Docker daemon for Testcontainers
```

## Load Harness (`load-tests/run-bench.mjs`)

`load-tests/run-bench.mjs` is a Node `fetch`-based benchmark script (not `k6`) that submits concurrent notification bursts against `/v1/notifications`, verifies `Idempotency-Key` handling, and polls Postgres/API status until terminal delivery to measure end-to-end latency.

### Historical Baseline Observation (2026-08-18)

- **Environment:** Local laptop Docker Compose stack (`2` APIs behind Nginx, `3` workers, Postgres 16, Redis 7, provider simulator + Mailpit).
- **Workload:** `25 req/s` for `20 s` (`500` total requests).
- **Measured Result:** `500/500` HTTP `202` accepted; end-to-end accept-to-delivered `p95` was **~1.832 s**.
- **Important Caveat:** That `2026-08-18` run predates the email-only simplification (it included mixed SMS/push channel rows) and is a single-host laptop observation, not a cloud capacity guarantee.

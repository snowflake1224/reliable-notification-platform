# Recorded local benchmark

Date: 2026-08-18  
Environment: local Docker Compose  
Workload: 25 requests/second for 20 seconds  
Tool: `node load-tests/run-bench.mjs`

These are observations from one laptop run, not a capacity guarantee.

## Acceptance

- Offered: 500 requests.
- Accepted: 500 HTTP 202 responses.
- Errors: 0.
- Accept latency: p50 468.3ms, p95 1011.6ms, p99 1241.0ms.

## Pipeline snapshot

The Prometheus snapshot was collected after an additional 15-second drain period:

- API request rate: approximately 25.6 requests/second.
- Accepted notification rate: approximately 12.28/second. The query window included idle time.
- Worker/delivery rate: approximately 13.84 jobs/second.
- Redis Stream depth: 513.
- Pending Entries List: 0.
- Dead-letter stream: 0.
- Outbox pending: 0.
- End-to-end p95: approximately 1.832 seconds.
- Provider p95: approximately 151ms.

## Interpretation

The API accepted the complete workload, but delivery lagged acceptance and the stream retained 513 entries at the snapshot. This run therefore indicates a worker/provider-side bottleneck at that offered rate; it does not establish the platform's maximum throughput.

Run `node load-tests/run-bench.mjs` again on the target host and preserve the raw output before making any production-performance claim.

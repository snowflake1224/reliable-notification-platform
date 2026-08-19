#!/usr/bin/env node
/**
 * Local load + metrics snapshot runner (no k6 required).
 *
 * Usage:
 *   node --experimental-strip-types load-tests/run-bench.mjs
 *   RATE=30 DURATION_SEC=20 node load-tests/run-bench.mjs
 */
const BASE = process.env.BASE_URL || "http://localhost:8080";
const KEY = process.env.API_KEY || "nplat_live_dev_demo_key_do_not_use_in_prod";
const PROM = process.env.PROM_URL || "http://localhost:9090";
const RATE = Number(process.env.RATE || 25);
const DURATION_SEC = Number(process.env.DURATION_SEC || 20);
const CONCURRENCY = Number(process.env.CONCURRENCY || 20);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function promQuery(expr) {
  const url = `${PROM}/api/v1/query?query=${encodeURIComponent(expr)}`;
  const res = await fetch(url);
  const json = await res.json();
  const v = json?.data?.result?.[0]?.value?.[1];
  return v == null ? null : Number(v);
}

async function snapshot(label) {
  const metrics = {
    label,
    api_rps: await promQuery("sum(rate(nplat_api_requests_total[30s]))"),
    accepted_rps: await promQuery("sum(rate(nplat_notifications_accepted_total[30s]))"),
    worker_rps: await promQuery("sum(rate(nplat_worker_jobs_total[30s]))"),
    deliveries_rps: await promQuery("sum(rate(nplat_deliveries_total[30s]))"),
    retries_rps: await promQuery("sum(rate(nplat_retries_total[30s]))"),
    queue_depth: await promQuery("max(nplat_queue_depth)"),
    pending_entries: await promQuery("max(nplat_queue_pending_entries)"),
    dlq_size: await promQuery("max(nplat_dlq_size)"),
    outbox_backlog: await promQuery("max(nplat_outbox_backlog)"),
    e2e_p95_s: await promQuery(
      "histogram_quantile(0.95, sum(rate(nplat_e2e_latency_seconds_bucket[1m])) by (le))"
    ),
    api_p95_s: await promQuery(
      "histogram_quantile(0.95, sum(rate(nplat_postgres_latency_seconds_bucket[1m])) by (le))"
    ),
    provider_p95_s: await promQuery(
      "histogram_quantile(0.95, sum(rate(nplat_provider_latency_seconds_bucket[1m])) by (le))"
    )
  };
  return metrics;
}

function printSnapshot(s) {
  const fmt = (n, digits = 2) => (n == null || Number.isNaN(n) ? "n/a" : n.toFixed(digits));
  console.log(`\n=== ${s.label} ===`);
  console.log(`API requests/s:          ${fmt(s.api_rps)}`);
  console.log(`Notifications accepted/s:${fmt(s.accepted_rps)}`);
  console.log(`Worker jobs/s:           ${fmt(s.worker_rps)}`);
  console.log(`Deliveries/s:            ${fmt(s.deliveries_rps)}`);
  console.log(`Retries/s:               ${fmt(s.retries_rps)}`);
  console.log(`Queue depth:             ${fmt(s.queue_depth, 0)}`);
  console.log(`Pending entries (PEL):   ${fmt(s.pending_entries, 0)}`);
  console.log(`DLQ size:                ${fmt(s.dlq_size, 0)}`);
  console.log(`Outbox backlog:          ${fmt(s.outbox_backlog, 0)}`);
  console.log(`E2E latency p95 (s):     ${fmt(s.e2e_p95_s, 3)}`);
  console.log(`Provider latency p95 (s):${fmt(s.provider_p95_s, 3)}`);
}

async function submitOne(i) {
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}/v1/notifications`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "idempotency-key": `bench-${process.pid}-${Date.now()}-${i}-${Math.random()}`
      },
      body: JSON.stringify({
        userId: "user-1",
        type: "order.shipped",
        channel: ["email", "sms", "push"][i % 3],
        payload: { name: "Bench", orderId: String(i) }
      })
    });
    return { ok: res.status === 202, status: res.status, ms: performance.now() - started };
  } catch {
    return { ok: false, status: 0, ms: performance.now() - started };
  }
}

async function main() {
  console.log(`Benchmark target=${BASE} rate=${RATE}/s duration=${DURATION_SEC}s concurrency=${CONCURRENCY}`);
  const ready = await fetch(`${BASE}/health/ready`);
  if (!ready.ok) {
    console.error("API not ready. Is docker compose up?");
    process.exit(1);
  }

  printSnapshot(await snapshot("before load"));

  const latencies = [];
  let ok = 0;
  let fail = 0;
  const endAt = Date.now() + DURATION_SEC * 1000;
  let issued = 0;
  const inFlight = new Set();

  while (Date.now() < endAt) {
    const tickStart = Date.now();
    const budget = RATE;
    for (let i = 0; i < budget; i++) {
      while (inFlight.size >= CONCURRENCY) {
        await Promise.race(inFlight);
      }
      const id = issued++;
      const p = submitOne(id).then((r) => {
        inFlight.delete(p);
        latencies.push(r.ms);
        if (r.ok) ok += 1;
        else fail += 1;
      });
      inFlight.add(p);
    }
    const elapsed = Date.now() - tickStart;
    if (elapsed < 1000) await sleep(1000 - elapsed);
  }
  await Promise.allSettled([...inFlight]);

  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
  const wallSec = DURATION_SEC;
  console.log("\n=== client-side accept results ===");
  console.log(`Submitted:     ${ok + fail}`);
  console.log(`Accepted 202:  ${ok}`);
  console.log(`Failed:        ${fail}`);
  console.log(`Client RPS:    ${(ok / wallSec).toFixed(2)}`);
  console.log(`Accept p50 ms: ${pct(50).toFixed(1)}`);
  console.log(`Accept p95 ms: ${pct(95).toFixed(1)}`);
  console.log(`Accept p99 ms: ${pct(99).toFixed(1)}`);

  console.log("\nWaiting 15s for workers/Prometheus scrape windows...");
  await sleep(15_000);
  printSnapshot(await snapshot("after load (+15s)"));

  console.log("\nGrafana: http://localhost:3001  (admin/admin)");
  console.log("Prometheus: http://localhost:9090");
  console.log("Dashboard: Reliable Notification Platform");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

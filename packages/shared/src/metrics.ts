import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

export function createMetrics(service: string) {
  const register = new Registry();
  register.setDefaultLabels({ service });
  collectDefaultMetrics({ register, prefix: "nplat_" });

  const httpRequests = new Counter({
    name: "nplat_api_requests_total",
    help: "API HTTP requests",
    labelNames: ["method", "route", "status"],
    registers: [register]
  });

  const notificationsAccepted = new Counter({
    name: "nplat_notifications_accepted_total",
    help: "Notifications accepted by the API",
    labelNames: ["tenant", "channel"],
    registers: [register]
  });

  const queueDepth = new Gauge({
    name: "nplat_queue_depth",
    help: "Redis Stream length (unconsumed + pending approximation via XLEN)",
    registers: [register]
  });

  const pendingEntries = new Gauge({
    name: "nplat_queue_pending_entries",
    help: "Consumer-group pending entries (PEL)",
    registers: [register]
  });

  const dlqSize = new Gauge({
    name: "nplat_dlq_size",
    help: "Dead-letter stream length",
    registers: [register]
  });

  const outboxBacklog = new Gauge({
    name: "nplat_outbox_backlog",
    help: "Unpublished outbox events",
    registers: [register]
  });

  const workerThroughput = new Counter({
    name: "nplat_worker_jobs_total",
    help: "Worker job outcomes",
    labelNames: ["result", "channel"],
    registers: [register]
  });

  const processingLatency = new Histogram({
    name: "nplat_processing_latency_seconds",
    help: "Worker processing latency",
    labelNames: ["channel"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register]
  });

  const deliveries = new Counter({
    name: "nplat_deliveries_total",
    help: "Delivery outcomes",
    labelNames: ["result", "channel"],
    registers: [register]
  });

  const retries = new Counter({
    name: "nplat_retries_total",
    help: "Retry decisions",
    labelNames: ["channel", "reason"],
    registers: [register]
  });

  const providerLatency = new Histogram({
    name: "nplat_provider_latency_seconds",
    help: "Provider call latency",
    labelNames: ["provider", "result"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register]
  });

  const providerErrors = new Counter({
    name: "nplat_provider_errors_total",
    help: "Provider errors",
    labelNames: ["provider", "kind"],
    registers: [register]
  });

  const webhookEvents = new Counter({
    name: "nplat_webhook_events_total",
    help: "Webhook events received",
    labelNames: ["provider", "result"],
    registers: [register]
  });

  const postgresLatency = new Histogram({
    name: "nplat_postgres_latency_seconds",
    help: "PostgreSQL query latency",
    labelNames: ["op"],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [register]
  });

  const redisLatency = new Histogram({
    name: "nplat_redis_latency_seconds",
    help: "Redis command latency",
    labelNames: ["op"],
    buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
    registers: [register]
  });

  const schedulerLag = new Gauge({
    name: "nplat_scheduler_lag_seconds",
    help: "Age of the oldest due notification not yet enqueued",
    registers: [register]
  });

  const e2eLatency = new Histogram({
    name: "nplat_e2e_latency_seconds",
    help: "Accept-to-delivered latency",
    labelNames: ["channel"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [register]
  });

  return {
    register,
    httpRequests,
    notificationsAccepted,
    queueDepth,
    pendingEntries,
    dlqSize,
    outboxBacklog,
    workerThroughput,
    processingLatency,
    deliveries,
    retries,
    providerLatency,
    providerErrors,
    webhookEvents,
    postgresLatency,
    redisLatency,
    schedulerLag,
    e2eLatency
  };
}

export type Metrics = ReturnType<typeof createMetrics>;

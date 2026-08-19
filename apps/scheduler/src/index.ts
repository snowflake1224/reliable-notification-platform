import {
  acquireLock,
  checkReadiness,
  claimDueNotifications,
  createLogger,
  createMetrics,
  createPool,
  createRedis,
  insertAudit,
  insertOutbox,
  installShutdown,
  loadConfig,
  startMetricsServer,
  withTransaction,
  type QueueJob
} from "@nplat/shared";

const config = loadConfig({ SERVICE_NAME: process.env.SERVICE_NAME ?? "scheduler" });
const logger = createLogger("scheduler", config.logLevel);
const metrics = createMetrics("scheduler");
const pool = createPool(config, metrics);
const redis = createRedis(config, metrics);
const schedulerId = config.instanceId;

let stopping = false;

async function tick(): Promise<number> {
  const lock = await acquireLock(redis, "scheduler:scan", schedulerId, config.schedulerPollMs * 4);
  if (!lock) return 0;

  try {
    const lag = await pool.query<{ lag: string | null }>(
      `SELECT EXTRACT(EPOCH FROM (now() - MIN(COALESCE(next_attempt_at, send_at))))::text AS lag
       FROM notifications
       WHERE (status = 'pending' AND send_at <= now())
          OR (status = 'retrying' AND next_attempt_at <= now())`
    );
    metrics.schedulerLag.set(Number(lag.rows[0]?.lag ?? 0));

    return withTransaction(pool, async (client) => {
      const due = await claimDueNotifications(client, config.schedulerBatchSize, schedulerId);
      let enqueued = 0;
      for (const n of due) {
        const existing = await client.query(
          `SELECT 1 FROM outbox_events
           WHERE aggregate_id = $1 AND status IN ('pending', 'publishing')`,
          [n.id]
        );
        if (existing.rowCount) continue;

        const job: QueueJob = {
          outboxEventId: "",
          notificationId: n.id,
          tenantId: n.tenant_id,
          attempt: n.attempt_count + 1,
          enqueuedAt: new Date().toISOString()
        };
        await insertOutbox(client, {
          tenantId: n.tenant_id,
          notificationId: n.id,
          eventType: n.status === "retrying" ? "notification.retry" : "notification.scheduled",
          payload: job
        });
        await insertAudit(client, {
          tenantId: n.tenant_id,
          notificationId: n.id,
          actor: "scheduler",
          action: "outbox_enqueued",
          fromStatus: n.status,
          metadata: { schedulerId }
        });
        enqueued += 1;
      }
      return enqueued;
    });
  } finally {
    await lock.release();
  }
}

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      const n = await tick();
      if (n) logger.info({ enqueued: n, workerId: schedulerId }, "scheduler enqueued due notifications");
    } catch (err) {
      logger.error({ err }, "scheduler tick failed");
    }
    await new Promise((r) => setTimeout(r, config.schedulerPollMs));
  }
}

const metricsPort = Number(process.env.METRICS_PORT ?? 9092);
const metricsServer = startMetricsServer(metrics, metricsPort, async (req, res) => {
  if (req.url === "/health/ready") {
    const result = await checkReadiness(pool, redis);
    res.statusCode = result.ready ? 200 : 503;
    res.end(JSON.stringify(result));
    return true;
  }
  return false;
});

logger.info({ schedulerId, metricsPort }, "scheduler started");
const running = loop();

installShutdown(logger, async () => {
  stopping = true;
  await running;
  metricsServer.close();
  await redis.quit();
  await pool.end();
});

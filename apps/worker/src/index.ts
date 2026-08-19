import {
  ack,
  checkReadiness,
  createLogger,
  createMetrics,
  createPool,
  createRedis,
  ensureConsumerGroup,
  installShutdown,
  loadConfig,
  readGroup,
  refreshQueueGauges,
  startMetricsServer
} from "@nplat/shared";
import { processJob } from "./processor.js";
import { reclaimStale } from "./reclaim.js";

const config = loadConfig({ SERVICE_NAME: process.env.SERVICE_NAME ?? "worker" });
const logger = createLogger("worker", config.logLevel);
const metrics = createMetrics("worker");
const pool = createPool(config, metrics);
const redis = createRedis(config, metrics);
const workerId = config.instanceId;

await ensureConsumerGroup(redis, config);

let stopping = false;
const inFlight = new Set<Promise<void>>();

async function handle(id: string, job: Parameters<typeof processJob>[6]): Promise<void> {
  const result = await processJob(pool, redis, config, metrics, logger, workerId, job);
  if (result === "ack") {
    await ack(redis, config, [id]);
  }
}

async function consumeLoop(): Promise<void> {
  while (!stopping) {
    try {
      const messages = await readGroup(redis, config, workerId, config.workerConcurrency, 2000);
      const reclaimed = stopping ? [] : await reclaimStale(redis, config, logger, workerId);
      const batch = [...messages, ...reclaimed];
      for (const msg of batch) {
        if (stopping) break;
        const task = handle(msg.id, msg.job).catch((err) => {
          logger.error({ err, notificationId: msg.job.notificationId, workerId }, "job failed");
        });
        inFlight.add(task);
        void task.finally(() => inFlight.delete(task));
      }
      await refreshQueueGauges(redis, config, metrics);
    } catch (err) {
      if (!stopping) logger.error({ err }, "consume loop error");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const metricsPort = Number(process.env.METRICS_PORT ?? 9091);
const metricsServer = startMetricsServer(metrics, metricsPort, async (req, res) => {
  if (req.url === "/health/ready") {
    const result = await checkReadiness(pool, redis);
    res.statusCode = result.ready ? 200 : 503;
    res.end(JSON.stringify(result));
    return true;
  }
  return false;
});

logger.info({ workerId, metricsPort }, "worker started");
const loop = consumeLoop();

installShutdown(logger, async () => {
  stopping = true;
  await Promise.allSettled([...inFlight]);
  await loop;
  metricsServer.close();
  await redis.quit();
  await pool.end();
});

import {
  createLogger,
  createMetrics,
  createPool,
  createRedis,
  installShutdown,
  loadConfig,
  OutboxDispatcher
} from "@nplat/shared";
import { createApp } from "./app.js";

const config = loadConfig({ SERVICE_NAME: process.env.SERVICE_NAME ?? "api" });
const logger = createLogger("api", config.logLevel);
const metrics = createMetrics("api");
const pool = createPool(config, metrics);
const redis = createRedis(config, metrics);
const dispatcher = new OutboxDispatcher(pool, redis, config, logger, metrics, config.instanceId);

// APIs only publish via XADD; workers own consumer-group creation.
dispatcher.start();

const app = createApp({ config, pool, redis, logger, metrics });
const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
  logger.info({ port, instanceId: config.instanceId }, "api listening");
});

installShutdown(logger, async () => {
  server.close();
  await dispatcher.stop();
  await redis.quit();
  await pool.end();
});

import { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import type { Metrics } from "../metrics.js";

export function createRedis(config: AppConfig, metrics?: Metrics): Redis {
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false
  });

  if (metrics) {
    const origSend = redis.sendCommand.bind(redis);
    // Observe latency without replacing ioredis Command thenables.
    // Returning a wrapped Promise leaves the original Command rejection unhandled.
    redis.sendCommand = ((command, ...rest: unknown[]) => {
      const name = (command as { name?: string }).name ?? "cmd";
      const end = metrics.redisLatency.startTimer({ op: String(name) });
      const result = origSend(command, ...(rest as []));
      Promise.resolve(result).then(
        () => end(),
        () => end()
      );
      return result;
    }) as typeof redis.sendCommand;
  }

  return redis;
}

export async function pingRedis(redis: Redis): Promise<void> {
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error("redis ping failed");
}

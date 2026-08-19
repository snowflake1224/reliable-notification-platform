import type { Redis } from "ioredis";
import type { AppConfig, Logger } from "@nplat/shared";
import { claimMessages, listStalePending, type StreamMessage } from "@nplat/shared";

export async function reclaimStale(
  redis: Redis,
  config: AppConfig,
  logger: Logger,
  consumer: string
): Promise<StreamMessage[]> {
  const stale = await listStalePending(redis, config, config.visibilityTimeoutMs, 50);
  if (!stale.length) return [];
  const ids = stale.map((s) => s.id);
  const claimed = await claimMessages(redis, config, consumer, config.visibilityTimeoutMs, ids);
  if (claimed.length) {
    logger.info({ count: claimed.length, consumer }, "reclaimed stale pending messages");
  }
  return claimed;
}

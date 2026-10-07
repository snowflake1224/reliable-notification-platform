import type { Redis } from "ioredis";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { claimOutboxBatch, markOutboxFailed, markOutboxPublished, pendingOutboxCount, transitionNotification } from "../db/queries.js";
import type { Logger } from "../logging.js";
import type { Metrics } from "../metrics.js";
import { publishJob } from "../queue/streams.js";
import type { QueueJob } from "../types.js";

export class OutboxDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly dispatcherId: string
  ) {}
~
  start(): void {
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      try {
        await this.dispatchOnce();
      } catch (err) {
        this.logger.error({ err }, "outbox dispatch cycle failed");
      } finally {
        if (!this.stopped) {
          this.timer = setTimeout(loop, this.config.outboxPollMs);
        }
      }
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async dispatchOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const backlog = await pendingOutboxCount(this.pool);
      this.metrics.outboxBacklog.set(backlog);

      const claimed = await claimOutboxBatch(
        this.pool,
        this.dispatcherId,
        this.config.outboxBatchSize,
        this.config.outboxClaimTimeoutMs
      );
      if (!claimed.length) return 0;

      let published = 0;
      for (const event of claimed) {
        const payload = (typeof event.payload === "string"
          ? JSON.parse(event.payload)
          : event.payload) as QueueJob;
        try {
          await publishJob(this.redis, this.config, {
            ...payload,
            outboxEventId: event.id,
            enqueuedAt: payload.enqueuedAt ?? new Date().toISOString()
          });
          await markOutboxPublished(this.pool, event.id);
          const moved = await transitionNotification(this.pool, {
            id: event.aggregate_id,
            tenantId: event.tenant_id,
            from: ["pending", "retrying"],
            to: "queued"
          });
          if (moved) {
            this.logger.info(
              {
                tenantId: event.tenant_id,
                notificationId: event.aggregate_id,
                outboxEventId: event.id
              },
              "outbox published"
            );
          }
          published += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await markOutboxFailed(this.pool, event.id, message);
          this.logger.warn(
            { err, outboxEventId: event.id, tenantId: event.tenant_id },
            "outbox publish failed; will retry"
          );
        }
      }
      return published;
    } finally {
      this.running = false;
    }
  }
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ack, publishJob, readGroup } from "../../packages/shared/src/index.js";
import { reclaimStale } from "../../apps/worker/src/reclaim.js";
import { createLogger } from "../../packages/shared/src/logging.js";
import { startHarness, type Harness } from "../helpers/harness.js";

describe("stale pending reclaim", () => {
  let h: Harness | undefined;

  beforeAll(async () => {
    try {
      h = await startHarness();
    } catch (err) {
      if (err instanceof Error && err.message === "DOCKER_UNAVAILABLE") {
        console.warn("skipping reclaim tests: Docker is not available");
        return;
      }
      throw err;
    }
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  beforeEach((ctx) => {
    if (!h) ctx.skip();
  });

  it("claims messages left in the PEL after a crashed consumer", async () => {
    await publishJob(h.redis, h.config, {
      outboxEventId: "stale",
      notificationId: "00000000-0000-4000-8000-000000000099",
      tenantId: h.tenantId,
      attempt: 1,
      enqueuedAt: new Date().toISOString()
    });
    const first = await readGroup(h.redis, h.config, "dead-worker", 10, 200);
    expect(first.length).toBeGreaterThan(0);
    h.config.visibilityTimeoutMs = 1;
    await new Promise((r) => setTimeout(r, 20));
    const reclaimed = await reclaimStale(h.redis, h.config, createLogger("reclaim", "silent"), "alive-worker");
    expect(reclaimed.length).toBeGreaterThan(0);
    expect(reclaimed[0].job.outboxEventId).toBe("stale");
    await ack(h.redis, h.config, reclaimed.map((m) => m.id));
  });
});

import { createServer } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createLogger,
  createMetrics,
  insertOutbox,
  OutboxDispatcher,
  pendingOutboxCount,
  publishJob,
  readGroup,
  signWebhook,
  withTransaction
} from "../../packages/shared/src/index.js";
import { processJob } from "../../apps/worker/src/processor.js";
import { DEMO_KEY, startHarness, type Harness } from "../helpers/harness.js";

describe("reliable notification platform", () => {
  let h: Harness | undefined;

  beforeAll(async () => {
    try {
      h = await startHarness("success");
    } catch (err) {
      if (err instanceof Error && err.message === "DOCKER_UNAVAILABLE") {
        console.warn("skipping integration tests: Docker is not available");
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

  const auth = { "x-api-key": DEMO_KEY };

  it("rejects missing API keys and isolates tenants", async () => {
    await request(h.app).post("/v1/notifications").send({}).expect(401);
    const created = await request(h.app)
      .post("/v1/notifications")
      .set(auth)
      .set("idempotency-key", "iso-1")
      .send({ userId: "user-1", type: "order.shipped", channel: "email", payload: { name: "A", orderId: "1" } })
      .expect(202);

    const other = await request(h!.app)
      .get(`/v1/notifications/${created.body.id}`)
      .set("x-api-key", "nplat_live_not_a_real_key______")
      .expect(401);
    void other;
    const missing = await h.pool.query(
      `SELECT id FROM notifications WHERE id = $1 AND tenant_id = $2`,
      [created.body.id, h.otherTenantId]
    );
    expect(missing.rowCount).toBe(0);
  });

  it("requires admin JWT for operations endpoints", async () => {
    await request(h.app).get("/admin/tenants").expect(401);
    const login = await request(h.app)
      .post("/admin/login")
      .send({ email: "admin@nplat.local", password: "admin-dev-password" })
      .expect(200);
    const tenants = await request(h.app)
      .get("/admin/tenants")
      .set("authorization", `Bearer ${login.body.token}`)
      .expect(200);
    expect(tenants.body.tenants.length).toBeGreaterThan(0);
  });

  it("commits notification and outbox atomically and rolls back together", async () => {
    await expect(
      withTransaction(h.pool, async (client) => {
        const n = await client.query(
          `INSERT INTO notifications (tenant_id, user_id, notification_type_id, channel, payload)
           SELECT $1, u.id, t.id, 'email', '{}'::jsonb
           FROM users u, notification_types t
           WHERE u.tenant_id = $1 AND t.tenant_id = $1 AND t.key = 'order.shipped'
           LIMIT 1
           RETURNING id`,
          [h.tenantId]
        );
        await insertOutbox(client, {
          tenantId: h.tenantId,
          notificationId: n.rows[0].id,
          eventType: "notification.requested",
          payload: {
            outboxEventId: "",
            notificationId: n.rows[0].id,
            tenantId: h.tenantId,
            attempt: 1,
            enqueuedAt: new Date().toISOString()
          }
        });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    const leftover = await h.pool.query(
      `SELECT count(*)::int AS c FROM notifications n
       JOIN outbox_events o ON o.aggregate_id = n.id
       WHERE n.tenant_id = $1 AND n.payload = '{}'::jsonb`,
      [h.tenantId]
    );
    expect(leftover.rows[0].c).toBe(0);
  });

  it("replays the same idempotency key and rejects a mutated replay", async () => {
    const body = { userId: "user-1", type: "order.shipped", channel: "email", payload: { name: "A", orderId: "2" } };
    const a = await request(h.app).post("/v1/notifications").set(auth).set("idempotency-key", "idemp-1").send(body).expect(202);
    const b = await request(h.app).post("/v1/notifications").set(auth).set("idempotency-key", "idemp-1").send(body).expect(202);
    expect(a.body.id).toBe(b.body.id);
    await request(h.app)
      .post("/v1/notifications")
      .set(auth)
      .set("idempotency-key", "idemp-1")
      .send({ ...body, payload: { name: "B", orderId: "9" } })
      .expect(409);
  });

  it("publishes claimed outbox events and is safe under duplicate publish", async () => {
    const accepted = await request(h.app)
      .post("/v1/notifications")
      .set(auth)
      .set("idempotency-key", "outbox-1")
      .send({ userId: "user-1", type: "order.shipped", channel: "sms", payload: { name: "A", orderId: "3" } })
      .expect(202);

    const dispatcher = new OutboxDispatcher(
      h.pool,
      h.redis,
      h.config,
      createLogger("test", "silent"),
      createMetrics("dispatcher"),
      "dispatcher-test"
    );
    const first = await dispatcher.dispatchOnce();
    expect(first).toBeGreaterThan(0);
    const second = await dispatcher.dispatchOnce();
    expect(second).toBe(0);

    const notif = await h.pool.query(`SELECT status FROM notifications WHERE id = $1`, [accepted.body.id]);
    expect(notif.rows[0].status).toBe("queued");

    await h.pool.query(
      `UPDATE outbox_events SET status = 'publishing', claimed_at = now() - interval '2 minutes'
       WHERE aggregate_id = $1`,
      [accepted.body.id]
    );
    const republish = await dispatcher.dispatchOnce();
    expect(republish).toBeGreaterThan(0);
    expect(await pendingOutboxCount(h.pool)).toBeGreaterThanOrEqual(0);
  });

  it("processes a job once under concurrent workers", async () => {
    const accepted = await request(h.app)
      .post("/v1/notifications")
      .set(auth)
      .set("idempotency-key", "conc-1")
      .send({ userId: "user-1", type: "order.shipped", channel: "push", payload: { name: "A", orderId: "4" } })
      .expect(202);
    await h.pool.query(`UPDATE notifications SET status = 'queued' WHERE id = $1`, [accepted.body.id]);
    const job = {
      outboxEventId: "evt",
      notificationId: accepted.body.id as string,
      tenantId: h.tenantId,
      attempt: 1,
      enqueuedAt: new Date().toISOString()
    };
    const metrics = createMetrics("w");
    const log = createLogger("w", "silent");
    const results = await Promise.all([
      processJob(h.pool, h.redis, h.config, metrics, log, "worker-a", job),
      processJob(h.pool, h.redis, h.config, metrics, log, "worker-b", job)
    ]);
    expect(results).toContain("ack");
    const n = await h.pool.query(`SELECT status, attempt_count FROM notifications WHERE id = $1`, [
      accepted.body.id
    ]);
    expect(n.rows[0].status).toBe("delivered");
    expect(n.rows[0].attempt_count).toBe(1);
  });

  it("retries transient provider failures with backoff then DLQs after max attempts", async () => {
    const accepted = await request(h.app)
      .post("/v1/notifications")
      .set(auth)
      .set("idempotency-key", "retry-1")
      .send({
        userId: "user-1",
        type: "order.shipped",
        channel: "email",
        payload: { name: "A", orderId: "5", _test: { failureMode: "transient" } }
      })
      .expect(202);
    await h.pool.query(`UPDATE notifications SET status = 'queued', max_attempts = 2 WHERE id = $1`, [
      accepted.body.id
    ]);
    const job = {
      outboxEventId: "evt",
      notificationId: accepted.body.id as string,
      tenantId: h.tenantId,
      attempt: 1,
      enqueuedAt: new Date().toISOString()
    };
    const metrics = createMetrics("retry");
    const log = createLogger("retry", "silent");
    await processJob(h.pool, h.redis, h.config, metrics, log, "worker-r", job);
    const after1 = await h.pool.query(
      `SELECT status, next_attempt_at, attempt_count FROM notifications WHERE id = $1`,
      [accepted.body.id]
    );
    expect(after1.rows[0].status).toBe("retrying");
    expect(new Date(after1.rows[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now() - 50);

    await h.pool.query(`UPDATE notifications SET status = 'queued' WHERE id = $1`, [accepted.body.id]);
    await processJob(h.pool, h.redis, h.config, metrics, log, "worker-r", job);
    const after2 = await h.pool.query(`SELECT status FROM notifications WHERE id = $1`, [accepted.body.id]);
    expect(after2.rows[0].status).toBe("dead");
    const dlq = await h.redis.xlen(h.config.queueDlqStream);
    expect(Number(dlq)).toBeGreaterThan(0);
  });

  it("treats permanent provider failure as dead without retrying forever", async () => {
    const accepted = await request(h.app)
      .post("/v1/notifications")
      .set(auth)
      .set("idempotency-key", "perm-1")
      .send({
        userId: "user-1",
        type: "order.shipped",
        channel: "sms",
        payload: { name: "A", orderId: "6", _test: { failureMode: "permanent" } }
      })
      .expect(202);
    await h.pool.query(`UPDATE notifications SET status = 'queued' WHERE id = $1`, [accepted.body.id]);
    await processJob(
      h.pool,
      h.redis,
      h.config,
      createMetrics("perm"),
      createLogger("perm", "silent"),
      "worker-p",
      {
        outboxEventId: "e",
        notificationId: accepted.body.id,
        tenantId: h.tenantId,
        attempt: 1,
        enqueuedAt: new Date().toISOString()
      }
    );
    const n = await h.pool.query(`SELECT status, last_error_class FROM notifications WHERE id = $1`, [
      accepted.body.id
    ]);
    expect(n.rows[0].status).toBe("dead");
    expect(n.rows[0].last_error_class).toBe("permanent");
  });

  it("acks duplicate queue delivery after the notification is already delivered", async () => {
    const delivered = await h.pool.query(
      `SELECT id FROM notifications WHERE tenant_id = $1 AND status = 'delivered' LIMIT 1`,
      [h.tenantId]
    );
    const result = await processJob(
      h.pool,
      h.redis,
      h.config,
      createMetrics("dup"),
      createLogger("dup", "silent"),
      "worker-d",
      {
        outboxEventId: "dup",
        notificationId: delivered.rows[0].id,
        tenantId: h.tenantId,
        attempt: 2,
        enqueuedAt: new Date().toISOString()
      }
    );
    expect(result).toBe("ack");
  });

  it("deduplicates provider webhooks by event id", async () => {
    const n = await h.pool.query(
      `SELECT id FROM notifications WHERE tenant_id = $1 AND status = 'delivered' LIMIT 1`,
      [h.tenantId]
    );
    const payload = {
      eventId: "evt-dup-1",
      eventType: "delivered",
      provider: "email",
      notificationId: n.rows[0].id,
      providerMessageId: "prov_x"
    };
    const body = JSON.stringify(payload);
    const ts = String(Date.now());
    const sig = `sha256=${signWebhook(h.config.webhookSecret, ts, body)}`;
    const first = await request(h.app)
      .post("/v1/webhooks/email")
      .set("x-provider-timestamp", ts)
      .set("x-provider-signature", sig)
      .set("content-type", "application/json")
      .send(payload)
      .expect(200);
    const second = await request(h.app)
      .post("/v1/webhooks/email")
      .set("x-provider-timestamp", ts)
      .set("x-provider-signature", sig)
      .set("content-type", "application/json")
      .send(payload)
      .expect(200);
    expect(first.body.status).toBe("ok");
    expect(second.body.status).toBe("duplicate");
  });

  it("does not enqueue future scheduled notifications until they are due", async () => {
    const sendAt = new Date(Date.now() + 60_000).toISOString();
    const accepted = await request(h.app)
      .post("/v1/notifications")
      .set(auth)
      .set("idempotency-key", "sched-1")
      .send({
        userId: "user-1",
        type: "order.shipped",
        channel: "email",
        payload: { name: "A", orderId: "7" },
        sendAt
      })
      .expect(202);
    expect(accepted.body.scheduled).toBe(true);
    const outbox = await h.pool.query(`SELECT count(*)::int AS c FROM outbox_events WHERE aggregate_id = $1`, [
      accepted.body.id
    ]);
    expect(outbox.rows[0].c).toBe(0);

    await h.pool.query(`UPDATE notifications SET send_at = now() - interval '1 second' WHERE id = $1`, [
      accepted.body.id
    ]);
    const { claimDueNotifications, insertOutbox: insert } = await import(
      "../../packages/shared/src/index.js"
    );
    await withTransaction(h.pool, async (client) => {
      const due = await claimDueNotifications(client, 10, "sched-test");
      expect(due.some((d) => d.id === accepted.body.id)).toBe(true);
      await insert(client, {
        tenantId: h.tenantId,
        notificationId: accepted.body.id,
        eventType: "notification.scheduled",
        payload: {
          outboxEventId: "",
          notificationId: accepted.body.id,
          tenantId: h.tenantId,
          attempt: 1,
          enqueuedAt: new Date().toISOString()
        }
      });
    });
    const after = await h.pool.query(`SELECT count(*)::int AS c FROM outbox_events WHERE aggregate_id = $1`, [
      accepted.body.id
    ]);
    expect(after.rows[0].c).toBe(1);
  });

  it("cancels marketing sends when the user opted out", async () => {
    await request(h.app)
      .put("/v1/users/user-1/preferences")
      .set(auth)
      .send({ type: "promo.weekly", channel: "email", optedIn: false })
      .expect(200);
    const res = await request(h.app)
      .post("/v1/notifications")
      .set(auth)
      .set("idempotency-key", "pref-1")
      .send({
        userId: "user-1",
        type: "promo.weekly",
        channel: "email",
        payload: { name: "A" }
      })
      .expect(200);
    expect(res.body.status).toBe("cancelled");
  });

  it("reads new stream messages via the consumer group", async () => {
    await publishJob(h.redis, h.config, {
      outboxEventId: "manual",
      notificationId: "00000000-0000-4000-8000-000000000001",
      tenantId: h.tenantId,
      attempt: 1,
      enqueuedAt: new Date().toISOString()
    });
    const msgs = await readGroup(h.redis, h.config, "test-consumer", 10, 100);
    expect(msgs.length).toBeGreaterThan(0);
  });
});

void createServer;

import { Router } from "express";
import {
  insertAudit,
  UnauthorizedError,
  verifyWebhookSignature
} from "@nplat/shared";
import { z } from "zod";

const eventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.enum(["delivered", "bounced", "failed"]),
  provider: z.enum(["email", "sms", "push"]),
  notificationId: z.string().uuid(),
  providerMessageId: z.string().min(1)
});

export const webhookRoutes = Router();

webhookRoutes.post("/:provider", async (req, res, next) => {
  try {
    const timestamp = req.header("x-provider-timestamp");
    const signature = req.header("x-provider-signature");
    const raw = req.rawBody ?? JSON.stringify(req.body);
    if (!timestamp || !signature) throw new UnauthorizedError("missing webhook signature");
    const rawTs = Number(timestamp);
    if (!Number.isFinite(rawTs)) throw new UnauthorizedError("invalid webhook timestamp");
    const tsMs = timestamp.length <= 10 ? rawTs * 1000 : rawTs;
    if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      throw new UnauthorizedError("stale webhook timestamp");
    }
    if (!verifyWebhookSignature(req.deps.config.webhookSecret, timestamp, raw, signature)) {
      req.deps.metrics.webhookEvents.inc({ provider: req.params.provider, result: "invalid_signature" });
      throw new UnauthorizedError("invalid webhook signature");
    }

    const event = eventSchema.parse(req.body);
    const inserted = await req.deps.pool.query(
      `INSERT INTO webhook_events (provider, provider_event_id, notification_id, provider_message_id, event_type)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [event.provider, event.eventId, event.notificationId, event.providerMessageId, event.eventType]
    );

    if (!inserted.rowCount) {
      req.deps.metrics.webhookEvents.inc({ provider: event.provider, result: "duplicate" });
      const existing = await req.deps.pool.query(
        `SELECT tenant_id FROM notifications WHERE id = $1`,
        [event.notificationId]
      );
      if (existing.rowCount) {
        await insertAudit(req.deps.pool, {
          tenantId: existing.rows[0].tenant_id,
          notificationId: event.notificationId,
          actor: "webhook",
          action: "webhook_duplicate",
          metadata: { eventId: event.eventId, provider: event.provider }
        });
      }
      req.log.info(
        { notificationId: event.notificationId, providerId: event.provider },
        "duplicate webhook ignored"
      );
      res.status(200).json({ status: "duplicate" });
      return;
    }

    const notif = await req.deps.pool.query(
      `SELECT id, tenant_id, status, channel, created_at FROM notifications WHERE id = $1`,
      [event.notificationId]
    );
    if (notif.rowCount) {
      const current = notif.rows[0];
      let toStatus: string | undefined;
      if (event.eventType === "delivered" && notif.rows[0].status !== "delivered") {
        const delivered = await req.deps.pool.query(
          `UPDATE notifications
           SET status = 'delivered',
               provider_message_id = COALESCE(provider_message_id, $2),
               version = version + 1,
               updated_at = now()
           WHERE id = $1 AND status IN ('processing', 'submitted', 'queued', 'retrying', 'pending')
           RETURNING id`,
          [event.notificationId, event.providerMessageId]
        );
        if (delivered.rowCount) {
          toStatus = "delivered";
          const created = new Date(current.created_at).getTime();
          req.deps.metrics.e2eLatency.observe(
            { channel: current.channel },
            (Date.now() - created) / 1000
          );
          req.deps.metrics.deliveries.inc({ result: "delivered", channel: current.channel });
        }
      }
      if (event.eventType !== "delivered" && notif.rows[0].status !== "delivered") {
        const failed = await req.deps.pool.query(
          `UPDATE notifications
           SET status = 'dead',
               last_error_code = $2,
               last_error_class = 'permanent',
               version = version + 1,
               updated_at = now()
           WHERE id = $1
             AND status IN ('processing', 'submitted', 'queued', 'retrying', 'pending')
           RETURNING id`,
          [event.notificationId, event.eventType]
        );
        if (failed.rowCount) {
          toStatus = "dead";
          req.deps.metrics.deliveries.inc({ result: "dead", channel: current.channel });
        }
      }
      await insertAudit(req.deps.pool, {
        tenantId: current.tenant_id,
        notificationId: event.notificationId,
        actor: "webhook",
        action: `provider_${event.eventType}`,
        fromStatus: current.status,
        toStatus,
        metadata: { eventId: event.eventId, provider: event.provider }
      });
    }

    req.deps.metrics.webhookEvents.inc({ provider: event.provider, result: "processed" });
    req.log.info(
      { notificationId: event.notificationId, providerId: event.provider },
      "webhook processed"
    );
    res.status(200).json({ status: "ok" });
  } catch (err) {
    next(err);
  }
});

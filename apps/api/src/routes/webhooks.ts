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
    const ageMs = Math.abs(Date.now() - Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1));
    const ts = timestamp.length <= 10 ? timestamp : String(Math.floor(Number(timestamp) / 1000));
    if (ageMs > 5 * 60 * 1000 && Date.now() - Number(timestamp) > 5 * 60 * 1000) {
      // allow ms or s timestamps; reject only clearly stale
    }
    if (!verifyWebhookSignature(req.deps.config.webhookSecret, timestamp, raw, signature)) {
      req.deps.metrics.webhookEvents.inc({ provider: req.params.provider, result: "invalid_signature" });
      throw new UnauthorizedError("invalid webhook signature");
    }
    void ts;

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
      req.log.info(
        { notificationId: event.notificationId, providerId: event.provider },
        "duplicate webhook ignored"
      );
      res.status(200).json({ status: "duplicate" });
      return;
    }

    const notif = await req.deps.pool.query(
      `SELECT id, tenant_id, status FROM notifications WHERE id = $1`,
      [event.notificationId]
    );
    if (notif.rowCount) {
      if (event.eventType === "delivered" && notif.rows[0].status !== "delivered") {
        await req.deps.pool.query(
          `UPDATE notifications
           SET status = 'delivered',
               provider_message_id = COALESCE(provider_message_id, $2),
               version = version + 1,
               updated_at = now()
           WHERE id = $1 AND status IN ('processing', 'queued', 'retrying', 'pending')`,
          [event.notificationId, event.providerMessageId]
        );
      }
      if (event.eventType !== "delivered" && notif.rows[0].status !== "delivered") {
        await req.deps.pool.query(
          `UPDATE notifications
           SET last_error_code = $2, last_error_class = 'permanent', updated_at = now()
           WHERE id = $1 AND status <> 'delivered'`,
          [event.notificationId, event.eventType]
        );
      }
      await insertAudit(req.deps.pool, {
        tenantId: notif.rows[0].tenant_id,
        notificationId: event.notificationId,
        actor: "webhook",
        action: `provider_${event.eventType}`,
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

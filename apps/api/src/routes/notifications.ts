import { Router } from "express";
import { NotFoundError, ValidationError } from "@nplat/shared";
import { z } from "zod";
import { createNotification } from "../services/notificationService.js";

const createSchema = z.object({
  userId: z.string().min(1),
  type: z.string().min(1),
  channel: z.enum(["email", "sms", "push"]),
  payload: z.record(z.unknown()).default({}),
  sendAt: z.string().datetime().optional()
});

export const notificationRoutes = Router();

notificationRoutes.post("/", async (req, res, next) => {
  try {
    const idempotencyKey = req.header("idempotency-key");
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key header is required");
    const body = createSchema.parse(req.body);
    const result = await createNotification(req.deps, {
      tenantId: req.tenant!.tenantId,
      externalUserId: body.userId,
      typeKey: body.type,
      channel: body.channel,
      payload: body.payload,
      idempotencyKey,
      sendAt: body.sendAt ? new Date(body.sendAt) : undefined,
      requestId: req.requestId
    });
    if (!result.replay) {
      req.deps.metrics.notificationsAccepted.inc({
        tenant: req.tenant!.tenantSlug,
        channel: body.channel
      });
    }
    res.status(result.status).json({ ...result.body, replay: result.replay });
  } catch (err) {
    next(err);
  }
});

notificationRoutes.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await req.deps.pool.query(
      `SELECT id, status, channel, attempt_count, max_attempts, send_at, next_attempt_at,
              provider_message_id, last_error_code, last_error_class, created_at, updated_at
       FROM notifications
       WHERE tenant_id = $1 AND id = $2`,
      [req.tenant!.tenantId, req.params.id]
    );
    if (!rows[0]) throw new NotFoundError("notification not found");
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

notificationRoutes.get("/:id/trace", async (req, res, next) => {
  try {
    const notification = await req.deps.pool.query(
      `SELECT n.id, n.status, n.channel, n.attempt_count, n.max_attempts, n.send_at, n.next_attempt_at,
              n.provider_message_id, n.last_error_code, n.last_error_class, n.created_at, n.updated_at,
              n.idempotency_key, n.rendered_subject, n.rendered_body,
              nt.key AS type_key, u.external_id AS external_user_id
       FROM notifications n
       JOIN notification_types nt ON nt.id = n.notification_type_id
       JOIN users u ON u.id = n.user_id
       WHERE n.tenant_id = $1 AND n.id = $2`,
      [req.tenant!.tenantId, req.params.id]
    );
    if (!notification.rows[0]) throw new NotFoundError("notification not found");

    const [outbox, attempts, audit, webhooks] = await Promise.all([
      req.deps.pool.query(
        `SELECT id, status, attempts, claimed_by, published_at, last_error, event_type, created_at
         FROM outbox_events
         WHERE tenant_id = $1 AND aggregate_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [req.tenant!.tenantId, req.params.id]
      ),
      req.deps.pool.query(
        `SELECT attempt_number, worker_id, status, provider, provider_message_id,
                error_code, error_class, latency_ms, started_at, finished_at
         FROM delivery_attempts
         WHERE tenant_id = $1 AND notification_id = $2
         ORDER BY attempt_number`,
        [req.tenant!.tenantId, req.params.id]
      ),
      req.deps.pool.query(
        `SELECT actor, action, from_status, to_status, metadata, created_at
         FROM audit_events
         WHERE tenant_id = $1 AND notification_id = $2
         ORDER BY created_at ASC`,
        [req.tenant!.tenantId, req.params.id]
      ),
      req.deps.pool.query(
        `SELECT provider, provider_event_id, event_type, provider_message_id, processed_at
         FROM webhook_events
         WHERE notification_id = $1
         ORDER BY processed_at ASC`,
        [req.params.id]
      )
    ]);

    res.json({
      notification: notification.rows[0],
      outbox: outbox.rows[0] ?? null,
      attempts: attempts.rows,
      audit: audit.rows,
      webhooks: webhooks.rows
    });
  } catch (err) {
    next(err);
  }
});

notificationRoutes.get("/:id/attempts", async (req, res, next) => {
  try {
    const exists = await req.deps.pool.query(
      `SELECT 1 FROM notifications WHERE tenant_id = $1 AND id = $2`,
      [req.tenant!.tenantId, req.params.id]
    );
    if (!exists.rowCount) throw new NotFoundError("notification not found");
    const { rows } = await req.deps.pool.query(
      `SELECT attempt_number, worker_id, status, provider, provider_message_id,
              error_code, error_class, latency_ms, started_at, finished_at
       FROM delivery_attempts
       WHERE tenant_id = $1 AND notification_id = $2
       ORDER BY attempt_number`,
      [req.tenant!.tenantId, req.params.id]
    );
    res.json({ attempts: rows });
  } catch (err) {
    next(err);
  }
});

notificationRoutes.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const { rows } = await req.deps.pool.query(
      `SELECT n.id, n.status, n.channel, n.attempt_count, n.send_at, n.created_at, nt.key AS type_key
       FROM notifications n
       JOIN notification_types nt ON nt.id = n.notification_type_id
       WHERE n.tenant_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2`,
      [req.tenant!.tenantId, limit]
    );
    res.json({ notifications: rows });
  } catch (err) {
    next(err);
  }
});

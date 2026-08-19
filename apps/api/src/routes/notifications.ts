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
    res.status(result.status).json(result.body);
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
      `SELECT id, status, channel, attempt_count, send_at, created_at
       FROM notifications
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.tenant!.tenantId, limit]
    );
    res.json({ notifications: rows });
  } catch (err) {
    next(err);
  }
});

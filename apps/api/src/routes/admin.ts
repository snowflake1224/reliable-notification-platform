import { Router } from "express";
import {
  generateApiKey,
  hashApiKey,
  NotFoundError,
  refreshQueueGauges,
  verifyPassword
} from "@nplat/shared";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";

export const adminRoutes = Router();

adminRoutes.post("/login", async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const { rows } = await req.deps.pool.query(
      `SELECT id, email, password_hash FROM admin_users WHERE email = $1`,
      [body.email]
    );
    if (!rows[0] || !(await verifyPassword(body.password, rows[0].password_hash))) {
      res.status(401).json({ error: { code: "unauthorized", message: "invalid credentials" } });
      return;
    }
    const token = jwt.sign(
      { sub: rows[0].id, email: rows[0].email, role: "admin" },
      req.deps.config.jwtSecret,
      { expiresIn: "8h" }
    );
    res.json({ token, expiresIn: 8 * 3600 });
  } catch (err) {
    next(err);
  }
});

adminRoutes.post("/tenants", requireAdmin, async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1), slug: z.string().min(1) }).parse(req.body);
    const { rows } = await req.deps.pool.query(
      `INSERT INTO tenants (name, slug) VALUES ($1,$2) RETURNING id, name, slug, status`,
      [body.name, body.slug]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

adminRoutes.get("/tenants", requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await req.deps.pool.query(
      `SELECT id, name, slug, status, created_at FROM tenants ORDER BY created_at`
    );
    res.json({ tenants: rows });
  } catch (err) {
    next(err);
  }
});

adminRoutes.post("/tenants/:id/api-keys", requireAdmin, async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    const tenant = await req.deps.pool.query(`SELECT id FROM tenants WHERE id = $1`, [req.params.id]);
    if (!tenant.rowCount) throw new NotFoundError("tenant not found");
    const generated = generateApiKey();
    const { rows } = await req.deps.pool.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, key_prefix, created_at`,
      [req.params.id, body.name, generated.prefix, hashApiKey(generated.raw, req.deps.config.apiKeyPepper)]
    );
    res.status(201).json({ ...rows[0], apiKey: generated.raw });
  } catch (err) {
    next(err);
  }
});

adminRoutes.post("/tenants/:id/api-keys/:keyId/revoke", requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await req.deps.pool.query(
      `UPDATE tenant_api_keys SET revoked_at = now()
       WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
      [req.params.keyId, req.params.id]
    );
    if (!rowCount) throw new NotFoundError("api key not found or already revoked");
    res.json({ revoked: true });
  } catch (err) {
    next(err);
  }
});

adminRoutes.post("/tenants/:id/api-keys/:keyId/rotate", requireAdmin, async (req, res, next) => {
  try {
    await req.deps.pool.query(
      `UPDATE tenant_api_keys SET revoked_at = now()
       WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
      [req.params.keyId, req.params.id]
    );
    const generated = generateApiKey();
    const body = z.object({ name: z.string().default("rotated") }).parse(req.body ?? {});
    const { rows } = await req.deps.pool.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, key_prefix, created_at`,
      [req.params.id, body.name, generated.prefix, hashApiKey(generated.raw, req.deps.config.apiKeyPepper)]
    );
    res.status(201).json({ ...rows[0], apiKey: generated.raw, rotatedFrom: req.params.keyId });
  } catch (err) {
    next(err);
  }
});

adminRoutes.get("/outbox/stats", requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await req.deps.pool.query(
      `SELECT status, count(*)::int AS count FROM outbox_events GROUP BY status`
    );
    res.json({ statuses: rows });
  } catch (err) {
    next(err);
  }
});

adminRoutes.post("/outbox/replay-stuck", requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await req.deps.pool.query(
      `SELECT n.id, n.tenant_id, n.attempt_count
       FROM notifications n
       WHERE n.status IN ('queued', 'processing')
         AND n.updated_at < now() - interval '2 minutes'
         AND NOT EXISTS (
           SELECT 1 FROM outbox_events o
           WHERE o.aggregate_id = n.id AND o.status IN ('pending', 'publishing')
         )`
    );
    let enqueued = 0;
    for (const n of rows) {
      try {
        await req.deps.pool.query(
          `INSERT INTO outbox_events
            (tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,'notification',$2,'notification.replay',$3::jsonb)`,
          [
            n.tenant_id,
            n.id,
            JSON.stringify({
              outboxEventId: "",
              notificationId: n.id,
              tenantId: n.tenant_id,
              attempt: n.attempt_count + 1,
              enqueuedAt: new Date().toISOString()
            })
          ]
        );
        enqueued += 1;
      } catch {
        // unique inflight outbox or race
      }
    }
    res.json({ candidates: rows.length, enqueued });
  } catch (err) {
    next(err);
  }
});

adminRoutes.get("/queue/stats", requireAdmin, async (req, res, next) => {
  try {
    await refreshQueueGauges(req.deps.redis, req.deps.config, req.deps.metrics);
    const depth = await req.deps.redis.xlen(req.deps.config.queueStream);
    const dlq = await req.deps.redis.xlen(req.deps.config.queueDlqStream);
    const pending = (await req.deps.redis.xpending(
      req.deps.config.queueStream,
      req.deps.config.queueGroup
    )) as unknown[];
    res.json({
      stream: req.deps.config.queueStream,
      depth,
      dlq,
      pending: Array.isArray(pending) ? pending[0] : 0
    });
  } catch (err) {
    next(err);
  }
});

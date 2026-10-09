import { Router } from "express";
import { CHANNELS, NotFoundError } from "@nplat/shared";
import { z } from "zod";

export const catalogRoutes = Router();

catalogRoutes.post("/types", async (req, res, next) => {
  try {
    const body = z
      .object({
        key: z.string().min(1),
        name: z.string().min(1),
        category: z.enum(["transactional", "marketing"]).default("transactional")
      })
      .parse(req.body);
    const { rows } = await req.deps.pool.query(
      `INSERT INTO notification_types (tenant_id, key, name, category)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category
       RETURNING id, key, category`,
      [req.tenant!.tenantId, body.key, body.name, body.category]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

catalogRoutes.post("/templates", async (req, res, next) => {
  try {
    const body = z
      .object({
        type: z.string().min(1),
        channel: z.enum(CHANNELS),
        name: z.string().min(1),
        subject: z.string().optional(),
        body: z.string().min(1)
      })
      .parse(req.body);
    const type = await req.deps.pool.query(
      `SELECT id FROM notification_types WHERE tenant_id = $1 AND key = $2`,
      [req.tenant!.tenantId, body.type]
    );
    if (!type.rowCount) throw new NotFoundError("notification type not found");
    const tpl = await req.deps.pool.query(
      `INSERT INTO templates (tenant_id, notification_type_id, channel, name)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, notification_type_id, channel) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [req.tenant!.tenantId, type.rows[0].id, body.channel, body.name]
    );
    const version = await req.deps.pool.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM template_versions WHERE template_id = $1`,
      [tpl.rows[0].id]
    );
    await req.deps.pool.query(
      `UPDATE template_versions SET status = 'draft' WHERE template_id = $1 AND status = 'published'`,
      [tpl.rows[0].id]
    );
    const { rows } = await req.deps.pool.query(
      `INSERT INTO template_versions (tenant_id, template_id, version, subject, body, status)
       VALUES ($1,$2,$3,$4,$5,'published')
       RETURNING id, version, status`,
      [req.tenant!.tenantId, tpl.rows[0].id, version.rows[0].next, body.subject ?? null, body.body]
    );
    res.status(201).json({ templateId: tpl.rows[0].id, ...rows[0] });
  } catch (err) {
    next(err);
  }
});

catalogRoutes.get("/templates", async (req, res, next) => {
  try {
    const { rows } = await req.deps.pool.query(
      `SELECT nt.key AS type, t.channel, tv.subject, tv.body, tv.version
       FROM templates t
       JOIN notification_types nt ON nt.id = t.notification_type_id
       JOIN template_versions tv ON tv.template_id = t.id AND tv.status = 'published'
       WHERE t.tenant_id = $1
       ORDER BY nt.key, t.channel`,
      [req.tenant!.tenantId]
    );
    res.json({ templates: rows });
  } catch (err) {
    next(err);
  }
});

catalogRoutes.get("/types", async (req, res, next) => {
  try {
    const { rows } = await req.deps.pool.query(
      `SELECT key, name, category FROM notification_types WHERE tenant_id = $1 ORDER BY key`,
      [req.tenant!.tenantId]
    );
    res.json({ types: rows });
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import { CHANNELS, NotFoundError } from "@nplat/shared";
import { z } from "zod";

const userSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  pushToken: z.string().optional()
});

const prefSchema = z.object({
  type: z.string().min(1),
  channel: z.enum(CHANNELS),
  optedIn: z.boolean()
});

export const userRoutes = Router();

userRoutes.post("/", async (req, res, next) => {
  try {
    const body = userSchema.parse(req.body);
    const { rows } = await req.deps.pool.query(
      `INSERT INTO users (tenant_id, external_id, email, phone, push_token)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, external_id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             phone = COALESCE(EXCLUDED.phone, users.phone),
             push_token = COALESCE(EXCLUDED.push_token, users.push_token),
             updated_at = now()
       RETURNING id, external_id, created_at`,
      [req.tenant!.tenantId, body.userId, body.email ?? null, body.phone ?? null, body.pushToken ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

userRoutes.get("/:externalId", async (req, res, next) => {
  try {
    const { rows } = await req.deps.pool.query(
      `SELECT id, external_id, created_at FROM users WHERE tenant_id = $1 AND external_id = $2`,
      [req.tenant!.tenantId, req.params.externalId]
    );
    if (!rows[0]) throw new NotFoundError("user not found");
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

userRoutes.put("/:externalId/preferences", async (req, res, next) => {
  try {
    const body = prefSchema.parse(req.body);
    const user = await req.deps.pool.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND external_id = $2`,
      [req.tenant!.tenantId, req.params.externalId]
    );
    if (!user.rowCount) throw new NotFoundError("user not found");
    const type = await req.deps.pool.query(
      `SELECT id FROM notification_types WHERE tenant_id = $1 AND key = $2`,
      [req.tenant!.tenantId, body.type]
    );
    if (!type.rowCount) throw new NotFoundError("notification type not found");
    const { rows } = await req.deps.pool.query(
      `INSERT INTO user_preferences (tenant_id, user_id, notification_type_id, channel, opted_in)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, user_id, notification_type_id, channel)
       DO UPDATE SET opted_in = EXCLUDED.opted_in, updated_at = now()
       RETURNING channel, opted_in`,
      [req.tenant!.tenantId, user.rows[0].id, type.rows[0].id, body.channel, body.optedIn]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import { NotFoundError } from "@nplat/shared";
import { z } from "zod";

const userSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().optional()
});

export const userRoutes = Router();

userRoutes.post("/", async (req, res, next) => {
  try {
    const body = userSchema.parse(req.body);
    const { rows } = await req.deps.pool.query(
      `INSERT INTO users (tenant_id, external_id, email)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, external_id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             updated_at = now()
       RETURNING id, external_id, created_at`,
      [req.tenant!.tenantId, body.userId, body.email ?? null]
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

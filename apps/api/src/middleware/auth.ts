import type { NextFunction, Request, Response } from "express";
import {
  apiKeyPrefix,
  ForbiddenError,
  hashApiKey,
  UnauthorizedError
} from "@nplat/shared";
import jwt from "jsonwebtoken";

export async function requireTenant(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const raw =
      req.header("x-api-key") ??
      (req.header("authorization")?.startsWith("Bearer nplat_")
        ? req.header("authorization")!.slice("Bearer ".length)
        : undefined);
    if (!raw) throw new UnauthorizedError("missing API key");

    const prefix = apiKeyPrefix(raw);
    const hash = hashApiKey(raw, req.deps.config.apiKeyPepper);
    const { rows } = await req.deps.pool.query<{
      id: string;
      tenant_id: string;
      slug: string;
      status: string;
      revoked_at: Date | null;
    }>(
      `SELECT k.id, k.tenant_id, t.slug, t.status, k.revoked_at
       FROM tenant_api_keys k
       JOIN tenants t ON t.id = k.tenant_id
       WHERE k.key_prefix = $1 AND k.key_hash = $2`,
      [prefix, hash]
    );
    const key = rows[0];
    if (!key || key.revoked_at) throw new UnauthorizedError("invalid or revoked API key");
    if (key.status !== "active") throw new ForbiddenError("tenant suspended");

    req.tenant = { tenantId: key.tenant_id, tenantSlug: key.slug, apiKeyId: key.id };
    req.log = req.log.child({ tenantId: key.tenant_id });
    await req.deps.pool.query(`UPDATE tenant_api_keys SET last_used_at = now() WHERE id = $1`, [key.id]);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedError("missing admin token");
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, req.deps.config.jwtSecret) as {
      sub: string;
      email: string;
      role?: string;
    };
    if (payload.role !== "admin") throw new ForbiddenError("admin role required");
    req.admin = { adminId: payload.sub, email: payload.email };
    next();
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      next(err);
      return;
    }
    next(new UnauthorizedError("invalid admin token"));
  }
}

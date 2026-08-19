import type { NextFunction, Request, Response } from "express";
import { apiLimitKey, consumeToken, RateLimitedError } from "@nplat/shared";

export async function tenantRateLimit(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.tenant) return next();
    const result = await consumeToken(
      req.deps.redis,
      apiLimitKey(req.tenant.tenantId),
      req.deps.config.apiRateLimitPerSec
    );
    if (!result.allowed) {
      throw new RateLimitedError("tenant API rate limit exceeded", 200);
    }
    next();
  } catch (err) {
    next(err);
  }
}

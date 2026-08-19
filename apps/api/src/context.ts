import type { NextFunction, Request, Response } from "express";
import type {
  AdminContext,
  AppConfig,
  Logger,
  Metrics,
  TenantContext
} from "@nplat/shared";
import type { Redis } from "ioredis";
import type { Pool } from "pg";

export interface AppDeps {
  config: AppConfig;
  pool: Pool;
  redis: Redis;
  logger: Logger;
  metrics: Metrics;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      deps: AppDeps;
      tenant?: TenantContext;
      admin?: AdminContext;
      rawBody?: string;
    }
  }
}

export function attachDeps(deps: AppDeps) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.deps = deps;
    next();
  };
}

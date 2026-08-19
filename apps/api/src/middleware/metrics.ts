import type { NextFunction, Request, Response } from "express";

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on("finish", () => {
    const route = (req.route?.path as string | undefined) ?? req.path;
    req.deps.metrics.httpRequests.inc({
      method: req.method,
      route,
      status: String(res.statusCode)
    });
    req.log.info(
      {
        method: req.method,
        route,
        status: res.statusCode,
        latencyMs: Date.now() - started,
        tenantId: req.tenant?.tenantId
      },
      "http request"
    );
  });
  next();
}

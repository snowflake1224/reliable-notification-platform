import type { NextFunction, Request, Response } from "express";
import { AppError } from "@nplat/shared";
import { ZodError } from "zod";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "validation_error", message: err.issues[0]?.message ?? "invalid request", requestId: req.requestId }
    });
    return;
  }
  if (err instanceof AppError) {
    req.log.warn({ code: err.code, status: err.statusCode }, err.message);
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, requestId: req.requestId }
    });
    return;
  }
  req.log.error({ err }, "unhandled error");
  res.status(500).json({
    error: { code: "internal_error", message: "Internal error", requestId: req.requestId }
  });
}

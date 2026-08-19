import type { NextFunction, Request, Response } from "express";
import { randomId } from "@nplat/shared";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = String(req.header("x-request-id") ?? randomId("req_"));
  req.requestId = id;
  req.log = req.deps.logger.child({ requestId: id });
  res.setHeader("x-request-id", id);
  next();
}

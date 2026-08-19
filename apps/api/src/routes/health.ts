import { Router } from "express";
import { checkReadiness } from "@nplat/shared";

export const healthRoutes = Router();

healthRoutes.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

healthRoutes.get("/ready", async (req, res) => {
  const result = await checkReadiness(req.deps.pool, req.deps.redis);
  res.status(result.ready ? 200 : 503).json(result);
});

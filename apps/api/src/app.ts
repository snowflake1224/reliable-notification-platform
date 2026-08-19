import express from "express";
import { attachDeps, type AppDeps } from "./context.js";
import { requireTenant } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { httpMetrics } from "./middleware/metrics.js";
import { tenantRateLimit } from "./middleware/rateLimit.js";
import { requestId } from "./middleware/requestId.js";
import { adminRoutes } from "./routes/admin.js";
import { healthRoutes } from "./routes/health.js";
import { notificationRoutes } from "./routes/notifications.js";
import { catalogRoutes } from "./routes/templates.js";
import { userRoutes } from "./routes/users.js";
import { webhookRoutes } from "./routes/webhooks.js";

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(attachDeps(deps));
  app.use(
    express.json({
      limit: "64kb",
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf.toString("utf8");
      }
    })
  );
  app.use(requestId);
  app.use(httpMetrics);

  app.use("/health", healthRoutes);
  app.get("/metrics", async (req, res) => {
    res.set("content-type", deps.metrics.register.contentType);
    res.end(await deps.metrics.register.metrics());
  });

  app.use("/admin", adminRoutes);
  app.use("/v1/webhooks", webhookRoutes);
  app.use("/v1/notifications", requireTenant, tenantRateLimit, notificationRoutes);
  app.use("/v1/users", requireTenant, tenantRateLimit, userRoutes);
  app.use("/v1/catalog", requireTenant, tenantRateLimit, catalogRoutes);

  app.use(errorHandler);
  return app;
}

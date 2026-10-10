import express from "express";
import swaggerUi from "swagger-ui-express";
import { attachDeps, type AppDeps } from "./context.js";
import { requireTenant } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { httpMetrics } from "./middleware/metrics.js";
import { tenantRateLimit } from "./middleware/rateLimit.js";
import { requestId } from "./middleware/requestId.js";
import { adminRoutes } from "./routes/admin.js";
import { demoRoutes } from "./routes/demo.js";
import { healthRoutes } from "./routes/health.js";
import { homeRoutes } from "./routes/home.js";
import { notificationRoutes } from "./routes/notifications.js";
import { catalogRoutes } from "./routes/templates.js";
import { userRoutes } from "./routes/users.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { openApiDocument } from "./openapi.js";
import { docsCustomCss, docsCustomCssUrl, docsCustomJsStr } from "./ui/docsTheme.js";

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(attachDeps(deps));
  app.use(requestId);
  app.use(
    express.json({
      limit: "64kb",
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf.toString("utf8");
      }
    })
  );
  app.use((_req, res, next) => {
    res.setHeader("x-nplat-instance", deps.config.instanceId);
    next();
  });
  app.use(httpMetrics);

  app.use("/", homeRoutes);
  app.get("/docs/openapi.json", (_req, res) => res.json(openApiDocument));
  // customJsStr is supported at runtime but missing from @types/swagger-ui-express.
  const docsOptions: swaggerUi.SwaggerUiOptions & { customJsStr: string } = {
    customSiteTitle: "API docs · Reliable Notification Platform",
    customCssUrl: docsCustomCssUrl,
    customCss: docsCustomCss,
    customJsStr: docsCustomJsStr,
    swaggerOptions: { persistAuthorization: true }
  };
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument, docsOptions));
  app.use("/health", healthRoutes);
  app.get("/metrics", async (req, res) => {
    res.set("content-type", deps.metrics.register.contentType);
    res.end(await deps.metrics.register.metrics());
  });

  app.use("/admin", adminRoutes);
  app.use("/v1/demo", demoRoutes);
  app.use("/v1/webhooks", webhookRoutes);
  app.use("/v1/notifications", requireTenant, tenantRateLimit, notificationRoutes);
  app.use("/v1/users", requireTenant, tenantRateLimit, userRoutes);
  app.use("/v1/catalog", requireTenant, tenantRateLimit, catalogRoutes);

  app.use(errorHandler);
  return app;
}

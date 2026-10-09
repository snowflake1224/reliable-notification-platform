import express from "express";
import nodemailer from "nodemailer";
import {
  createLogger,
  createMetrics,
  installShutdown,
  randomId,
  signWebhook,
  type FailureMode
} from "@nplat/shared";

const logger = createLogger("provider-simulator", process.env.LOG_LEVEL ?? "info");
const metrics = createMetrics("provider-simulator");
const webhookSecret = process.env.WEBHOOK_SECRET ?? "dev-webhook-secret-change-me";
const webhookTarget = process.env.WEBHOOK_TARGET_URL ?? "http://localhost:3000/v1/webhooks";
const defaultMode = (process.env.DEFAULT_FAILURE_MODE ?? "success") as FailureMode;
const failureRate = Number(process.env.FAILURE_RATE ?? 0);

const seenIdempotency = new Map<string, { providerMessageId: string }>();
let downUntil = 0;
let lastWebhook: WebhookPayload | null = null;

const app = express();
app.use(express.json({ limit: "64kb" }));

type WebhookPayload = {
  eventId: string;
  eventType: "delivered";
  provider: string;
  notificationId: string;
  providerMessageId: string;
};

app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
app.get("/metrics", async (_req, res) => {
  res.set("content-type", metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

app.get("/simulate", (_req, res) => {
  res.json(simulateState());
});

app.post("/simulate", (req, res) => {
  const mode = req.body?.mode as FailureMode | undefined;
  if (mode) process.env.DEFAULT_FAILURE_MODE = mode;
  if (req.body?.rate !== undefined) process.env.FAILURE_RATE = String(req.body.rate);
  if (req.body?.downForMs !== undefined) {
    const requested = Number(req.body.downForMs);
    const ms = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), 90_000) : 0;
    downUntil = ms === 0 ? 0 : Date.now() + ms;
  }
  res.json(simulateState());
});

app.post("/simulate/replay-webhook", async (_req, res) => {
  if (!lastWebhook) {
    res.status(404).json({ error: "no webhook to replay" });
    return;
  }
  try {
    const result = await postWebhook(lastWebhook);
    res.status(result.status).json(result.body);
  } catch (err) {
    logger.warn({ err }, "webhook replay failed");
    res.status(502).json({ error: "webhook replay failed" });
  }
});

app.post("/send", async (req, res) => {
  const started = Date.now();
  const idem = String(req.header("x-idempotency-key") ?? "");
  if (idem && seenIdempotency.has(idem)) {
    res.json(seenIdempotency.get(idem));
    return;
  }

  const channel = String(req.body?.channel ?? "email");
  const notificationId = String(req.body?.notificationId ?? "");

  if (downUntil > Date.now()) {
    const retryAfterMs = downUntil - Date.now();
    metrics.providerErrors.inc({ provider: channel, kind: "transient" });
    res.status(503).json({
      code: "provider_unavailable",
      message: "simulated receiver down",
      retryAfterMs
    });
    return;
  }

  const mode: FailureMode = req.body?.failureMode ?? pickMode();

  if (mode === "timeout") {
    await sleep(Number(process.env.PROVIDER_TIMEOUT_MS ?? 3000) + 500);
  }
  if (mode === "transient") {
    metrics.providerErrors.inc({ provider: channel, kind: "transient" });
    res.status(503).json({ code: "provider_unavailable", message: "simulated transient failure" });
    return;
  }
  if (mode === "permanent") {
    metrics.providerErrors.inc({ provider: channel, kind: "permanent" });
    res.status(400).json({ code: "invalid_recipient", message: "simulated permanent failure" });
    return;
  }
  if (mode === "rate_limit") {
    metrics.providerErrors.inc({ provider: channel, kind: "rate_limited" });
    res.status(429).json({ code: "rate_limited", message: "simulated provider rate limit", retryAfterMs: 400 });
    return;
  }

  const providerMessageId = `prov_${randomId()}`;
  if (idem) seenIdempotency.set(idem, { providerMessageId });

  if (channel === "email" && process.env.MAILHOG_SMTP_HOST) {
    try {
      const transport = nodemailer.createTransport({
        host: process.env.MAILHOG_SMTP_HOST,
        port: Number(process.env.MAILHOG_SMTP_PORT ?? 1025),
        secure: false
      });
      await transport.sendMail({
        from: "noreply@nplat.local",
        to: req.body?.to || "dev@example.test",
        subject: req.body?.subject || "Notification",
        text: typeof req.body?.body === "string" && req.body.body.length > 0 ? req.body.body : "(empty notification body)"
      });
    } catch (err) {
      logger.warn({ err }, "mailhog delivery failed; continuing with simulated success");
    }
  }

  metrics.providerLatency.observe({ provider: channel, result: "success" }, (Date.now() - started) / 1000);
  logger.info(
    { notificationId, providerId: channel, requestId: String(req.header("x-request-id") ?? "") },
    "provider accepted"
  );
  res.json({ providerMessageId });

  void fireWebhook({
    provider: channel,
    notificationId,
    providerMessageId
  });
});

async function fireWebhook(input: {
  provider: string;
  notificationId: string;
  providerMessageId: string;
}): Promise<void> {
  if (!input.notificationId) return;
  await sleep(25);
  const payload: WebhookPayload = {
    eventId: `evt_${randomId()}`,
    eventType: "delivered",
    provider: input.provider,
    notificationId: input.notificationId,
    providerMessageId: input.providerMessageId
  };
  lastWebhook = payload;
  try {
    await postWebhook(payload);
    metrics.webhookEvents.inc({ provider: input.provider, result: "sent" });
  } catch (err) {
    logger.warn({ err, notificationId: input.notificationId }, "webhook delivery failed");
    metrics.webhookEvents.inc({ provider: input.provider, result: "failed" });
  }
}

async function postWebhook(payload: WebhookPayload): Promise<{ status: number; body: unknown }> {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = `sha256=${signWebhook(webhookSecret, timestamp, body)}`;
  const response = await fetch(`${webhookTarget}/${payload.provider}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-provider-timestamp": timestamp,
      "x-provider-signature": signature
    },
    body
  });
  const parsed = (await response.json().catch(() => ({}))) as unknown;
  return { status: response.status, body: parsed };
}

function simulateState() {
  return {
    mode: process.env.DEFAULT_FAILURE_MODE,
    rate: process.env.FAILURE_RATE,
    downUntil: downUntil > Date.now() ? downUntil : null
  };
}

function pickMode(): FailureMode {
  if (Math.random() < failureRate) return "transient";
  return (process.env.DEFAULT_FAILURE_MODE as FailureMode) ?? defaultMode;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => logger.info({ port }, "provider simulator listening"));

installShutdown(logger, async () => {
  server.close();
});

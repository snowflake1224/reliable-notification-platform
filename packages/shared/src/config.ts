import { z } from "zod";

const schema = z.object({
  nodeEnv: z.string().default("development"),
  logLevel: z.string().default("info"),
  serviceName: z.string().default("nplat"),
  instanceId: z.string().default(""),

  databaseUrl: z.string().min(1),
  databasePoolMax: z.coerce.number().int().positive().default(10),
  databaseStatementTimeoutMs: z.coerce.number().int().positive().default(5000),

  redisUrl: z.string().min(1),

  jwtSecret: z.string().min(8),
  apiKeyPepper: z.string().min(8),
  webhookSecret: z.string().min(8),

  providerBaseUrl: z.string().url(),
  providerTimeoutMs: z.coerce.number().int().positive().default(2000),
  allowTestFailures: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  demoMode: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  requireSecureSecrets: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  apiRateLimitPerSec: z.coerce.number().positive().default(50),
  emailRateLimitPerSec: z.coerce.number().positive().default(20),
  smsRateLimitPerSec: z.coerce.number().positive().default(10),
  pushRateLimitPerSec: z.coerce.number().positive().default(50),

  outboxPollMs: z.coerce.number().int().positive().default(250),
  outboxBatchSize: z.coerce.number().int().positive().default(50),
  outboxClaimTimeoutMs: z.coerce.number().int().positive().default(30_000),
  maxOutboxBacklog: z.coerce.number().int().positive().default(5000),

  queueStream: z.string().default("nplat:jobs"),
  queueDlqStream: z.string().default("nplat:jobs:dlq"),
  queueGroup: z.string().default("workers"),
  visibilityTimeoutMs: z.coerce.number().int().positive().default(30_000),
  workerConcurrency: z.coerce.number().int().positive().default(8),
  maxAttempts: z.coerce.number().int().positive().default(5),

  schedulerPollMs: z.coerce.number().int().positive().default(500),
  schedulerBatchSize: z.coerce.number().int().positive().default(100),

  mailhogSmtpHost: z.string().default("localhost"),
  mailhogSmtpPort: z.coerce.number().int().positive().default(1025)
});

export type AppConfig = z.infer<typeof schema> & { instanceId: string };

export function loadConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  const env = { ...process.env, ...overrides };
  const parsed = schema.parse({
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    serviceName: env.SERVICE_NAME,
    instanceId: env.INSTANCE_ID,
    databaseUrl: env.DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX,
    databaseStatementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    redisUrl: env.REDIS_URL,
    jwtSecret: env.JWT_SECRET,
    apiKeyPepper: env.API_KEY_PEPPER,
    webhookSecret: env.WEBHOOK_SECRET,
    providerBaseUrl: env.PROVIDER_BASE_URL,
    providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
    allowTestFailures: env.ALLOW_TEST_FAILURES,
    demoMode: env.DEMO_MODE,
    requireSecureSecrets: env.REQUIRE_SECURE_SECRETS,
    apiRateLimitPerSec: env.API_RATE_LIMIT_PER_SEC,
    emailRateLimitPerSec: env.EMAIL_RATE_LIMIT_PER_SEC,
    smsRateLimitPerSec: env.SMS_RATE_LIMIT_PER_SEC,
    pushRateLimitPerSec: env.PUSH_RATE_LIMIT_PER_SEC,
    outboxPollMs: env.OUTBOX_POLL_MS,
    outboxBatchSize: env.OUTBOX_BATCH_SIZE,
    outboxClaimTimeoutMs: env.OUTBOX_CLAIM_TIMEOUT_MS,
    maxOutboxBacklog: env.MAX_OUTBOX_BACKLOG,
    queueStream: env.QUEUE_STREAM,
    queueDlqStream: env.QUEUE_DLQ_STREAM,
    queueGroup: env.QUEUE_GROUP,
    visibilityTimeoutMs: env.VISIBILITY_TIMEOUT_MS,
    workerConcurrency: env.WORKER_CONCURRENCY,
    maxAttempts: env.MAX_ATTEMPTS,
    schedulerPollMs: env.SCHEDULER_POLL_MS,
    schedulerBatchSize: env.SCHEDULER_BATCH_SIZE,
    mailhogSmtpHost: env.MAILHOG_SMTP_HOST,
    mailhogSmtpPort: env.MAILHOG_SMTP_PORT
  });

  if (!parsed.instanceId) {
    parsed.instanceId = `${parsed.serviceName}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  }
  if (parsed.requireSecureSecrets) {
    const insecure = [parsed.jwtSecret, parsed.apiKeyPepper, parsed.webhookSecret].some(
      (value) =>
        value.length < 24 ||
        /replace-me|change-me|not-for-production|dev-|generate-|your-/i.test(value)
    );
    if (insecure) {
      throw new Error(
        "JWT_SECRET, API_KEY_PEPPER, and WEBHOOK_SECRET must be unique production values of at least 24 characters"
      );
    }
  }
  return parsed;
}

export function channelRateLimit(config: AppConfig, channel: string): number {
  if (channel === "email") return config.emailRateLimitPerSec;
  if (channel === "sms") return config.smsRateLimitPerSec;
  return config.pushRateLimitPerSec;
}

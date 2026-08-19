import pino from "pino";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "apiKey",
  "token",
  "authorization",
  "secret",
  "rendered_body",
  "rendered_subject",
  "renderedBody",
  "renderedSubject",
  "email",
  "phone",
  "push_token",
  "pushToken",
  "body",
  "subject",
  "recipient"
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

export function createLogger(service: string, level = "info") {
  return pino({
    name: service,
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      log(object) {
        return redact(object) as Record<string, unknown>;
      }
    }
  });
}

export type Logger = ReturnType<typeof createLogger>;

export function childLogger(
  logger: Logger,
  bindings: {
    requestId?: string;
    tenantId?: string;
    notificationId?: string;
    workerId?: string;
    providerId?: string;
    outboxEventId?: string;
  }
) {
  return logger.child(bindings);
}

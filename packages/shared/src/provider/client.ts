import type { AppConfig } from "../config.js";
import type { Channel, FailureMode, ProviderResult } from "../types.js";

export interface SendRequest {
  tenantId: string;
  notificationId: string;
  channel: Channel;
  to: string;
  subject?: string | null;
  body: string;
  idempotencyKey: string;
  failureMode?: FailureMode;
}

export async function sendToProvider(config: AppConfig, req: SendRequest): Promise<ProviderResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.providerTimeoutMs);
  try {
    const res = await fetch(`${config.providerBaseUrl}/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": req.idempotencyKey
      },
      body: JSON.stringify(req),
      signal: controller.signal
    });
    const latencyMs = Date.now() - started;
    const data = (await res.json().catch(() => ({}))) as {
      providerMessageId?: string;
      code?: string;
      message?: string;
      retryAfterMs?: number;
    };

    if (res.status === 429) {
      return { kind: "rate_limited", retryAfterMs: data.retryAfterMs ?? 1000, latencyMs };
    }
    if (res.status >= 500 || res.status === 408) {
      return {
        kind: "transient",
        code: data.code ?? `http_${res.status}`,
        message: data.message ?? "provider transient error",
        latencyMs
      };
    }
    if (!res.ok) {
      return {
        kind: "permanent",
        code: data.code ?? `http_${res.status}`,
        message: data.message ?? "provider permanent error",
        latencyMs
      };
    }
    return {
      kind: "success",
      providerMessageId: data.providerMessageId ?? `prov_${req.notificationId}`,
      latencyMs
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const aborted = err instanceof Error && err.name === "AbortError";
    if (aborted) return { kind: "timeout", latencyMs };
    return {
      kind: "transient",
      code: "network_error",
      message: err instanceof Error ? err.message : "network error",
      latencyMs
    };
  } finally {
    clearTimeout(timer);
  }
}

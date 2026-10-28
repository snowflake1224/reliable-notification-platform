import type { Trace } from "./api";

export type StageState = "wait" | "on" | "done" | "bad" | "skip";

export type Stage = {
  name: string;
  state: StageState;
  detail: string;
};

export type AcceptMeta = {
  status: number;
  instance: string | null;
  replay: boolean;
  key: string;
};

export function clock(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function buildStages(trace: Trace | null, accept: AcceptMeta | null): Stage[] {
  const notification = trace?.notification;
  const outbox = trace?.outbox ?? null;
  const attempts = trace?.attempts ?? [];
  const latest = attempts[attempts.length - 1];
  const webhook = trace?.webhooks[trace.webhooks.length - 1];
  const duplicate = trace?.audit.some((event) => event.action === "webhook_duplicate") ?? false;

  const acceptDetail = accept
    ? `HTTP ${accept.status}${accept.replay ? " · replay of the same idempotency key" : " · new accept"} · ${accept.instance ?? "instance pending"} · ${accept.key}`
    : notification
      ? `Earlier send · key ${notification.idempotency_key ?? "—"}`
      : "No request yet";

  let outboxState: StageState = "wait";
  let outboxDetail = "The outbox row is written in the same transaction as the notification.";
  if (outbox?.status === "published") {
    outboxState = "done";
    outboxDetail = `published ${clock(outbox.published_at)} · claimed by ${outbox.claimed_by ?? "dispatcher"}`;
  } else if (outbox?.status === "failed") {
    outboxState = "bad";
    outboxDetail = outbox.last_error ?? "publish failed";
  } else if (outbox) {
    outboxState = "on";
    outboxDetail = `${outbox.status}${outbox.claimed_by ? ` · ${outbox.claimed_by}` : ""}`;
  } else if (notification) {
    outboxDetail = "Waiting for the outbox row.";
  }

  let workerState: StageState = "wait";
  let workerDetail = "A worker claims the stream message and takes the Redis lock.";
  if (latest) {
    workerState = latest.status === "started" ? "on" : "done";
    workerDetail = `attempt ${latest.attempt_number}/${notification?.max_attempts ?? "—"} · ${latest.worker_id} · ${latest.status}`;
  } else if (notification && (notification.status === "queued" || notification.status === "processing")) {
    workerState = "on";
    workerDetail = `status ${notification.status}`;
  }

  let providerState: StageState = "wait";
  let providerDetail = "The simulator accepts, refuses, or asks the worker to wait.";
  if (latest?.status === "succeeded") {
    providerState = "done";
    providerDetail = `accepted · ${latest.provider_message_id ?? notification?.provider_message_id ?? "no id"} · ${latest.latency_ms ?? "—"} ms`;
  } else if (latest?.status === "permanent_failed") {
    providerState = "bad";
    providerDetail = `${latest.error_code ?? "permanent"} · dead-letter count is on the board`;
  } else if (latest && (latest.status === "transient_failed" || latest.status === "timeout")) {
    providerState = "on";
    providerDetail = `${latest.error_code ?? latest.status} · ${latest.error_class ?? "transient"}`;
  } else if (latest?.status === "started") {
    providerState = "on";
    providerDetail = "attempt in progress";
  }

  let hookState: StageState = "wait";
  let hookDetail = "The simulator posts a delivery status; a repeated event id is ignored.";
  if (duplicate && webhook) {
    hookState = "done";
    hookDetail = `duplicate · ${webhook.provider_event_id}`;
  } else if (webhook) {
    hookState = webhook.event_type === "delivered" ? "done" : "bad";
    hookDetail = `${webhook.event_type} · ${webhook.provider_event_id}`;
  } else if (notification?.status === "submitted") {
    hookState = "on";
    hookDetail = "Provider accepted the message. Waiting for the delivery callback.";
  } else if (notification?.status === "dead") {
    hookState = "skip";
    hookDetail = "No delivery webhook.";
  }

  let retryState: StageState = "done";
  let retryDetail = "No retry is waiting.";
  if (notification?.status === "retrying") {
    retryState = "on";
    retryDetail = `next attempt ${clock(notification.next_attempt_at)}`;
  } else if (notification?.status === "dead") {
    retryState = "bad";
    retryDetail = `dead letter · ${notification.last_error_code ?? "failed"}`;
  } else if (!notification) {
    retryState = "wait";
    retryDetail = "Retrying rows show on the board.";
  }

  return [
    { name: "Accept", state: notification || accept ? "done" : "wait", detail: acceptDetail },
    { name: "Outbox", state: outboxState, detail: outboxDetail },
    { name: "Worker", state: workerState, detail: workerDetail },
    { name: "Provider", state: providerState, detail: providerDetail },
    { name: "Webhook", state: hookState, detail: hookDetail },
    { name: "Retry", state: retryState, detail: retryDetail }
  ];
}

export const DEMO_KEY = "nplat_live_dev_demo_key_do_not_use_in_prod";
export const ADMIN_EMAIL = "admin@nplat.local";
export const ADMIN_PASSWORD = "admin-dev-password";

export type AcceptBody = {
  id?: string;
  status?: string;
  reason?: string;
  replay?: boolean;
  sendAt?: string;
  error?: { code?: string; message?: string; requestId?: string };
};

export type AcceptResult = {
  status: number;
  instance: string | null;
  body: AcceptBody;
};

export type TraceNotification = {
  id: string;
  status: string;
  channel: string;
  attempt_count: number;
  max_attempts: number;
  send_at: string;
  next_attempt_at: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  last_error_class: string | null;
  created_at: string;
  updated_at: string;
  idempotency_key: string | null;
  rendered_subject: string | null;
  rendered_body: string | null;
  type_key: string;
  external_user_id: string;
};

export type OutboxRow = {
  id: string;
  status: string;
  attempts: number;
  claimed_by: string | null;
  published_at: string | null;
  last_error: string | null;
  event_type: string;
  created_at: string;
};

export type AttemptRow = {
  attempt_number: number;
  worker_id: string;
  status: string;
  provider: string;
  provider_message_id: string | null;
  error_code: string | null;
  error_class: string | null;
  latency_ms: number | null;
  started_at: string;
  finished_at: string | null;
};

export type AuditRow = {
  actor: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type WebhookRow = {
  provider: string;
  provider_event_id: string;
  event_type: string;
  provider_message_id: string | null;
  processed_at: string;
};

export type Trace = {
  notification: TraceNotification;
  outbox: OutboxRow | null;
  attempts: AttemptRow[];
  audit: AuditRow[];
  webhooks: WebhookRow[];
};

export type ListedNotification = {
  id: string;
  status: string;
  channel: string;
  attempt_count: number;
  send_at: string;
  created_at: string;
  type_key: string;
};

export type QueueStats = {
  stream: string;
  depth: number;
  dlq: number;
  pending: number;
  schedulerDue: number;
};

export type OutboxStats = { statuses: Array<{ status: string; count: number }> };

export type Ready = { ready: boolean; postgres: string; redis: string };

export type SimulateState = { mode?: string; rate?: string; downUntil: number | null };

export type MailSummary = {
  ID: string;
  Subject: string;
  Created: string;
  Snippet: string;
  To?: Array<{ Address?: string }>;
};

export type Preference = { type: string; channel: string; opted_in: boolean };

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export async function postNotification(apiKey: string, idempotencyKey: string, body: unknown): Promise<AcceptResult> {
  const res = await fetch("/v1/notifications", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify(body)
  });
  return {
    status: res.status,
    instance: res.headers.get("x-nplat-instance"),
    body: (await readJson(res)) as AcceptBody
  };
}

export async function getTrace(apiKey: string, id: string): Promise<Trace | null> {
  const res = await fetch(`/v1/notifications/${id}/trace`, { headers: { "x-api-key": apiKey } });
  if (!res.ok) return null;
  return (await readJson(res)) as Trace;
}

export async function listNotifications(apiKey: string): Promise<ListedNotification[]> {
  const res = await fetch("/v1/notifications?limit=12", { headers: { "x-api-key": apiKey } });
  if (!res.ok) return [];
  const body = (await readJson(res)) as { notifications?: ListedNotification[] };
  return body.notifications ?? [];
}

export async function getPreferences(apiKey: string): Promise<Preference[]> {
  const res = await fetch("/v1/users/user-1/preferences", { headers: { "x-api-key": apiKey } });
  if (!res.ok) return [];
  const body = (await readJson(res)) as { preferences?: Preference[] };
  return body.preferences ?? [];
}

export async function putPreference(apiKey: string, optedIn: boolean): Promise<void> {
  const res = await fetch("/v1/users/user-1/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ type: "promo.weekly", channel: "email", optedIn })
  });
  if (!res.ok) {
    const body = (await readJson(res)) as AcceptBody;
    throw new Error(body.error?.message ?? `preference update failed (${res.status})`);
  }
}

export async function loginAdmin(): Promise<string> {
  const res = await fetch("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  const body = (await readJson(res)) as { token?: string; error?: { message?: string } };
  if (!res.ok || !body.token) throw new Error(body.error?.message ?? "admin login failed");
  return body.token;
}

export async function getQueueStats(token: string): Promise<QueueStats | null> {
  const res = await fetch("/admin/queue/stats", { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return (await readJson(res)) as QueueStats;
}

export async function getOutboxStats(token: string): Promise<OutboxStats | null> {
  const res = await fetch("/admin/outbox/stats", { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return (await readJson(res)) as OutboxStats;
}

export async function getReady(): Promise<Ready | null> {
  const res = await fetch("/health/ready");
  const body = (await readJson(res)) as Ready;
  if (!body || typeof body.ready !== "boolean") return null;
  return body;
}

export async function getSimulate(): Promise<SimulateState | null> {
  const res = await fetch("/simulate");
  if (!res.ok) return null;
  return (await readJson(res)) as SimulateState;
}

export async function setOutage(downForMs: number): Promise<SimulateState> {
  const res = await fetch("/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ downForMs })
  });
  if (!res.ok) throw new Error(`could not set receiver outage (${res.status})`);
  return (await readJson(res)) as SimulateState;
}

export async function replayWebhook(): Promise<{ status: number; body: { status?: string; error?: string } }> {
  const res = await fetch("/simulate/replay-webhook", { method: "POST" });
  return {
    status: res.status,
    body: (await readJson(res)) as { status?: string; error?: string }
  };
}

export async function listMail(): Promise<MailSummary[]> {
  const res = await fetch("/mailpit/api/v1/messages");
  if (!res.ok) return [];
  const body = (await readJson(res)) as { messages?: MailSummary[] };
  return (body.messages ?? []).slice(0, 8);
}

export async function readMail(id: string): Promise<string> {
  const res = await fetch(`/mailpit/api/v1/message/${id}`);
  if (!res.ok) return "";
  const body = (await readJson(res)) as { Text?: string; Subject?: string };
  return body.Text ?? "";
}

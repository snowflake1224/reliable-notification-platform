export const CHANNELS = ["email", "sms", "push"] as const;
export type Channel = (typeof CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  "pending",
  "queued",
  "processing",
  "retrying",
  "delivered",
  "dead",
  "cancelled"
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const ERROR_CLASSES = ["transient", "permanent"] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export const OUTBOX_STATUSES = ["pending", "publishing", "published", "failed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export type ProviderKind = "email" | "sms" | "push";

export type FailureMode = "success" | "transient" | "permanent" | "timeout" | "rate_limit";

export type ProviderResult =
  | { kind: "success"; providerMessageId: string; latencyMs: number }
  | { kind: "transient"; code: string; message: string; latencyMs: number; retryAfterMs?: number }
  | { kind: "permanent"; code: string; message: string; latencyMs: number }
  | { kind: "timeout"; latencyMs: number }
  | { kind: "rate_limited"; retryAfterMs: number; latencyMs: number };

export interface QueueJob {
  outboxEventId: string;
  notificationId: string;
  tenantId: string;
  attempt: number;
  enqueuedAt: string;
}

export interface NotificationRow {
  id: string;
  tenant_id: string;
  user_id: string;
  notification_type_id: string;
  template_version_id: string | null;
  channel: Channel;
  status: NotificationStatus;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  rendered_subject: string | null;
  rendered_body: string | null;
  send_at: Date;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  last_error_code: string | null;
  last_error_class: ErrorClass | null;
  provider_message_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface OutboxEventRow {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: QueueJob;
  status: OutboxStatus;
  attempts: number;
  available_at: Date;
  claimed_at: Date | null;
  claimed_by: string | null;
  published_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  apiKeyId: string;
}

export interface AdminContext {
  adminId: string;
  email: string;
}

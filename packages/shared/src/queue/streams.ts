import type { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import type { Metrics } from "../metrics.js";
import type { QueueJob } from "../types.js";

export interface StreamMessage {
  id: string;
  job: QueueJob;
}

export async function ensureConsumerGroup(redis: Redis, config: AppConfig): Promise<void> {
  try {
    await redis.xgroup("CREATE", config.queueStream, config.queueGroup, "0", "MKSTREAM");
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
    // Concurrent startups race on group creation; this is expected and safe.
    if (/BUSYGROUP/i.test(message)) return;
    throw err;
  }
}

export async function publishJob(redis: Redis, config: AppConfig, job: QueueJob): Promise<string> {
  const id = await redis.xadd(
    config.queueStream,
    "*",
    "outboxEventId",
    job.outboxEventId,
    "notificationId",
    job.notificationId,
    "tenantId",
    job.tenantId,
    "attempt",
    String(job.attempt),
    "enqueuedAt",
    job.enqueuedAt
  );
  return id as string;
}

export async function readGroup(
  redis: Redis,
  config: AppConfig,
  consumer: string,
  count: number,
  blockMs: number
): Promise<StreamMessage[]> {
  const result = (await redis.xreadgroup(
    "GROUP",
    config.queueGroup,
    consumer,
    "COUNT",
    count,
    "BLOCK",
    blockMs,
    "STREAMS",
    config.queueStream,
    ">"
  )) as [string, [string, string[]][]][] | null;

  if (!result) return [];
  return parseStream(result);
}

export async function ack(redis: Redis, config: AppConfig, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await redis.xack(config.queueStream, config.queueGroup, ...ids);
}

export async function publishDlq(
  redis: Redis,
  config: AppConfig,
  job: QueueJob,
  reason: string
): Promise<void> {
  await redis.xadd(
    config.queueDlqStream,
    "*",
    "outboxEventId",
    job.outboxEventId,
    "notificationId",
    job.notificationId,
    "tenantId",
    job.tenantId,
    "attempt",
    String(job.attempt),
    "enqueuedAt",
    job.enqueuedAt,
    "reason",
    reason
  );
}

export interface PendingEntry {
  id: string;
  consumer: string;
  idleMs: number;
  deliveries: number;
}

export async function listStalePending(
  redis: Redis,
  config: AppConfig,
  minIdleMs: number,
  count: number
): Promise<PendingEntry[]> {
  const raw = (await redis.xpending(
    config.queueStream,
    config.queueGroup,
    "-",
    "+",
    count
  )) as [string, string, number, number][];
  if (!raw) return [];
  return raw
    .map(([id, consumer, idleMs, deliveries]) => ({ id, consumer, idleMs, deliveries }))
    .filter((e) => e.idleMs >= minIdleMs);
}

export async function claimMessages(
  redis: Redis,
  config: AppConfig,
  consumer: string,
  minIdleMs: number,
  ids: string[]
): Promise<StreamMessage[]> {
  if (!ids.length) return [];
  const raw = (await redis.xclaim(
    config.queueStream,
    config.queueGroup,
    consumer,
    minIdleMs,
    ...ids
  )) as [string, string[]][];
  if (!raw) return [];
  return raw.map(([id, fields]) => ({ id, job: fieldsToJob(fields) }));
}

export async function refreshQueueGauges(redis: Redis, config: AppConfig, metrics: Metrics): Promise<void> {
  const [depth, dlq, pending] = await Promise.all([
    redis.xlen(config.queueStream),
    redis.xlen(config.queueDlqStream),
    redis.xpending(config.queueStream, config.queueGroup)
  ]);
  metrics.queueDepth.set(Number(depth));
  metrics.dlqSize.set(Number(dlq));
  const pendingCount = Array.isArray(pending) ? Number(pending[0] ?? 0) : 0;
  metrics.pendingEntries.set(pendingCount);
}

function parseStream(result: [string, [string, string[]][]][]): StreamMessage[] {
  const messages: StreamMessage[] = [];
  for (const [, entries] of result) {
    for (const [id, fields] of entries) {
      messages.push({ id, job: fieldsToJob(fields) });
    }
  }
  return messages;
}

function fieldsToJob(fields: string[]): QueueJob {
  const map = new Map<string, string>();
  for (let i = 0; i < fields.length; i += 2) {
    map.set(fields[i], fields[i + 1]);
  }
  return {
    outboxEventId: map.get("outboxEventId") ?? "",
    notificationId: map.get("notificationId") ?? "",
    tenantId: map.get("tenantId") ?? "",
    attempt: Number(map.get("attempt") ?? 1),
    enqueuedAt: map.get("enqueuedAt") ?? new Date().toISOString()
  };
}

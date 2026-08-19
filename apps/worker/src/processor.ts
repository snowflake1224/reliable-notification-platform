import type { Redis } from "ioredis";
import type { Pool } from "pg";
import {
  acquireLock,
  channelRateLimit,
  consumeToken,
  getNotification,
  insertAudit,
  isClaimable,
  isTerminal,
  nextAttemptAt,
  notificationLockName,
  providerLimitKey,
  publishDlq,
  sendToProvider,
  type AppConfig,
  type FailureMode,
  type Logger,
  type Metrics,
  type QueueJob
} from "@nplat/shared";

export async function processJob(
  pool: Pool,
  redis: Redis,
  config: AppConfig,
  metrics: Metrics,
  logger: Logger,
  workerId: string,
  job: QueueJob
): Promise<"ack" | "retry_later"> {
  const log = logger.child({
    workerId,
    tenantId: job.tenantId,
    notificationId: job.notificationId,
    outboxEventId: job.outboxEventId
  });

  const lock = await acquireLock(
    redis,
    notificationLockName(job.notificationId),
    workerId,
    config.visibilityTimeoutMs
  );
  if (!lock) {
    log.info("skip; another worker holds the notification lock");
    return "retry_later";
  }

  const started = Date.now();
  try {
    const notification = await getNotification(pool, job.tenantId, job.notificationId);
    if (!notification) {
      log.warn("notification missing; acking poison message");
      return "ack";
    }
    if (isTerminal(notification.status)) {
      log.info({ status: notification.status }, "already terminal; acking duplicate delivery");
      return "ack";
    }
    if (!isClaimable(notification.status) && notification.status !== "processing") {
      log.info({ status: notification.status }, "not claimable; acking");
      return "ack";
    }

    const claimed = await pool.query(
      `UPDATE notifications
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           version = version + 1,
           updated_at = now()
       WHERE id = $1 AND tenant_id = $2
         AND status IN ('queued', 'retrying', 'pending', 'processing')
       RETURNING *`,
      [job.notificationId, job.tenantId]
    );

    if (!claimed.rowCount) {
      const latest = await getNotification(pool, job.tenantId, job.notificationId);
      if (latest && isTerminal(latest.status)) return "ack";
      log.info({ status: latest?.status }, "lost claim race");
      return "retry_later";
    }

    const current = claimed.rows[0];
    const attemptNumber = current.attempt_count as number;
    await pool.query(
      `INSERT INTO delivery_attempts
        (tenant_id, notification_id, attempt_number, worker_id, status, provider)
       VALUES ($1,$2,$3,$4,'started',$5)
       ON CONFLICT (notification_id, attempt_number) DO NOTHING`,
      [job.tenantId, job.notificationId, attemptNumber, workerId, current.channel]
    );
    await insertAudit(pool, {
      tenantId: job.tenantId,
      notificationId: job.notificationId,
      actor: "worker",
      action: "processing",
      fromStatus: notification.status,
      toStatus: "processing",
      metadata: { workerId, attemptNumber }
    });

    const limited = await consumeToken(
      redis,
      providerLimitKey(current.channel),
      channelRateLimit(config, current.channel)
    );
    if (!limited.allowed) {
      await finalizeAttempt(pool, {
        tenantId: job.tenantId,
        notificationId: job.notificationId,
        attemptNumber,
        status: "transient_failed",
        errorCode: "provider_rate_limited",
        errorClass: "transient",
        latencyMs: Date.now() - started
      });
      return scheduleRetry(pool, redis, config, metrics, log, job, current, "rate_limited");
    }

    const recipient = await recipientFor(pool, job.tenantId, current.user_id, current.channel);
    const failureMode = extractTestFailure(current.payload, config.allowTestFailures);
    const result = await sendToProvider(config, {
      tenantId: job.tenantId,
      notificationId: job.notificationId,
      channel: current.channel,
      to: recipient,
      subject: current.rendered_subject,
      body: current.rendered_body ?? "",
      idempotencyKey: job.notificationId,
      failureMode
    });

    metrics.providerLatency.observe({ provider: current.channel, result: result.kind }, result.latencyMs / 1000);
    if (result.kind !== "success") {
      metrics.providerErrors.inc({ provider: current.channel, kind: result.kind });
    }

    if (result.kind === "success") {
      await finalizeAttempt(pool, {
        tenantId: job.tenantId,
        notificationId: job.notificationId,
        attemptNumber,
        status: "succeeded",
        providerMessageId: result.providerMessageId,
        latencyMs: result.latencyMs
      });
      const delivered = await pool.query(
        `UPDATE notifications
         SET status = 'delivered',
             provider_message_id = $3,
             last_error_code = NULL,
             last_error_class = NULL,
             version = version + 1,
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2 AND status = 'processing'
         RETURNING created_at`,
        [job.notificationId, job.tenantId, result.providerMessageId]
      );
      if (delivered.rowCount) {
        await insertAudit(pool, {
          tenantId: job.tenantId,
          notificationId: job.notificationId,
          actor: "worker",
          action: "delivered",
          fromStatus: "processing",
          toStatus: "delivered"
        });
        const created = new Date(delivered.rows[0].created_at).getTime();
        metrics.e2eLatency.observe({ channel: current.channel }, (Date.now() - created) / 1000);
      }
      metrics.deliveries.inc({ result: "success", channel: current.channel });
      metrics.workerThroughput.inc({ result: "delivered", channel: current.channel });
      metrics.processingLatency.observe({ channel: current.channel }, (Date.now() - started) / 1000);
      log.info({ providerId: current.channel }, "delivered");
      return "ack";
    }

    const permanent = result.kind === "permanent";
    const errorCode =
      result.kind === "timeout"
        ? "timeout"
        : result.kind === "rate_limited"
          ? "provider_rate_limited"
          : result.code;
    await finalizeAttempt(pool, {
      tenantId: job.tenantId,
      notificationId: job.notificationId,
      attemptNumber,
      status: result.kind === "timeout" ? "timeout" : permanent ? "permanent_failed" : "transient_failed",
      errorCode,
      errorClass: permanent ? "permanent" : "transient",
      latencyMs: result.latencyMs
    });

    if (permanent || attemptNumber >= current.max_attempts) {
      await moveToDead(pool, redis, config, metrics, log, job, current, errorCode);
      metrics.processingLatency.observe({ channel: current.channel }, (Date.now() - started) / 1000);
      return "ack";
    }

    return scheduleRetry(pool, redis, config, metrics, log, job, current, errorCode);
  } finally {
    await lock.release();
  }
}

async function scheduleRetry(
  pool: Pool,
  _redis: Redis,
  config: AppConfig,
  metrics: Metrics,
  log: Logger,
  job: QueueJob,
  current: { channel: string; max_attempts: number; attempt_count: number },
  reason: string
): Promise<"ack"> {
  const when = nextAttemptAt({
    baseMs: 500,
    maxMs: 30_000,
    attempt: current.attempt_count,
    jitterRatio: 1
  });
  await pool.query(
    `UPDATE notifications
     SET status = 'retrying',
         next_attempt_at = $3,
         last_error_code = $4,
         last_error_class = 'transient',
         version = version + 1,
         updated_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status = 'processing'`,
    [job.notificationId, job.tenantId, when, reason]
  );
  await insertAudit(pool, {
    tenantId: job.tenantId,
    notificationId: job.notificationId,
    actor: "worker",
    action: "retry_scheduled",
    fromStatus: "processing",
    toStatus: "retrying",
    metadata: { nextAttemptAt: when.toISOString(), reason }
  });
  metrics.retries.inc({ channel: current.channel, reason });
  metrics.deliveries.inc({ result: "retry", channel: current.channel });
  metrics.workerThroughput.inc({ result: "retry", channel: current.channel });
  log.info({ nextAttemptAt: when.toISOString() }, "retry scheduled");
  void config;
  return "ack";
}

async function moveToDead(
  pool: Pool,
  redis: Redis,
  config: AppConfig,
  metrics: Metrics,
  log: Logger,
  job: QueueJob,
  current: { channel: string },
  reason: string
): Promise<void> {
  await pool.query(
    `UPDATE notifications
     SET status = 'dead',
         last_error_code = $3,
         last_error_class = CASE WHEN $3 = 'timeout' THEN 'transient' ELSE last_error_class END,
         version = version + 1,
         updated_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status IN ('processing', 'retrying')`,
    [job.notificationId, job.tenantId, reason]
  );
  await insertAudit(pool, {
    tenantId: job.tenantId,
    notificationId: job.notificationId,
    actor: "worker",
    action: "dead",
    fromStatus: "processing",
    toStatus: "dead",
    metadata: { reason }
  });
  await publishDlq(redis, config, job, reason);
  metrics.deliveries.inc({ result: "dead", channel: current.channel });
  metrics.workerThroughput.inc({ result: "dead", channel: current.channel });
  log.warn({ reason }, "moved to DLQ");
}

async function finalizeAttempt(
  pool: Pool,
  input: {
    tenantId: string;
    notificationId: string;
    attemptNumber: number;
    status: string;
    providerMessageId?: string;
    errorCode?: string;
    errorClass?: string;
    latencyMs: number;
  }
): Promise<void> {
  await pool.query(
    `UPDATE delivery_attempts
     SET status = $4,
         provider_message_id = $5,
         error_code = $6,
         error_class = $7,
         latency_ms = $8,
         finished_at = now()
     WHERE tenant_id = $1 AND notification_id = $2 AND attempt_number = $3`,
    [
      input.tenantId,
      input.notificationId,
      input.attemptNumber,
      input.status,
      input.providerMessageId ?? null,
      input.errorCode ?? null,
      input.errorClass ?? null,
      input.latencyMs
    ]
  );
}

async function recipientFor(
  pool: Pool,
  tenantId: string,
  userId: string,
  channel: string
): Promise<string> {
  const { rows } = await pool.query(
    `SELECT email, phone, push_token FROM users WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId]
  );
  const user = rows[0];
  if (!user) return "";
  if (channel === "email") return user.email ?? "";
  if (channel === "sms") return user.phone ?? "";
  return user.push_token ?? "";
}

function extractTestFailure(payload: unknown, allow?: boolean): FailureMode | undefined {
  if (!allow || !payload || typeof payload !== "object") return undefined;
  const test = (payload as { _test?: { failureMode?: FailureMode } })._test;
  return test?.failureMode;
}

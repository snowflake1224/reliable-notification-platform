import {
  ConflictError,
  insertAudit,
  insertOutbox,
  NotFoundError,
  pendingOutboxCount,
  renderTemplate,
  ServiceUnavailableError,
  sha256,
  ValidationError,
  withTransaction,
  type Channel,
  type FailureMode,
  type QueueJob
} from "@nplat/shared";
import type { Pool } from "pg";
import type { AppDeps } from "../context.js";

export interface CreateNotificationInput {
  tenantId: string;
  externalUserId: string;
  typeKey: string;
  channel: Channel;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  sendAt?: Date;
  requestId: string;
}

export async function createNotification(deps: AppDeps, input: CreateNotificationInput) {
  const backlog = await pendingOutboxCount(deps.pool);
  if (backlog >= deps.config.maxOutboxBacklog) {
    throw new ServiceUnavailableError("outbox backlog exceeded; retry later");
  }

  const requestHash = sha256(
    JSON.stringify({
      user: input.externalUserId,
      type: input.typeKey,
      channel: input.channel,
      payload: input.payload,
      sendAt: input.sendAt?.toISOString() ?? null
    })
  );

  return withTransaction(deps.pool, async (client) => {
    const existing = await client.query(
      `SELECT response_status, response_body, request_hash, notification_id
       FROM idempotency_records
       WHERE tenant_id = $1 AND key = $2
       FOR UPDATE`,
      [input.tenantId, input.idempotencyKey]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.request_hash !== requestHash) {
        throw new ConflictError("idempotency key reused with a different request");
      }
      return {
        replay: true,
        status: row.response_status as number,
        body: row.response_body as Record<string, unknown>
      };
    }

    const user = await client.query(
      `SELECT id, email, phone, push_token FROM users WHERE tenant_id = $1 AND external_id = $2`,
      [input.tenantId, input.externalUserId]
    );
    if (!user.rowCount) throw new NotFoundError("user not found");

    const type = await client.query(
      `SELECT id, category FROM notification_types WHERE tenant_id = $1 AND key = $2`,
      [input.tenantId, input.typeKey]
    );
    if (!type.rowCount) throw new NotFoundError("notification type not found");

    const pref = await client.query(
      `SELECT opted_in FROM user_preferences
       WHERE tenant_id = $1 AND user_id = $2 AND notification_type_id = $3 AND channel = $4`,
      [input.tenantId, user.rows[0].id, type.rows[0].id, input.channel]
    );
    const optedIn = pref.rowCount ? pref.rows[0].opted_in : true;
    if (!optedIn && type.rows[0].category === "marketing") {
      const cancelled = await client.query(
        `INSERT INTO notifications
          (tenant_id, user_id, notification_type_id, channel, status, idempotency_key, payload, send_at, max_attempts)
         VALUES ($1,$2,$3,$4,'cancelled',$5,$6::jsonb,$7,$8)
         RETURNING id, status`,
        [
          input.tenantId,
          user.rows[0].id,
          type.rows[0].id,
          input.channel,
          input.idempotencyKey,
          JSON.stringify(input.payload),
          input.sendAt ?? new Date(),
          deps.config.maxAttempts
        ]
      );
      await insertAudit(client, {
        tenantId: input.tenantId,
        notificationId: cancelled.rows[0].id,
        actor: "api",
        action: "cancelled_preference",
        toStatus: "cancelled"
      });
      const body = {
        id: cancelled.rows[0].id,
        status: "cancelled",
        reason: "user_opted_out"
      };
      await client.query(
        `INSERT INTO idempotency_records
          (tenant_id, key, request_hash, response_status, response_body, notification_id)
         VALUES ($1,$2,$3,200,$4::jsonb,$5)`,
        [input.tenantId, input.idempotencyKey, requestHash, JSON.stringify(body), cancelled.rows[0].id]
      );
      return { replay: false, status: 200, body };
    }

    const published = await client.query(
      `SELECT tv.id, tv.subject, tv.body
       FROM templates t
       JOIN template_versions tv ON tv.template_id = t.id AND tv.status = 'published'
       WHERE t.tenant_id = $1 AND t.notification_type_id = $2 AND t.channel = $3`,
      [input.tenantId, type.rows[0].id, input.channel]
    );
    if (!published.rowCount) throw new ValidationError("no published template for channel");

    const renderedSubject = published.rows[0].subject
      ? renderTemplate(published.rows[0].subject, input.payload)
      : null;
    const renderedBody = renderTemplate(published.rows[0].body, input.payload);
    const sendAt = input.sendAt ?? new Date();
    const immediate = sendAt.getTime() <= Date.now() + 50;

    const inserted = await client.query(
      `INSERT INTO notifications
        (tenant_id, user_id, notification_type_id, template_version_id, channel, status,
         idempotency_key, payload, rendered_subject, rendered_body, send_at, max_attempts)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7::jsonb,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING id, status, send_at`,
      [
        input.tenantId,
        user.rows[0].id,
        type.rows[0].id,
        published.rows[0].id,
        input.channel,
        input.idempotencyKey,
        JSON.stringify(input.payload),
        renderedSubject,
        renderedBody,
        sendAt,
        deps.config.maxAttempts
      ]
    );
    if (!inserted.rowCount) {
      const replay = await client.query(
        `SELECT response_status, response_body FROM idempotency_records
         WHERE tenant_id = $1 AND key = $2`,
        [input.tenantId, input.idempotencyKey]
      );
      if (replay.rowCount) {
        return {
          replay: true,
          status: replay.rows[0].response_status as number,
          body: replay.rows[0].response_body as Record<string, unknown>
        };
      }
      throw new ConflictError("concurrent idempotent request in progress");
    }
    const notificationId = inserted.rows[0].id as string;

    if (immediate) {
      const job: QueueJob = {
        outboxEventId: "",
        notificationId,
        tenantId: input.tenantId,
        attempt: 1,
        enqueuedAt: new Date().toISOString()
      };
      await insertOutbox(client, {
        tenantId: input.tenantId,
        notificationId,
        eventType: "notification.requested",
        payload: job
      });
    }

    await insertAudit(client, {
      tenantId: input.tenantId,
      notificationId,
      actor: "api",
      action: immediate ? "accepted_immediate" : "accepted_scheduled",
      toStatus: "pending",
      metadata: { requestId: input.requestId, sendAt: sendAt.toISOString() }
    });

    const body = {
      id: notificationId,
      status: "pending",
      sendAt: sendAt.toISOString(),
      scheduled: !immediate
    };
    await client.query(
      `INSERT INTO idempotency_records
        (tenant_id, key, request_hash, response_status, response_body, notification_id)
       VALUES ($1,$2,$3,202,$4::jsonb,$5)`,
      [input.tenantId, input.idempotencyKey, requestHash, JSON.stringify(body), notificationId]
    );

    return { replay: false, status: 202, body };
  });
}

export function extractFailureMode(
  payload: Record<string, unknown>,
  allow: boolean
): FailureMode | undefined {
  if (!allow) return undefined;
  const test = payload._test as { failureMode?: FailureMode } | undefined;
  return test?.failureMode;
}

export async function getRecipientAddress(
  pool: Pool,
  tenantId: string,
  userId: string,
  channel: Channel
): Promise<string> {
  const { rows } = await pool.query(
    `SELECT email, phone, push_token FROM users WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId]
  );
  const user = rows[0];
  if (!user) throw new NotFoundError("user not found");
  if (channel === "email") return user.email ?? "";
  if (channel === "sms") return user.phone ?? "";
  return user.push_token ?? "";
}

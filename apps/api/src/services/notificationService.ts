import {
  ConflictError,
  insertAudit,
  insertOutbox,
  NotFoundError,
  renderTemplate,
  sha256,
  ValidationError,
  withTransaction,
  type QueueJob
} from "@nplat/shared";
import type { AppDeps } from "../context.js";

export interface CreateNotificationInput {
  tenantId: string;
  externalUserId: string;
  typeKey: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  requestId: string;
}

export async function createNotification(deps: AppDeps, input: CreateNotificationInput) {
  const requestHash = sha256(
    JSON.stringify({
      user: input.externalUserId,
      type: input.typeKey,
      payload: input.payload
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
      `SELECT id FROM users WHERE tenant_id = $1 AND external_id = $2`,
      [input.tenantId, input.externalUserId]
    );
    if (!user.rowCount) throw new NotFoundError("user not found");

    const type = await client.query(
      `SELECT id FROM notification_types WHERE tenant_id = $1 AND key = $2`,
      [input.tenantId, input.typeKey]
    );
    if (!type.rowCount) throw new NotFoundError("notification type not found");

    const published = await client.query(
      `SELECT tv.id, tv.subject, tv.body
       FROM templates t
       JOIN template_versions tv ON tv.template_id = t.id AND tv.status = 'published'
       WHERE t.tenant_id = $1 AND t.notification_type_id = $2 AND t.channel = 'email'`,
      [input.tenantId, type.rows[0].id]
    );
    if (!published.rowCount) throw new ValidationError("no published email template for this type");

    const renderedSubject = published.rows[0].subject
      ? renderTemplate(published.rows[0].subject, input.payload)
      : null;
    const renderedBody = renderTemplate(published.rows[0].body, input.payload);

    const inserted = await client.query(
      `INSERT INTO notifications
        (tenant_id, user_id, notification_type_id, template_version_id, channel, status,
         idempotency_key, payload, rendered_subject, rendered_body, max_attempts)
       VALUES ($1,$2,$3,$4,'email','pending',$5,$6::jsonb,$7,$8,$9)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING id, status`,
      [
        input.tenantId,
        user.rows[0].id,
        type.rows[0].id,
        published.rows[0].id,
        input.idempotencyKey,
        JSON.stringify(input.payload),
        renderedSubject,
        renderedBody,
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

    await insertAudit(client, {
      tenantId: input.tenantId,
      notificationId,
      actor: "api",
      action: "accepted",
      toStatus: "pending",
      metadata: { requestId: input.requestId }
    });

    const body = { id: notificationId, status: "pending" };
    await client.query(
      `INSERT INTO idempotency_records
        (tenant_id, key, request_hash, response_status, response_body, notification_id)
       VALUES ($1,$2,$3,202,$4::jsonb,$5)`,
      [input.tenantId, input.idempotencyKey, requestHash, JSON.stringify(body), notificationId]
    );

    return { replay: false, status: 202, body };
  });
}

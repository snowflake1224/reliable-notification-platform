import type { Pool, PoolClient } from "pg";
import type { Channel, NotificationRow, NotificationStatus, OutboxEventRow, QueueJob } from "../types.js";

type Queryable = Pool | PoolClient;

export async function insertAudit(
  db: Queryable,
  input: {
    tenantId: string;
    notificationId?: string | null;
    actor: string;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (tenant_id, notification_id, actor, action, from_status, to_status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.tenantId,
      input.notificationId ?? null,
      input.actor,
      input.action,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

export async function insertOutbox(
  db: Queryable,
  input: {
    tenantId: string;
    notificationId: string;
    eventType: string;
    payload: QueueJob;
    availableAt?: Date;
  }
): Promise<OutboxEventRow> {
  const { rows } = await db.query<OutboxEventRow>(
    `INSERT INTO outbox_events
      (tenant_id, aggregate_type, aggregate_id, event_type, payload, available_at)
     VALUES ($1, 'notification', $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [
      input.tenantId,
      input.notificationId,
      input.eventType,
      JSON.stringify(input.payload),
      input.availableAt ?? new Date()
    ]
  );
  return rows[0];
}

export async function claimOutboxBatch(
  db: Queryable,
  claimedBy: string,
  batchSize: number,
  staleAfterMs: number
): Promise<OutboxEventRow[]> {
  const { rows } = await db.query<OutboxEventRow>(
    `WITH cte AS (
       SELECT id FROM outbox_events
       WHERE available_at <= now()
         AND (
           status = 'pending'
           OR (status = 'publishing' AND claimed_at < now() - ($3 * interval '1 millisecond'))
         )
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE outbox_events o
     SET status = 'publishing',
         claimed_at = now(),
         claimed_by = $1,
         attempts = o.attempts + 1
     FROM cte
     WHERE o.id = cte.id
     RETURNING o.*`,
    [claimedBy, batchSize, staleAfterMs]
  );
  return rows;
}

export async function markOutboxPublished(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE outbox_events
     SET status = 'published', published_at = now(), last_error = NULL
     WHERE id = $1 AND status = 'publishing'`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

export async function markOutboxFailed(db: Queryable, id: string, error: string): Promise<void> {
  await db.query(
    `UPDATE outbox_events
     SET status = CASE WHEN attempts >= 20 THEN 'failed' ELSE 'pending' END,
         available_at = now() + interval '2 seconds',
         last_error = $2
     WHERE id = $1 AND status = 'publishing'`,
    [id, error.slice(0, 500)]
  );
}

export async function transitionNotification(
  db: Queryable,
  input: {
    id: string;
    tenantId: string;
    from: NotificationStatus[];
    to: NotificationStatus;
    expectedVersion?: number;
    extra?: string;
    extraParams?: unknown[];
  }
): Promise<NotificationRow | null> {
  const fromPlaceholders = input.from.map((_, i) => `$${i + 3}`).join(", ");
  let versionClause = "";
  const params: unknown[] = [input.id, input.tenantId, ...input.from];
  let next = params.length + 1;
  if (input.expectedVersion !== undefined) {
    versionClause = ` AND version = $${next}`;
    params.push(input.expectedVersion);
    next += 1;
  }
  const extra = input.extra ?? "";
  const extraParams = input.extraParams ?? [];
  params.push(...extraParams);

  const { rows } = await db.query<NotificationRow>(
    `UPDATE notifications
     SET status = '${input.to}',
         version = version + 1,
         updated_at = now()
         ${extra}
     WHERE id = $1 AND tenant_id = $2 AND status IN (${fromPlaceholders})${versionClause}
     RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

export async function getNotification(
  db: Queryable,
  tenantId: string,
  id: string
): Promise<NotificationRow | null> {
  const { rows } = await db.query<NotificationRow>(
    `SELECT * FROM notifications WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return rows[0] ?? null;
}

export async function getNotificationById(db: Queryable, id: string): Promise<NotificationRow | null> {
  const { rows } = await db.query<NotificationRow>(`SELECT * FROM notifications WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function pendingOutboxCount(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM outbox_events WHERE status IN ('pending', 'publishing')`
  );
  return Number(rows[0]?.count ?? 0);
}

export async function claimDueNotifications(
  db: Queryable,
  batchSize: number,
  claimedBy: string
): Promise<NotificationRow[]> {
  const { rows } = await db.query<NotificationRow>(
    `WITH due AS (
       SELECT id FROM notifications
       WHERE (
         (status = 'pending' AND send_at <= now())
         OR (status = 'retrying' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now())
       )
       ORDER BY COALESCE(next_attempt_at, send_at)
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     SELECT n.* FROM notifications n
     JOIN due ON due.id = n.id`,
    [batchSize]
  );
  void claimedBy;
  return rows;
}

export async function findPreference(
  db: Queryable,
  tenantId: string,
  userId: string,
  typeId: string,
  channel: Channel
): Promise<{ opted_in: boolean } | null> {
  const { rows } = await db.query<{ opted_in: boolean }>(
    `SELECT opted_in FROM user_preferences
     WHERE tenant_id = $1 AND user_id = $2 AND notification_type_id = $3 AND channel = $4`,
    [tenantId, userId, typeId, channel]
  );
  return rows[0] ?? null;
}

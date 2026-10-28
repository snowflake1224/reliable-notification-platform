import { NotFoundError, refreshQueueGauges } from "@nplat/shared";
import { Router } from "express";

export const demoRoutes = Router();

demoRoutes.get("/stats", async (req, res, next) => {
  try {
    if (!req.deps.config.demoMode) throw new NotFoundError("demo stats are disabled");

    await refreshQueueGauges(req.deps.redis, req.deps.config, req.deps.metrics);
    const [depth, dlq, pending, retrying, outbox] = await Promise.all([
      req.deps.redis.xlen(req.deps.config.queueStream),
      req.deps.redis.xlen(req.deps.config.queueDlqStream),
      req.deps.redis.xpending(req.deps.config.queueStream, req.deps.config.queueGroup),
      req.deps.pool.query(`SELECT count(*)::int AS count FROM notifications WHERE status = 'retrying'`),
      req.deps.pool.query(
        `SELECT status, count(*)::int AS count
         FROM outbox_events
         GROUP BY status`
      )
    ]);

    res.json({
      queue: {
        stream: req.deps.config.queueStream,
        depth,
        dlq,
        pending: Array.isArray(pending) ? pending[0] : 0,
        retrying: retrying.rows[0]?.count ?? 0
      },
      outbox: { statuses: outbox.rows }
    });
  } catch (err) {
    next(err);
  }
});

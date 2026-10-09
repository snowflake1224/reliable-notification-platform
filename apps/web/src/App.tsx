import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEMO_KEY,
  getOutboxStats,
  getPreferences,
  getQueueStats,
  getReady,
  getSimulate,
  getTrace,
  listMail,
  listNotifications,
  loginAdmin,
  postNotification,
  putPreference,
  readMail,
  replayWebhook,
  setOutage,
  type ListedNotification,
  type MailSummary,
  type OutboxStats,
  type Preference,
  type QueueStats,
  type Ready,
  type SimulateState,
  type Trace
} from "./api";
import { buildStages, clock, shortId, type AcceptMeta } from "./stages";

type SendBody = {
  userId: "user-1";
  type: string;
  channel: "email";
  payload: Record<string, unknown>;
  sendAt?: string;
};

export function App() {
  const selectedRef = useRef<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [accepts, setAccepts] = useState<Record<string, AcceptMeta>>({});
  const [recent, setRecent] = useState<ListedNotification[]>([]);
  const [queue, setQueue] = useState<QueueStats | null>(null);
  const [outboxStats, setOutboxStats] = useState<OutboxStats | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [simulate, setSimulate] = useState<SimulateState | null>(null);
  const [mail, setMail] = useState<MailSummary[]>([]);
  const [openMailId, setOpenMailId] = useState<string | null>(null);
  const [mailText, setMailText] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downSeconds, setDownSeconds] = useState(20);
  const [laterMinutes, setLaterMinutes] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  const [lastRequest, setLastRequest] = useState<{ key: string; body: SendBody } | null>(null);

  const choose = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
  }, []);

  const refresh = useCallback(async () => {
    const [health, sim, inbox, list, preferences] = await Promise.all([
      getReady(),
      getSimulate(),
      listMail(),
      listNotifications(DEMO_KEY),
      getPreferences(DEMO_KEY)
    ]);
    setReady(health);
    setSimulate(sim);
    setMail(inbox);
    setRecent(list);
    setPrefs(preferences);
    let token = adminToken;
    if (!token) {
      try {
        token = await loginAdmin();
        setAdminToken(token);
        setAdminError(null);
      } catch (err) {
        setAdminError(err instanceof Error ? err.message : "admin login failed");
      }
    }
    if (token) {
      const [stats, outbox] = await Promise.all([getQueueStats(token), getOutboxStats(token)]);
      setQueue(stats);
      setOutboxStats(outbox);
    }
    if (selectedRef.current) {
      setTrace(await getTrace(DEMO_KEY, selectedRef.current));
    }
  }, [adminToken]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      await work();
      await refresh();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  async function send(body: SendBody, key = `demo-${Date.now()}`) {
    const result = await postNotification(DEMO_KEY, key, body);
    setLastRequest({ key, body });
    if (!result.body.id) {
      const message = result.body.error?.message ?? `HTTP ${result.status}`;
      setBanner(`${message}${result.instance ? ` · ${result.instance}` : ""}`);
      return;
    }
    const meta: AcceptMeta = {
      status: result.status,
      instance: result.instance,
      replay: Boolean(result.body.replay),
      key
    };
    setAccepts((current) => ({ ...current, [result.body.id!]: meta }));
    choose(result.body.id);
    setTrace(await getTrace(DEMO_KEY, result.body.id));
    setBanner(
      result.body.replay
        ? `Same idempotency key returned ${shortId(result.body.id)} · HTTP ${result.status}`
        : `HTTP ${result.status} ${result.body.status ?? ""} · ${result.instance ?? "instance unknown"}`
    );
  }

  function orderPayload(): Record<string, unknown> {
    return { name: "Ada", orderId: String(Date.now()).slice(-6) };
  }

  const notification = trace?.notification;
  const accept = selectedId ? (accepts[selectedId] ?? null) : null;
  const stages = buildStages(trace, accept, now);
  const downUntil = simulate?.downUntil ?? null;
  const downLeft = downUntil != null && downUntil > now ? Math.ceil((downUntil - now) / 1000) : 0;
  const promoOut = prefs.some((pref) => pref.type === "promo.weekly" && pref.channel === "email" && !pref.opted_in);

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Reliable notification platform</p>
          <h1>Console</h1>
        </div>
        <p className={`health ${ready?.ready ? "ok" : "down"}`}>
          {ready?.ready ? "Postgres and Redis are up" : ready ? "Not ready" : "Checking health"}
          {ready ? ` · postgres ${ready.postgres} · redis ${ready.redis}` : ""}
        </p>
      </header>

      <main className="layout">
        <section className="panel controls">
          <p className="lead">
            A 202 means the notification and outbox event were committed. Delivery happens after that, on a worker. Stages stay dim until the row exists.
          </p>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void run(() => send({ userId: "user-1", type: "order.shipped", channel: "email", payload: orderPayload() }))}>
              Deliver now
            </button>
            <label className="field">
              Receiver down for
              <input
                type="number"
                min={1}
                max={90}
                value={downSeconds}
                onChange={(event) => setDownSeconds(Number(event.target.value))}
              />
              seconds
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const seconds = Math.min(90, Math.max(1, Math.floor(downSeconds) || 1));
                  await setOutage(seconds * 1000);
                  await send({ userId: "user-1", type: "order.shipped", channel: "email", payload: orderPayload() });
                })
              }
            >
              Hold the receiver, then send
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  send({
                    userId: "user-1",
                    type: "order.shipped",
                    channel: "email",
                    payload: { ...orderPayload(), _test: { failureMode: "permanent" } }
                  })
                )
              }
            >
              Bad address
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await putPreference(DEMO_KEY, false);
                  await send({
                    userId: "user-1",
                    type: "promo.weekly",
                    channel: "email",
                    payload: { name: "Ada" }
                  });
                })
              }
            >
              Opt out and send promo
            </button>
            <button
              disabled={busy || !promoOut}
              onClick={() =>
                void run(async () => {
                  await putPreference(DEMO_KEY, true);
                  setBanner("promo.weekly email is opted in again");
                })
              }
            >
              Opt back in
            </button>
            <label className="field">
              Send in
              <input
                type="number"
                min={1}
                max={30}
                value={laterMinutes}
                onChange={(event) => setLaterMinutes(Number(event.target.value))}
              />
              minutes
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(() => {
                  const minutes = Math.min(30, Math.max(1, Math.floor(laterMinutes) || 1));
                  return send({
                    userId: "user-1",
                    type: "order.shipped",
                    channel: "email",
                    payload: orderPayload(),
                    sendAt: new Date(Date.now() + minutes * 60_000).toISOString()
                  });
                })
              }
            >
              Schedule send
            </button>
            <button disabled={busy || !lastRequest} onClick={() => void run(() => send(lastRequest!.body, lastRequest!.key))}>
              Same idempotency key
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await replayWebhook();
                  setBanner(
                    result.body.status
                      ? `Webhook replay returned ${result.body.status}`
                      : (result.body.error ?? `Webhook replay HTTP ${result.status}`)
                  );
                })
              }
            >
              Replay last webhook
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await postNotification("nplat_live_not_a_real_key", `bad-${Date.now()}`, {
                    userId: "user-1",
                    type: "order.shipped",
                    channel: "email",
                    payload: orderPayload()
                  });
                  setBanner(
                    `Wrong key · HTTP ${result.status} · ${result.body.error?.code ?? "error"} · ${result.body.error?.message ?? ""}`
                  );
                })
              }
            >
              Wrong API key
            </button>
          </div>
          <p className="meta">user-1 · promo.weekly email {promoOut ? "opted out" : "opted in"}</p>
          {banner ? <p className="banner">{banner}</p> : null}
          <h2>Recent</h2>
          <ul className="recent">
            {recent.length === 0 ? <li className="muted">No notifications yet.</li> : null}
            {recent.map((item) => (
              <li key={item.id}>
                <button
                  className={item.id === selectedId ? "active" : ""}
                  onClick={() => {
                    choose(item.id);
                    setTrace(null);
                    void getTrace(DEMO_KEY, item.id).then((next) => {
                      if (selectedRef.current === item.id) setTrace(next);
                    });
                  }}
                >
                  <span className={`pill status-${item.status}`}>{item.status}</span>
                  <span>{item.type_key}</span>
                  <span className="muted">{clock(item.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel trace">
          {!notification ? (
            <p className="lead">Send one. This column fills from Postgres, not from a timer.</p>
          ) : (
            <>
              <div className="trace-head">
                <div>
                  <p className="eyebrow">{notification.type_key} · {notification.channel} · {notification.external_user_id}</p>
                  <h2>{shortId(notification.id)}</h2>
                </div>
                <span className={`pill status-${notification.status}`}>{notification.status}</span>
              </div>
              {(notification.rendered_subject || notification.rendered_body) && (
                <div className="message">
                  <p className="eyebrow">Rendered</p>
                  {notification.rendered_subject ? <p className="subject">{notification.rendered_subject}</p> : null}
                  <p>{notification.rendered_body}</p>
                </div>
              )}
            </>
          )}
          <ol className="stages">
            {stages.map((stage) => (
              <li key={stage.name} className={`stage ${stage.state}`}>
                <span className="stage-name">{stage.name}</span>
                <span>{stage.detail}</span>
              </li>
            ))}
          </ol>
          {trace && trace.attempts.length > 0 ? (
            <>
              <h2>Attempts</h2>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Worker</th>
                    <th>Status</th>
                    <th>Error</th>
                    <th>ms</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.attempts.map((attempt) => (
                    <tr key={attempt.attempt_number}>
                      <td>{attempt.attempt_number}</td>
                      <td>{shortId(attempt.worker_id)}</td>
                      <td>{attempt.status}</td>
                      <td>{attempt.error_code ?? "—"}</td>
                      <td>{attempt.latency_ms ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {trace && trace.audit.length > 0 ? (
            <>
              <h2>Audit</h2>
              <ul className="audit">
                {trace.audit.map((event, index) => {
                  const nextAt = event.metadata && typeof event.metadata.nextAttemptAt === "string" ? event.metadata.nextAttemptAt : null;
                  return (
                    <li key={`${event.created_at}-${index}`}>
                      <span className="muted">{clock(event.created_at)}</span> {event.actor} {event.action}
                      {event.from_status || event.to_status ? ` · ${event.from_status ?? "—"} → ${event.to_status ?? "—"}` : ""}
                      {nextAt ? ` · next ${clock(nextAt)}` : ""}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>

        <aside className="side">
          <section className="panel">
            <h2>System</h2>
            <p className="meta">Receiver {downLeft > 0 ? `down for ${downLeft}s` : "accepting"}</p>
            {adminError ? <p className="banner">{adminError}</p> : null}
            <dl className="stats">
              <div><dt>Stream depth</dt><dd>{queue?.depth ?? "—"}</dd></div>
              <div><dt>Pending</dt><dd>{queue?.pending ?? "—"}</dd></div>
              <div><dt>Dead letter</dt><dd>{queue?.dlq ?? "—"}</dd></div>
              <div><dt>Scheduler due</dt><dd>{queue?.schedulerDue ?? "—"}</dd></div>
              <div><dt>Outbox pending</dt><dd>{outboxCount(outboxStats, "pending")}</dd></div>
              <div><dt>Publishing</dt><dd>{outboxCount(outboxStats, "publishing")}</dd></div>
              <div><dt>Published</dt><dd>{outboxCount(outboxStats, "published")}</dd></div>
              <div><dt>Failed</dt><dd>{outboxCount(outboxStats, "failed")}</dd></div>
            </dl>
            <p className="meta">{queue?.stream ?? "nplat:jobs"}</p>
          </section>
          <section className="panel">
            <h2>Inbox</h2>
            <ul className="mail">
              {mail.length === 0 ? <li className="muted">No mail yet. Email lands here after a successful send.</li> : null}
              {mail.map((message) => (
                <li key={message.ID}>
                  <button
                    className={message.ID === openMailId ? "active" : ""}
                    onClick={() => {
                      setOpenMailId(message.ID);
                      void readMail(message.ID).then(setMailText);
                    }}
                  >
                    <strong>{message.Subject || "(no subject)"}</strong>
                    <span className="muted">{message.To?.[0]?.Address ?? ""} · {clock(message.Created)}</span>
                    <span>{message.Snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
            {mailText ? <pre className="mail-body">{mailText}</pre> : null}
          </section>
        </aside>
      </main>
    </div>
  );
}

function outboxCount(stats: OutboxStats | null, status: string): number | string {
  if (!stats) return "—";
  return stats.statuses.find((row) => row.status === status)?.count ?? 0;
}

import { Router } from "express";
import { checkReadiness } from "@nplat/shared";
import { PREFER_DARK_MAILPIT, SITE_CSS_URL, siteHeader } from "../ui/siteHeader.js";

export const homeRoutes = Router();

homeRoutes.get("/", async (req, res, next) => {
  try {
    const ready = await checkReadiness(req.deps.pool, req.deps.redis);
    const body = {
      service: "reliable-notification-platform",
      ready: ready.ready,
      postgres: ready.postgres,
      redis: ready.redis,
      instance: req.deps.config.instanceId,
      links: {
        console: "/console/",
        apiDocs: "/docs/",
        testInbox: "/console/inbox/",
        mailpit: "/mailpit/"
      }
    };
    const accept = req.header("accept") ?? "";
    if (accept.includes("application/json") && !accept.includes("text/html")) {
      res.json(body);
      return;
    }
    const status = ready.ready ? "ready" : "not ready";
    const tone = ready.ready ? "ok" : "bad";
    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reliable Notification Platform</title>
  <link rel="stylesheet" href="${SITE_CSS_URL}" />
  <script>${PREFER_DARK_MAILPIT}</script>
  <style>
    * { box-sizing: border-box; }
    a { color: var(--accent); }
    code { color: var(--amber); font-family: var(--mono); }
    main { max-width: 1040px; margin: 0 auto; padding: 48px 22px 72px; }
    h1 { font-size: clamp(2rem, 4vw, 3.1rem); line-height: 1.05; margin: 0 0 16px; max-width: 16ch; }
    h2 { margin: 0 0 8px; font-size: 1.35rem; }
    .lede { max-width: 62ch; color: var(--muted); line-height: 1.6; font-size: 1.05rem; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 18px 0 22px;
      padding: 7px 12px;
      border-radius: 999px;
      font-size: 0.92rem;
    }
    .status.ok { background: var(--ok-bg); color: var(--ok); }
    .status.bad { background: var(--bad-bg); color: var(--bad); }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 0 0 currentColor;
      animation: pulse 2.2s ease-out infinite;
    }
    .actions { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
    .button {
      display: inline-block;
      background: var(--accent);
      color: #0c1116;
      text-decoration: none;
      font-weight: 650;
      padding: 12px 16px;
      border-radius: 10px;
    }
    .button:hover { filter: brightness(1.08); }
    section { margin-top: 56px; }
    .section-intro { color: var(--muted); max-width: 68ch; line-height: 1.55; }
    .pipeline {
      position: relative;
      margin-top: 22px;
      padding: 22px 16px 18px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(21, 28, 36, 0.85);
      overflow: hidden;
    }
    .rail {
      position: absolute;
      left: 8%;
      right: 8%;
      top: 46px;
      height: 2px;
      background: linear-gradient(90deg, transparent, #35506a, transparent);
    }
    .bead {
      position: absolute;
      top: 41px;
      width: 12px;
      height: 12px;
      margin-left: -6px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 16px var(--accent);
      animation: travel 9s linear infinite;
    }
    .stages {
      position: relative;
      display: grid;
      grid-template-columns: repeat(8, minmax(0, 1fr));
      gap: 8px;
    }
    .stage { text-align: center; animation: rise 0.7s ease both; }
    .stage:nth-child(1) { animation-delay: 0.05s; }
    .stage:nth-child(2) { animation-delay: 0.15s; }
    .stage:nth-child(3) { animation-delay: 0.25s; }
    .stage:nth-child(4) { animation-delay: 0.35s; }
    .stage:nth-child(5) { animation-delay: 0.45s; }
    .stage:nth-child(6) { animation-delay: 0.55s; }
    .stage:nth-child(7) { animation-delay: 0.65s; }
    .stage:nth-child(8) { animation-delay: 0.75s; }
    .node {
      width: 16px;
      height: 16px;
      margin: 14px auto 10px;
      border-radius: 50%;
      border: 2px solid var(--accent);
      background: #0c1116;
      animation: glow 9s linear infinite;
    }
    .stage:nth-child(1) .node { animation-delay: 0s; }
    .stage:nth-child(2) .node { animation-delay: 1.05s; }
    .stage:nth-child(3) .node { animation-delay: 2.1s; }
    .stage:nth-child(4) .node { animation-delay: 3.15s; }
    .stage:nth-child(5) .node { animation-delay: 4.2s; }
    .stage:nth-child(6) .node { animation-delay: 5.25s; }
    .stage:nth-child(7) .node { animation-delay: 6.3s; }
    .stage:nth-child(8) .node { animation-delay: 7.35s; }
    .stage strong { display: block; font-size: 0.82rem; }
    .stage span { display: block; margin-top: 4px; color: var(--muted); font-size: 0.72rem; line-height: 1.3; }
    .steps, .facts, .stack, .explore { display: grid; gap: 12px; margin-top: 18px; }
    .steps { grid-template-columns: 1fr 1fr; }
    .facts { grid-template-columns: repeat(3, 1fr); }
    .explore { grid-template-columns: repeat(2, 1fr); }
    .card, .fact {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 16px 16px 14px;
      animation: rise 0.8s ease both;
    }
    .card p, .fact p { margin: 8px 0 0; color: var(--muted); line-height: 1.5; }
    .destination {
      display: block;
      color: var(--text);
      text-decoration: none;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 17px;
    }
    .destination:hover { border-color: var(--accent); transform: translateY(-2px); }
    .destination strong { display: block; margin-bottom: 7px; }
    .destination p { margin: 0; color: var(--muted); line-height: 1.5; }
    .route { display: inline-block; margin-top: 13px; color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.84rem; }
    .card { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; }
    .num {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: #1c3144;
      color: var(--accent);
      font-weight: 700;
    }
    .card h3, .fact h3 { margin: 2px 0 0; font-size: 1rem; }
    .steps .card:nth-child(1) { animation-delay: 0.05s; }
    .steps .card:nth-child(2) { animation-delay: 0.12s; }
    .steps .card:nth-child(3) { animation-delay: 0.19s; }
    .steps .card:nth-child(4) { animation-delay: 0.26s; }
    .steps .card:nth-child(5) { animation-delay: 0.33s; }
    .steps .card:nth-child(6) { animation-delay: 0.4s; }
    .stack { grid-template-columns: repeat(3, 1fr); }
    .group h3 { margin: 0 0 10px; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      border: 1px solid var(--line);
      background: #101820;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 0.88rem;
    }
    @keyframes travel {
      0% { left: 8%; }
      100% { left: 92%; }
    }
    @keyframes glow {
      0%, 14% { background: var(--accent); box-shadow: 0 0 12px var(--accent); }
      22%, 100% { background: #0c1116; box-shadow: none; }
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 currentColor; }
      70% { box-shadow: 0 0 0 8px transparent; }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: none; }
    }
    @media (max-width: 860px) {
      .stages { grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 16px; }
      .rail, .bead { display: none; }
      .steps, .facts, .stack, .explore { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
</head>
<body class="site">
  ${siteHeader("home")}
  <main>
    <p class="kicker">Notification platform</p>
    <h1>Accept is a database write. Delivery happens later.</h1>
    <p class="lede">A client gets HTTP 202 when the notification, its outbox event, and the idempotency record commit together. Workers publish that event and talk to the provider after the request is already done.</p>
    <p class="status ${tone}"><span class="dot"></span>${status} · postgres ${escapeHtml(ready.postgres)} · redis ${escapeHtml(ready.redis)} · <code>${escapeHtml(req.deps.config.instanceId)}</code></p>
    <div class="actions">
      <a class="button" href="/console/">Open the console</a>
      <span class="section-intro">Send one from the console and watch it move from accept to the inbox.</span>
    </div>

    <section>
      <h2>Explore the running project</h2>
      <p class="section-intro">Every page shares the navigation bar at the top. The other routes are machine-facing APIs, webhooks, health checks, and metrics—not separate user interfaces.</p>
      <div class="explore">
        <a class="destination" href="/">
          <strong>Home and architecture</strong>
          <p>The system design, request path, reliability guarantees, and technology stack.</p>
          <span class="route">/</span>
        </a>
        <a class="destination" href="/console/">
          <strong>Interactive console</strong>
          <p>Send demo notifications, trigger failures and retries, inspect attempts, audit events, queue state, and captured email.</p>
          <span class="route">/console/</span>
        </a>
        <a class="destination" href="/docs/">
          <strong>API documentation</strong>
          <p>Explore the OpenAPI contract, authentication methods, request schemas, responses, and every supported endpoint.</p>
          <span class="route">/docs/</span>
        </a>
        <a class="destination" href="/console/inbox/">
          <strong>Test inbox</strong>
          <p>Every email the simulator sent, captured by Mailpit over SMTP. Read the subject and body without emailing a real person. The full Mailpit UI stays available at <code>/mailpit/</code>.</p>
          <span class="route">/console/inbox/</span>
        </a>
      </div>
    </section>

    <section>
      <h2>One request, then a queue</h2>
      <p class="section-intro">Nginx spreads traffic across <strong>two API instances of the same application</strong>. They run identical code, share Postgres and Redis, and keep no notification state in process memory. The API does not wait for the provider.</p>
      <div class="pipeline" aria-hidden="true">
        <div class="rail"></div>
        <div class="bead"></div>
        <div class="stages">
          <div class="stage"><div class="node"></div><strong>Client</strong><span>HTTP POST</span></div>
          <div class="stage"><div class="node"></div><strong>Nginx</strong><span>least_conn</span></div>
          <div class="stage"><div class="node"></div><strong>API x2</strong><span>same app, 2 instances</span></div>
          <div class="stage"><div class="node"></div><strong>Postgres</strong><span>outbox commit</span></div>
          <div class="stage"><div class="node"></div><strong>Redis</strong><span>stream</span></div>
          <div class="stage"><div class="node"></div><strong>Worker</strong><span>lock and send</span></div>
          <div class="stage"><div class="node"></div><strong>Provider</strong><span>email, sms, push</span></div>
          <div class="stage"><div class="node"></div><strong>Webhook</strong><span>HMAC back</span></div>
        </div>
      </div>
    </section>

    <section>
      <h2>What the 202 is promising</h2>
      <div class="facts">
        <article class="fact">
          <h3>The row is durable</h3>
          <p>The notification and the outbox event share one Postgres transaction. A crash after 202 still leaves work the dispatcher can publish.</p>
        </article>
        <article class="fact">
          <h3>The provider is later</h3>
          <p>Email, SMS, and push are a simulator behind the worker. Captured mail shows up in the console inbox.</p>
        </article>
        <article class="fact">
          <h3>A replay stays one send</h3>
          <p>The same idempotency key returns the original accept. A Redis lock and the provider’s own idempotency keep a second worker from double-delivering.</p>
        </article>
      </div>
    </section>

    <section>
      <h2>How a notification moves</h2>
      <div class="steps">
        <article class="card"><div class="num">1</div><div><h3>Edge</h3><p>Nginx receives the call and picks between two instances of the same API service using the fewest open connections. Both are stateless and stamp <code>x-nplat-instance</code>.</p></div></article>
        <article class="card"><div class="num">2</div><div><h3>Accept</h3><p>The API checks an API key or a JWT, applies a Redis token bucket, and validates the body with Zod. Marketing mail that the user opted out of is cancelled here.</p></div></article>
        <article class="card"><div class="num">3</div><div><h3>Outbox</h3><p>If <code>send_at</code> is due, the dispatcher claims the row with <code>FOR UPDATE SKIP LOCKED</code> and appends it to the Redis stream <code>nplat:jobs</code>.</p></div></article>
        <article class="card"><div class="num">4</div><div><h3>Workers</h3><p>The consumer group <code>workers</code> reads the stream. A future <code>send_at</code> waits for the scheduler, which inserts the outbox row when it is time.</p></div></article>
        <article class="card"><div class="num">5</div><div><h3>Retry</h3><p>A failed attempt is acknowledged, then stored as <code>retrying</code> with full-jitter backoff. The base is 500ms and the cap is 30 seconds. Exhausted jobs land on <code>nplat:jobs:dlq</code>.</p></div></article>
        <article class="card"><div class="num">6</div><div><h3>Proof</h3><p>The provider calls back through Nginx with an HMAC webhook. The console shows the status, attempts, audit rows, and the message Mailpit captured.</p></div></article>
      </div>
    </section>

    <section>
      <h2>What it runs on</h2>
      <p class="section-intro">One Docker Compose stack. Postgres and Redis stay the source of truth and the queue. Prometheus and Grafana read the same process metrics the API and workers expose.</p>
      <div class="stack">
        <div class="group card">
          <h3>Services</h3>
          <div class="chips"><span class="chip">TypeScript</span><span class="chip">Node.js 20</span><span class="chip">Express 4</span><span class="chip">Zod</span><span class="chip">Pino</span></div>
        </div>
        <div class="group card">
          <h3>Data and queue</h3>
          <div class="chips"><span class="chip">PostgreSQL 16</span><span class="chip">Redis 7 Streams</span><span class="chip">ioredis</span><span class="chip">node-postgres</span></div>
        </div>
        <div class="group card">
          <h3>Edge and ops</h3>
          <div class="chips"><span class="chip">Nginx 1.27</span><span class="chip">Docker Compose</span><span class="chip">Prometheus 2.55</span><span class="chip">Grafana 11.3</span><span class="chip">Mailpit</span></div>
        </div>
        <div class="group card">
          <h3>Auth</h3>
          <div class="chips"><span class="chip">API keys</span><span class="chip">JWT</span><span class="chip">HMAC webhooks</span></div>
        </div>
        <div class="group card">
          <h3>Checks</h3>
          <div class="chips"><span class="chip">Vitest</span><span class="chip">Testcontainers</span><span class="chip">k6</span></div>
        </div>
        <div class="group card">
          <h3>Delivery</h3>
          <div class="chips"><span class="chip">At-least-once</span><span class="chip">Transactional outbox</span><span class="chip">Redis lock</span><span class="chip">Dead letter stream</span></div>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char] ?? char;
  });
}

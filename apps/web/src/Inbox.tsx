import { useCallback, useEffect, useState } from "react";
import { listMail, readMailDetail, type MailDetail, type MailSummary } from "./api";
import { SiteHeader } from "./SiteHeader";
import { clock } from "./stages";

export function Inbox() {
  const [mail, setMail] = useState<MailSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);

  const refresh = useCallback(async () => {
    setMail(await listMail(50));
  }, []);

  useEffect(() => {
    document.title = "Inbox · Reliable Notification Platform";
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  function open(id: string) {
    setOpenId(id);
    setDetail(null);
    void readMailDetail(id).then(setDetail);
  }

  return (
    <div className="app">
      <SiteHeader active="inbox" />
      <div className="page-head">
        <div>
          <p className="kicker">Test inbox</p>
          <h1>Inbox</h1>
          <p>
            Email the provider simulator sent over SMTP, captured by Mailpit. Nothing here reaches a real mailbox. Send one from
            the <a href="/console/">console</a> and it shows up within a few seconds.
          </p>
        </div>
        <a className="ghost-link" href="/mailpit/">Open full Mailpit UI</a>
      </div>

      <main className="layout inbox-layout">
        <section className="panel">
          <h2>Messages{mail ? ` · ${mail.length}` : ""}</h2>
          <ul className="mail">
            {mail === null ? <li className="muted">Loading…</li> : null}
            {mail?.length === 0 ? <li className="muted">No mail yet. Use “Deliver now” in the console.</li> : null}
            {mail?.map((message) => (
              <li key={message.ID}>
                <button className={message.ID === openId ? "active" : ""} onClick={() => open(message.ID)}>
                  <strong>{message.Subject || "(no subject)"}</strong>
                  <span className="muted">{message.To?.[0]?.Address ?? ""} · {clock(message.Created)}</span>
                  <span className="snippet">{message.Snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel reader">
          {!openId ? (
            <p className="lead">Pick a message to read it.</p>
          ) : !detail ? (
            <p className="lead">Loading message…</p>
          ) : (
            <>
              <p className="eyebrow">Message</p>
              <h3 className="reader-subject">{detail.Subject || "(no subject)"}</h3>
              <dl className="reader-meta">
                <div><dt>From</dt><dd>{formatAddress(detail.From)}</dd></div>
                <div><dt>To</dt><dd>{(detail.To ?? []).map(formatAddress).join(", ") || "—"}</dd></div>
                <div><dt>Date</dt><dd>{new Date(detail.Date).toLocaleString()}</dd></div>
              </dl>
              <pre className="mail-body">{detail.Text || "(empty body)"}</pre>
              <p className="meta">
                <a href={`/mailpit/view/${detail.ID}`}>Open this message in Mailpit</a> for headers, HTML, and raw source.
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function formatAddress(address?: { Name?: string; Address?: string }): string {
  if (!address?.Address) return "—";
  return address.Name ? `${address.Name} <${address.Address}>` : address.Address;
}

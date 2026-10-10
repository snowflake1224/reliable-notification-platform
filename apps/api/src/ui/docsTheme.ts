import { PREFER_DARK_MAILPIT, SITE_CSS_URL, siteHeader } from "./siteHeader.js";

const pageHead = `<div class="page-head"><div><p class="kicker">OpenAPI 3.1</p><h1>API docs</h1><p>Every endpoint, schema, and auth method. Use <code>Authorize</code> with the demo API key to try requests from this page. Raw spec: <a href="/docs/openapi.json">/docs/openapi.json</a>.</p></div></div>`;

export const docsCustomCssUrl = SITE_CSS_URL;

export const docsCustomJsStr = `${PREFER_DARK_MAILPIT}
document.documentElement.classList.add("dark-mode");
document.body.classList.add("site");
document.body.insertAdjacentHTML("afterbegin", ${JSON.stringify(siteHeader("docs") + pageHead)});`;

export const docsCustomCss = `
html.dark-mode, html.dark-mode body { background: var(--bg); }
.swagger-ui .topbar { display: none; }
.page-head code { color: var(--amber); font-family: var(--mono); }
.page-head a { color: var(--accent); }
#swagger-ui { max-width: 1280px; margin: 0 auto; padding: 0 22px 60px; }
.swagger-ui .wrapper { max-width: none; padding: 0; }
.swagger-ui, .swagger-ui .info .title, .swagger-ui .opblock-tag, .swagger-ui .opblock .opblock-summary-description { font-family: var(--font); }
.swagger-ui .information-container .info { margin: 18px 0; }
html.dark-mode .swagger-ui .info .title, html.dark-mode .swagger-ui .opblock-tag { color: var(--text); }
html.dark-mode .swagger-ui .info p, html.dark-mode .swagger-ui .info li { color: var(--muted); }
html.dark-mode .swagger-ui a, html.dark-mode .swagger-ui .info a { color: var(--accent); }
html.dark-mode .swagger-ui .scheme-container {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: none;
  margin: 0 0 18px;
}
html.dark-mode .swagger-ui .opblock-tag { border-bottom-color: var(--line); }
html.dark-mode .swagger-ui .opblock { border-radius: 12px; box-shadow: none; }
html.dark-mode .swagger-ui section.models {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
html.dark-mode .swagger-ui section.models .model-container { background: var(--panel-2); }
html.dark-mode .swagger-ui .btn.authorize { color: var(--accent); border-color: var(--accent); }
html.dark-mode .swagger-ui .btn.authorize svg { fill: var(--accent); }
html.dark-mode .swagger-ui .dialog-ux .modal-ux { background: var(--panel); border-color: var(--line); }
`;

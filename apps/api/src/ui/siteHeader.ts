export type SitePage = "home" | "console" | "inbox" | "docs";

export const SITE_CSS_URL = "/console/site.css";

const links: Array<{ page: SitePage; href: string; label: string }> = [
  { page: "home", href: "/", label: "Home" },
  { page: "console", href: "/console/", label: "Console" },
  { page: "inbox", href: "/console/inbox/", label: "Inbox" },
  { page: "docs", href: "/docs/", label: "API docs" }
];

// Keep in sync with apps/web/src/SiteHeader.tsx and the Mailpit header in infra/docker/nginx*.conf.
export function siteHeader(active: SitePage): string {
  const nav = links
    .map((link) => `<a href="${link.href}"${link.page === active ? ' aria-current="page"' : ""}>${link.label}</a>`)
    .join("");
  return `<header class="site-header"><div class="site-header__inner"><a class="site-brand" href="/"><span class="site-brand__mark"></span><span class="site-brand__text">Reliable Notification Platform</span></a><nav class="site-nav" aria-label="Project pages">${nav}</nav></div></header>`;
}

export const PREFER_DARK_MAILPIT = `try{if(!localStorage.getItem("theme"))localStorage.setItem("theme","dark")}catch(e){}`;

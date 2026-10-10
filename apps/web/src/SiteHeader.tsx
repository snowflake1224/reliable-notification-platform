export type SitePage = "home" | "console" | "inbox" | "docs";

const links: Array<{ page: SitePage; href: string; label: string }> = [
  { page: "home", href: "/", label: "Home" },
  { page: "console", href: "/console/", label: "Console" },
  { page: "inbox", href: "/console/inbox/", label: "Inbox" },
  { page: "docs", href: "/docs/", label: "API docs" }
];

// Keep in sync with apps/api/src/ui/siteHeader.ts and the Mailpit header in infra/docker/nginx*.conf.
export function SiteHeader({ active }: { active: SitePage }) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="site-brand" href="/">
          <span className="site-brand__mark" />
          <span className="site-brand__text">Reliable Notification Platform</span>
        </a>
        <nav className="site-nav" aria-label="Project pages">
          {links.map((link) => (
            <a key={link.page} href={link.href} aria-current={link.page === active ? "page" : undefined}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

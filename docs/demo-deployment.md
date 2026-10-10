# EC2 demo deployment

This runbook preserves the local architecture. The production Compose overlay changes exposure and safeguards; it does not replace services or introduce cloud-only dependencies.

## Boundary

- A shared host reverse proxy terminates TLS and joins the external Docker network `portfolio-edge`.
- `nplat-edge` is reachable by that proxy on the Docker network and publishes no host port.
- Postgres, Redis, Mailpit SMTP, Prometheus, and Grafana publish no host ports.
- The public site contains synthetic demo data only.
- `/metrics` returns 404 at the production Nginx edge. Prometheus scrapes private service ports.

## EC2 prerequisites

1. Docker Engine with the Compose v2 plugin.
2. A security group allowing SSH from an administrator IP and HTTPS from the internet. Do not open 5432, 6379, 8025, 9090, or 3000.
3. DNS for `YOUR_EC2_DOMAIN` pointing to the host or its load balancer.
4. A TLS-capable shared reverse proxy attached to `portfolio-edge`.

## Configure

```bash
git clone YOUR_REPOSITORY_URL reliable-notification-platform
cd reliable-notification-platform
cp env.production.example .env
openssl rand -hex 32
```

Generate a different value for every entry in `.env`. Startup rejects known placeholders, development defaults, and short service secrets.

```dotenv
JWT_SECRET=<unique 64-character value>
API_KEY_PEPPER=<different 64-character value>
WEBHOOK_SECRET=<different 64-character value>
ADMIN_PASSWORD=<unique password of at least 16 characters>
```

Create the shared network once:

```bash
docker network inspect portfolio-edge >/dev/null 2>&1 || docker network create portfolio-edge
```

Configure the host proxy to send `YOUR_EC2_DOMAIN` to `http://nplat-edge:80` on `portfolio-edge`. Keep certificate configuration in that shared proxy; this repository's Nginx remains the application edge and load-balances its two API instances.

## Deploy

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  config --quiet

docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d --build
```

The default deployment runs one worker. Add the optional workers with `--profile full`; add private Prometheus/Grafana with `--profile observe`.

## Smoke check

Replace the host token:

```bash
curl -fsS https://YOUR_EC2_DOMAIN/ >/dev/null
curl -fsS https://YOUR_EC2_DOMAIN/health/ready
curl -fsS https://YOUR_EC2_DOMAIN/docs/openapi.json >/dev/null
curl -fsS https://YOUR_EC2_DOMAIN/console/ >/dev/null
curl -fsS https://YOUR_EC2_DOMAIN/mailpit/ >/dev/null
```

Then use **Deliver now** in the Console. The trace should move through `submitted` and then `delivered` after the signed webhook, and the rendered email should appear in the test inbox.

## Demo safeguards

- `DEMO_MODE=true` exposes only read-only queue/outbox counts to the browser.
- Admin credentials are not compiled into the web application.
- Payload-controlled provider failures are disabled in the production overlay.
- API, simulator, and Mailpit routes have edge rate limits.
- Public API limits and maximum outbox backlog are lower than local defaults.
- Real recipients and customer data are prohibited.

The outage/replay controls remain available so reviewers can see retries and webhook deduplication. They affect this shared demo, so reset it periodically.

## Reset synthetic data

This deletes the Postgres volume and all demo history:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Schedule this during a quiet period if the public demo receives regular traffic. Redis is not persisted by this Compose file and restarts empty.

## Upgrade and rollback

Before upgrading, retain the previous Git commit or image tags:

```bash
git pull --ff-only
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

For rollback, check out the previous commit and run the same `up -d --build` command. Database migrations are forward-only; inspect new migrations before deploying a change that cannot run against the previous application version.

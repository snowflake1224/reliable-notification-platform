# Accept, store, work, retry

## Accept and store

`POST /v1/notifications` does one Postgres transaction:

1. insert the notification (`pending`),
2. insert an outbox row (the intent to send),
3. insert the idempotency record (key + the response we returned).

Only after that commits does the API return 202. The request never talks to the email provider. If the process dies right after the 202, the outbox row is still there and will be picked up.

A second request with the same `Idempotency-Key` gets the stored response back instead of a new notification. The same key with a different body gets 409.

## Work

A dispatcher loop in each API process reads pending outbox rows and puts them on a Redis stream. The query claims rows with `FOR UPDATE SKIP LOCKED`, so two dispatchers do not publish the same row twice.

Workers read the stream, take a short Redis lock on the notification, mark it `processing`, and call the provider simulator. The simulator sends the email to Mailpit over SMTP and then posts a delivery status back to `/v1/webhooks/email`, which moves the notification to `delivered`. The worker passes the notification id to the provider as its idempotency key, so a repeated call returns the first result instead of sending again.

If a worker crashes mid-job, the stream message is handed to another worker after a timeout (`VISIBILITY_TIMEOUT_MS`).

## Retry

A failed attempt is written to `delivery_attempts`. A transient failure sets the notification to `retrying` with `next_attempt_at` (exponential backoff with jitter, 500 ms base, 30 s cap). The scheduler process polls for `retrying` rows whose `next_attempt_at` has passed and writes a new outbox row for each, so a retry goes through the same path as the first send.

## Dead letter

A permanent failure (for example a bad address), or running out of attempts (`MAX_ATTEMPTS`), sets the notification to `dead` and writes the job to the `nplat:jobs:dlq` stream. Nothing retries it after that.

## Delivery guarantee

Delivery is at least once. A message can reach a worker twice (crash, timeout, replayed webhook). The idempotency key, the conditional status updates, and the provider-side idempotency key are what make that look like one email.

## Metrics, dashboard, deploy

The API and workers expose Prometheus counters on `/metrics`:

- `nplat_notifications_accepted_total` (accepted),
- `nplat_deliveries_total{result="delivered"}` (delivered),
- `nplat_deliveries_total{result="retry"}` (retrying),
- `nplat_deliveries_total{result="dead"}` (dead).

Prometheus scrapes them and one local Grafana dashboard plots those four.

There is no Terraform in this repo. The deploy is the same Docker Compose stack on one host: `docker-compose.prod.yml` removes the host ports for Postgres, Redis, Prometheus, Grafana, and Mailpit and puts Nginx behind an existing edge proxy. Secrets (`JWT_SECRET`, `API_KEY_PEPPER`, `WEBHOOK_SECRET`, `ADMIN_PASSWORD`) come from a `.env` file on the host, which must not be committed.

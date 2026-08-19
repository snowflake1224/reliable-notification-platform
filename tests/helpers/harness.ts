import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import {
  createLogger,
  createMetrics,
  createPool,
  createRedis,
  ensureConsumerGroup,
  hashApiKey,
  hashPassword,
  loadConfig,
  runMigrations,
  type AppConfig
} from "../../packages/shared/src/index.js";
import { createApp } from "../../apps/api/src/app.js";
import type { Redis } from "ioredis";
import type { Pool } from "pg";

export const DEMO_KEY = "nplat_live_dev_demo_key_do_not_use_in_prod";
const PEPPER = "test-api-key-pepper-xx";
const JWT = "test-jwt-secret-xx";
const WEBHOOK = "test-webhook-secret-xx";

export interface Harness {
  config: AppConfig;
  pool: Pool;
  redis: Redis;
  app: ReturnType<typeof createApp>;
  providerUrl: string;
  tenantId: string;
  otherTenantId: string;
  userExternalId: string;
  stop: () => Promise<void>;
}

export function isDockerUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /container runtime|dockerode|ENOENT|ECONNREFUSED|connect ENOENT/i.test(message);
}

export async function startHarness(failureMode = "success"): Promise<Harness> {
  let pg;
  let rd;
  try {
    pg = await new PostgreSqlContainer("postgres:16-alpine").start();
    rd = await new RedisContainer("redis:7-alpine").start();
  } catch (err) {
    if (isDockerUnavailable(err)) {
      throw new Error("DOCKER_UNAVAILABLE");
    }
    throw err;
  }
  const databaseUrl = pg.getConnectionUri();
  await runMigrations(databaseUrl);

  const provider = await startFakeProvider(failureMode);

  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    SERVICE_NAME: "test",
    DATABASE_URL: databaseUrl,
    REDIS_URL: rd.getConnectionUrl(),
    JWT_SECRET: JWT,
    API_KEY_PEPPER: PEPPER,
    WEBHOOK_SECRET: WEBHOOK,
    PROVIDER_BASE_URL: provider.url,
    PROVIDER_TIMEOUT_MS: "400",
    ALLOW_TEST_FAILURES: "true",
    API_RATE_LIMIT_PER_SEC: "1000",
    EMAIL_RATE_LIMIT_PER_SEC: "1000",
    SMS_RATE_LIMIT_PER_SEC: "1000",
    PUSH_RATE_LIMIT_PER_SEC: "1000",
    MAX_ATTEMPTS: "3",
    VISIBILITY_TIMEOUT_MS: "2000"
  });

  const pool = createPool(config);
  const redis = createRedis(config);
  await ensureConsumerGroup(redis, config);

  const seeded = await seed(pool, PEPPER);
  const app = createApp({
    config,
    pool,
    redis,
    logger: createLogger("test", "silent"),
    metrics: createMetrics("test")
  });

  return {
    config,
    pool,
    redis,
    app,
    providerUrl: provider.url,
    tenantId: seeded.tenantId,
    otherTenantId: seeded.otherTenantId,
    userExternalId: "user-1",
    stop: async () => {
      provider.close();
      await redis.quit();
      await pool.end();
      await pg.stop();
      await rd.stop();
    }
  };
}

async function seed(pool: Pool, pepper: string) {
  const adminHash = await hashPassword("admin-dev-password");
  await pool.query(
    `INSERT INTO admin_users (email, password_hash) VALUES ($1,$2)`,
    ["admin@nplat.local", adminHash]
  );
  const a = await pool.query(`INSERT INTO tenants (name, slug) VALUES ('A','demo') RETURNING id`);
  const b = await pool.query(`INSERT INTO tenants (name, slug) VALUES ('B','other') RETURNING id`);
  const tenantId = a.rows[0].id as string;
  const otherTenantId = b.rows[0].id as string;
  await pool.query(
    `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash)
     VALUES ($1,'demo',$2,$3)`,
    [tenantId, DEMO_KEY.slice(0, 16), hashApiKey(DEMO_KEY, pepper)]
  );
  const type = await pool.query(
    `INSERT INTO notification_types (tenant_id, key, name, category)
     VALUES ($1,'order.shipped','Order shipped','transactional') RETURNING id`,
    [tenantId]
  );
  const marketing = await pool.query(
    `INSERT INTO notification_types (tenant_id, key, name, category)
     VALUES ($1,'promo.weekly','Promo','marketing') RETURNING id`,
    [tenantId]
  );
  for (const channel of ["email", "sms", "push"]) {
    for (const typeId of [type.rows[0].id, marketing.rows[0].id]) {
      const tpl = await pool.query(
        `INSERT INTO templates (tenant_id, notification_type_id, channel, name)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [tenantId, typeId, channel, `${channel}-${typeId}`]
      );
      await pool.query(
        `INSERT INTO template_versions (tenant_id, template_id, version, subject, body, status)
         VALUES ($1,$2,1,'Hi {{name}}','Order {{orderId}}','published')`,
        [tenantId, tpl.rows[0].id]
      );
    }
  }
  await pool.query(
    `INSERT INTO users (tenant_id, external_id, email, phone, push_token)
     VALUES ($1,'user-1','a@test.local','+1','tok')`,
    [tenantId]
  );
  await pool.query(
    `INSERT INTO users (tenant_id, external_id, email)
     VALUES ($1,'user-b','b@test.local')`,
    [otherTenantId]
  );
  return { tenantId, otherTenantId };
}

function startFakeProvider(mode: string) {
  const seen = new Map<string, string>();
  const server = createServer((req, res) => {
    if (req.url !== "/send" || req.method !== "POST") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as {
        failureMode?: string;
        notificationId?: string;
      };
      const idem = String(req.headers["x-idempotency-key"] ?? "");
      if (idem && seen.has(idem)) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ providerMessageId: seen.get(idem) }));
        return;
      }
      const effective = body.failureMode ?? mode;
      if (effective === "timeout") {
        return;
      }
      if (effective === "transient") {
        res.statusCode = 503;
        res.end(JSON.stringify({ code: "unavailable" }));
        return;
      }
      if (effective === "permanent") {
        res.statusCode = 400;
        res.end(JSON.stringify({ code: "invalid_recipient" }));
        return;
      }
      if (effective === "rate_limit") {
        res.statusCode = 429;
        res.end(JSON.stringify({ retryAfterMs: 50 }));
        return;
      }
      const id = `prov_${body.notificationId ?? "x"}`;
      if (idem) seen.set(idem, id);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ providerMessageId: id }));
    });
  });
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

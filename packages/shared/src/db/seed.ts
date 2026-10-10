import pg from "pg";
import { generateApiKey, hashApiKey, hashPassword } from "../crypto.js";

const DEMO_KEY = "nplat_live_dev_demo_key_do_not_use_in_prod";

async function openClient(databaseUrl: string): Promise<pg.Client> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 10; attempt++) {
    const client = new pg.Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastError = err;
      client.on("error", () => undefined);
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}

export async function seed(databaseUrl: string, pepper: string): Promise<void> {
  const client = await openClient(databaseUrl);
  client.on("error", () => undefined);
  try {
    const adminPassword = process.env.ADMIN_PASSWORD ?? "admin-dev-password";
    if (
      process.env.REQUIRE_SECURE_SECRETS === "true" &&
      (adminPassword.length < 16 || /replace-me|change-me|admin-dev|generate-|your-/i.test(adminPassword))
    ) {
      throw new Error("ADMIN_PASSWORD must be a unique production value of at least 16 characters");
    }
    const adminHash = await hashPassword(adminPassword);
    await client.query(
      `INSERT INTO admin_users (email, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING`,
      ["admin@nplat.local", adminHash]
    );

    const tenant = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, slug)
       VALUES ('Demo Tenant', 'demo')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const tenantId = tenant.rows[0].id;

    const keyHash = hashApiKey(DEMO_KEY, pepper);
    const prefix = DEMO_KEY.slice(0, 16);
    await client.query(
      `INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash)
       SELECT $1, 'local-demo', $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM tenant_api_keys WHERE tenant_id = $1 AND key_hash = $3
       )`,
      [tenantId, prefix, keyHash]
    );

    const type = await client.query<{ id: string }>(
      `INSERT INTO notification_types (tenant_id, key, name, category)
       VALUES ($1, 'order.shipped', 'Order shipped', 'transactional')
       ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [tenantId]
    );
    const typeId = type.rows[0].id;

    const marketing = await client.query<{ id: string }>(
      `INSERT INTO notification_types (tenant_id, key, name, category)
       VALUES ($1, 'promo.weekly', 'Weekly promo', 'marketing')
       ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [tenantId]
    );

    for (const channel of ["email", "sms", "push"] as const) {
      const tpl = await client.query<{ id: string }>(
        `INSERT INTO templates (tenant_id, notification_type_id, channel, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, notification_type_id, channel) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [tenantId, typeId, channel, `order-shipped-${channel}`]
      );
      await client.query(
        `INSERT INTO template_versions (tenant_id, template_id, version, subject, body, status)
         SELECT $1, $2, 1, $3, $4, 'published'
         WHERE NOT EXISTS (SELECT 1 FROM template_versions WHERE template_id = $2 AND version = 1)`,
        [
          tenantId,
          tpl.rows[0].id,
          channel === "email" ? "Your order {{orderId}} shipped" : null,
          channel === "email"
            ? "Hi {{name}}, order {{orderId}} is on the way."
            : channel === "sms"
              ? "Order {{orderId}} shipped"
              : "Order {{orderId}} is on the way"
        ]
      );

      const mTpl = await client.query<{ id: string }>(
        `INSERT INTO templates (tenant_id, notification_type_id, channel, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, notification_type_id, channel) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [tenantId, marketing.rows[0].id, channel, `promo-${channel}`]
      );
      await client.query(
        `INSERT INTO template_versions (tenant_id, template_id, version, subject, body, status)
         SELECT $1, $2, 1, $3, $4, 'published'
         WHERE NOT EXISTS (SELECT 1 FROM template_versions WHERE template_id = $2 AND version = 1)`,
        [tenantId, mTpl.rows[0].id, "This week only", "Hi {{name}}, 20% off this week."]
      );
    }

    await client.query(
      `INSERT INTO users (tenant_id, external_id, email, phone, push_token)
       VALUES ($1, 'user-1', 'buyer@example.test', '+15550001111', 'push-token-demo')
       ON CONFLICT (tenant_id, external_id) DO UPDATE
         SET email = EXCLUDED.email, phone = EXCLUDED.phone, push_token = EXCLUDED.push_token`,
      [tenantId]
    );

    console.log("seed complete");
    if (process.env.REQUIRE_SECURE_SECRETS !== "true") {
      console.log("local admin: admin@nplat.local / admin-dev-password");
    }
    console.log(`demo tenant API key: ${DEMO_KEY}`);
    void generateApiKey;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (process.argv[1]?.includes("seed")) {
  const url = process.env.DATABASE_URL;
  const pepper = process.env.API_KEY_PEPPER;
  if (!url || !pepper) {
    console.error("DATABASE_URL and API_KEY_PEPPER are required");
    process.exit(1);
  }
  seed(url, pepper).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

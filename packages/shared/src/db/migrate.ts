import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = await openClient(databaseUrl);
  client.on("error", () => undefined);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const dir = path.resolve(__dirname, "../../migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
        version
      ]);
      if (existing.rowCount) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        console.log(`applied migration ${version}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

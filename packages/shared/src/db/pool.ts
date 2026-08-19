import pg from "pg";
import type { AppConfig } from "../config.js";
import type { Metrics } from "../metrics.js";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(config: AppConfig, metrics?: Metrics): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    statement_timeout: config.databaseStatementTimeoutMs
  });

  const origQuery = pool.query.bind(pool);
  pool.query = ((text: string, params?: unknown[]) => {
    const end = metrics?.postgresLatency.startTimer({ op: opName(text) });
    const result = origQuery(text, params as never);
    if (result && typeof (result as Promise<unknown>).finally === "function") {
      return (result as Promise<unknown>).finally(() => end?.());
    }
    end?.();
    return result;
  }) as typeof pool.query;

  return pool;
}

function opName(text: string): string {
  const first = text.trim().split(/\s+/)[0]?.toUpperCase() ?? "SQL";
  return first.slice(0, 16);
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // original error is more useful
    }
    throw err;
  } finally {
    client.release();
  }
}

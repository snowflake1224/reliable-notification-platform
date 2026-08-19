import type { Redis } from "ioredis";
import type { Pool } from "pg";
import { pingRedis } from "./redis/client.js";

export async function checkReadiness(pool: Pool, redis: Redis): Promise<{
  ready: boolean;
  postgres: "ok" | "error";
  redis: "ok" | "error";
}> {
  let postgres: "ok" | "error" = "ok";
  let redisStatus: "ok" | "error" = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    postgres = "error";
  }
  try {
    await pingRedis(redis);
  } catch {
    redisStatus = "error";
  }
  return { ready: postgres === "ok" && redisStatus === "ok", postgres, redis: redisStatus };
}

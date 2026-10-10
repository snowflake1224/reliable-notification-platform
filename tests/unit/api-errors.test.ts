import type { Redis } from "ioredis";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createLogger, createMetrics, loadConfig } from "../../packages/shared/src/index.js";
import { createApp } from "../../apps/api/src/app.js";

function testApp() {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    REDIS_URL: "redis://127.0.0.1:1",
    JWT_SECRET: "test-jwt-secret-long-enough",
    API_KEY_PEPPER: "test-api-key-pepper-long-enough",
    WEBHOOK_SECRET: "test-webhook-secret-long-enough",
    PROVIDER_BASE_URL: "http://127.0.0.1:1"
  });
  return createApp({
    config,
    pool: {} as Pool,
    redis: {} as Redis,
    logger: createLogger("test", "silent"),
    metrics: createMetrics("api-errors")
  });
}

describe("API body errors", () => {
  it("returns structured 400 JSON for malformed JSON", async () => {
    const response = await request(testApp())
      .post("/v1/notifications")
      .set("content-type", "application/json")
      .send("{")
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: "invalid_json",
      message: "Request body is not valid JSON"
    });
    expect(response.body.error.requestId).toMatch(/^req_/);
    expect(response.headers["x-request-id"]).toBe(response.body.error.requestId);
  });

  it("returns structured 413 JSON when the body exceeds 64kb", async () => {
    const response = await request(testApp())
      .post("/v1/notifications")
      .set("content-type", "application/json")
      .send(JSON.stringify({ payload: "x".repeat(70 * 1024) }))
      .expect(413);

    expect(response.body.error).toMatchObject({
      code: "payload_too_large",
      message: "Request body exceeds 64kb"
    });
    expect(response.body.error.requestId).toMatch(/^req_/);
  });
});

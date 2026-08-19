import { describe, expect, it } from "vitest";
import { classifyHttpStatus, computeBackoffMs } from "../../packages/shared/src/retry.js";

describe("retry backoff", () => {
  it("stays within the exponential cap and applies jitter", () => {
    const samples = Array.from({ length: 40 }, () =>
      computeBackoffMs({ baseMs: 100, maxMs: 800, attempt: 4, jitterRatio: 1 })
    );
    expect(Math.max(...samples)).toBeLessThanOrEqual(800);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(new Set(samples).size).toBeGreaterThan(5);
  });

  it("grows the cap with attempt number", () => {
    const a1 = computeBackoffMs({ baseMs: 100, maxMs: 10_000, attempt: 1, jitterRatio: 0 });
    const a3 = computeBackoffMs({ baseMs: 100, maxMs: 10_000, attempt: 3, jitterRatio: 0 });
    expect(a1).toBe(100);
    expect(a3).toBe(400);
  });

  it("classifies HTTP statuses for retry", () => {
    expect(classifyHttpStatus(200)).toBe("success");
    expect(classifyHttpStatus(429)).toBe("transient");
    expect(classifyHttpStatus(503)).toBe("transient");
    expect(classifyHttpStatus(400)).toBe("permanent");
  });
});

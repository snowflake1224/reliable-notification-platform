import { describe, expect, it } from "vitest";
import { canTransition, isClaimable, isTerminal } from "../../packages/shared/src/stateMachine.js";

describe("notification state machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("pending", "queued")).toBe(true);
    expect(canTransition("queued", "processing")).toBe(true);
    expect(canTransition("processing", "delivered")).toBe(true);
  });

  it("allows retry and death", () => {
    expect(canTransition("processing", "retrying")).toBe(true);
    expect(canTransition("retrying", "queued")).toBe(true);
    expect(canTransition("processing", "dead")).toBe(true);
  });

  it("rejects backward and sideways moves from terminal states", () => {
    expect(canTransition("delivered", "processing")).toBe(false);
    expect(canTransition("dead", "queued")).toBe(false);
    expect(canTransition("cancelled", "pending")).toBe(false);
    expect(isTerminal("delivered")).toBe(true);
    expect(isClaimable("delivered")).toBe(false);
    expect(isClaimable("queued")).toBe(true);
  });
});

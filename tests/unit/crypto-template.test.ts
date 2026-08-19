import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhookSignature } from "../../packages/shared/src/crypto.js";
import { renderTemplate } from "../../packages/shared/src/template.js";

describe("webhook signatures and templates", () => {
  it("accepts a valid HMAC and rejects a tampered body", () => {
    const secret = "s3cret";
    const ts = "1710000000";
    const body = JSON.stringify({ eventId: "e1" });
    const sig = signWebhook(secret, ts, body);
    expect(verifyWebhookSignature(secret, ts, body, sig)).toBe(true);
    expect(verifyWebhookSignature(secret, ts, body, "sha256=" + sig)).toBe(true);
    expect(verifyWebhookSignature(secret, ts, '{"eventId":"e2"}', sig)).toBe(false);
  });

  it("renders {{placeholders}}", () => {
    expect(renderTemplate("Hi {{name}}, order {{orderId}}", { name: "Ada", orderId: 9 })).toBe(
      "Hi Ada, order 9"
    );
  });
});

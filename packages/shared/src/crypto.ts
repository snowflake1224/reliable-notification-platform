import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

export function generateApiKey(): { raw: string; prefix: string } {
  const raw = `nplat_live_${randomBytes(24).toString("base64url")}`;
  return { raw, prefix: raw.slice(0, 16) };
}

export function hashApiKey(raw: string, pepper: string): string {
  return createHash("sha256").update(pepper).update(raw).digest("hex");
}

export function apiKeyPrefix(raw: string): string {
  return raw.slice(0, 16);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const derived = (await scrypt(password, Buffer.from(saltHex, "hex"), 64)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const expected = Buffer.from(signWebhook(secret, timestamp, body), "hex");
  const got = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

export function randomId(prefix = ""): string {
  return `${prefix}${randomBytes(12).toString("hex")}`;
}

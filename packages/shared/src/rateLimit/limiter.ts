import type { Redis } from "ioredis";

/**
 * Token-bucket limiter. Atomic via Lua so concurrent API/worker instances
 * share one distributed budget.
 */
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local data = redis.call("HMGET", key, "tokens", "ts")
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * refill_per_ms)
ts = now

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call("HMSET", key, "tokens", tokens, "ts", ts)
redis.call("PEXPIRE", key, 2000)
return {allowed, tokens}
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function consumeToken(
  redis: Redis,
  key: string,
  perSecond: number,
  now = Date.now()
): Promise<RateLimitResult> {
  const refillPerMs = perSecond / 1000;
  const result = (await redis.eval(
    TOKEN_BUCKET_LUA,
    1,
    key,
    String(perSecond),
    String(refillPerMs),
    String(now),
    "1"
  )) as [number, number];
  return { allowed: Number(result[0]) === 1, remaining: Number(result[1]) };
}

export function apiLimitKey(tenantId: string): string {
  return `nplat:rl:api:${tenantId}`;
}

export function providerLimitKey(channel: string): string {
  return `nplat:rl:provider:${channel}`;
}

import type { Redis } from "ioredis";

const UNLOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

const EXTEND_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

export class DistributedLock {
  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    private readonly token: string,
    private readonly ttlMs: number
  ) {}

  async release(): Promise<boolean> {
    const result = await this.redis.eval(UNLOCK_LUA, 1, this.key, this.token);
    return Number(result) === 1;
  }

  async extend(): Promise<boolean> {
    const result = await this.redis.eval(EXTEND_LUA, 1, this.key, this.token, String(this.ttlMs));
    return Number(result) === 1;
  }
}

export async function acquireLock(
  redis: Redis,
  name: string,
  token: string,
  ttlMs: number
): Promise<DistributedLock | null> {
  const key = `nplat:lock:${name}`;
  const ok = await redis.set(key, token, "PX", ttlMs, "NX");
  if (ok !== "OK") return null;
  return new DistributedLock(redis, key, token, ttlMs);
}

export function notificationLockName(notificationId: string): string {
  return `notif:${notificationId}`;
}

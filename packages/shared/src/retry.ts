export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  attempt: number;
  jitterRatio?: number;
}

/**
 * Exponential backoff with full jitter.
 * attempt is 1-based (first retry after failure 1).
 * Full jitter: random(0, min(max, base * 2^(attempt-1)))
 * Prevents synchronized retry storms across workers.
 */
export function computeBackoffMs(opts: BackoffOptions): number {
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** Math.max(0, opts.attempt - 1));
  const jitterRatio = opts.jitterRatio ?? 1;
  const jitter = exp * jitterRatio * Math.random();
  return Math.floor(jitterRatio >= 1 ? jitter : exp - jitter / 2);
}

export function nextAttemptAt(opts: BackoffOptions, now = new Date()): Date {
  return new Date(now.getTime() + computeBackoffMs(opts));
}

export function classifyHttpStatus(status: number): "transient" | "permanent" | "success" {
  if (status >= 200 && status < 300) return "success";
  if (status === 408 || status === 429 || status >= 500) return "transient";
  return "permanent";
}

/**
 * In-memory sliding-window rate limiter. Suitable for single-instance use and as a backstop
 * to Supabase Auth's built-in protection. For production at scale, swap for Upstash Redis.
 */
const buckets = new Map<string, number[]>();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const window = buckets.get(key) ?? [];
  const trimmed = window.filter((t) => now - t < opts.windowMs);
  if (trimmed.length >= opts.max) {
    const oldest = trimmed[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, opts.windowMs - (now - oldest)),
    };
  }
  trimmed.push(now);
  buckets.set(key, trimmed);
  return { allowed: true, remaining: opts.max - trimmed.length, retryAfterMs: 0 };
}

export function _resetRateLimit(key?: string): void {
  if (key) buckets.delete(key);
  else buckets.clear();
}

import { logger } from "@/lib/logger";

export interface RetryOptions {
  maxAttempts?: number;
  /** Base delay in ms. Backoff = min(base * 2^attempt + jitter, maxDelayMs). */
  baseMs?: number;
  maxDelayMs?: number;
  /** Predicate to decide whether an error is retryable. Default: retry on network/5xx. */
  retryable?: (err: unknown) => boolean;
  /** Label for logging. */
  label?: string;
}

const defaults: Required<Omit<RetryOptions, "retryable" | "label">> &
  Pick<RetryOptions, "retryable" | "label"> = {
  maxAttempts: 3,
  baseMs: 500,
  maxDelayMs: 10_000,
  retryable: defaultRetryable,
  label: "op",
};

function defaultRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (typeof status === "number") {
    // Retry on 408, 429, and 5xx. Never on 4xx (auth/validation).
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
  }
  const code = (err as { code?: string }).code;
  if (code && ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(code)) {
    return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const o = { ...defaults, ...opts };
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < o.maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRetryable = o.retryable!(err);
      const isLast = attempt === o.maxAttempts - 1;
      if (!isRetryable || isLast) {
        throw err;
      }
      const jitter = Math.random() * 200;
      const delay = Math.min(o.baseMs * 2 ** attempt + jitter, o.maxDelayMs);
      logger.warn(
        { label: o.label, attempt: attempt + 1, delayMs: Math.round(delay), err: String(err) },
        "Retrying",
      );
      await sleep(delay);
      attempt += 1;
    }
  }
  throw lastErr;
}

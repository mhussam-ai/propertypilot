import { logger } from "@/lib/logger";

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface BreakerOptions {
  /** Consecutive failures before opening the breaker. */
  failureThreshold?: number;
  /** Milliseconds to stay OPEN before transitioning to HALF_OPEN. */
  openMs?: number;
  /** Successful calls in HALF_OPEN required to close the breaker. */
  halfOpenSuccessThreshold?: number;
}

interface BreakerStats {
  state: BreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  openedAt: number | null;
}

const registry = new Map<string, BreakerStats>();
const defaultOpts: Required<BreakerOptions> = {
  failureThreshold: 5,
  openMs: 60_000,
  halfOpenSuccessThreshold: 2,
};

function getStats(name: string): BreakerStats {
  let s = registry.get(name);
  if (!s) {
    s = { state: "CLOSED", consecutiveFailures: 0, consecutiveSuccesses: 0, openedAt: null };
    registry.set(name, s);
  }
  return s;
}

export class CircuitOpenError extends Error {
  constructor(public readonly breakerName: string) {
    super(`Circuit breaker ${breakerName} is OPEN`);
    this.name = "CircuitOpenError";
  }
}

export function getBreakerState(name: string): BreakerState {
  return getStats(name).state;
}

export function resetBreaker(name: string): void {
  registry.delete(name);
}

export async function withBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  opts: BreakerOptions = {},
): Promise<T> {
  const o = { ...defaultOpts, ...opts };
  const stats = getStats(name);

  if (stats.state === "OPEN") {
    const elapsed = stats.openedAt ? Date.now() - stats.openedAt : Infinity;
    if (elapsed < o.openMs) {
      throw new CircuitOpenError(name);
    }
    stats.state = "HALF_OPEN";
    stats.consecutiveSuccesses = 0;
    logger.info({ breaker: name }, "Circuit breaker → HALF_OPEN");
  }

  try {
    const result = await fn();
    if (stats.state === "HALF_OPEN") {
      stats.consecutiveSuccesses += 1;
      if (stats.consecutiveSuccesses >= o.halfOpenSuccessThreshold) {
        stats.state = "CLOSED";
        stats.consecutiveFailures = 0;
        stats.openedAt = null;
        logger.info({ breaker: name }, "Circuit breaker → CLOSED");
      }
    } else {
      stats.consecutiveFailures = 0;
    }
    return result;
  } catch (err) {
    stats.consecutiveFailures += 1;
    stats.consecutiveSuccesses = 0;
    if (
      stats.state === "HALF_OPEN" ||
      stats.consecutiveFailures >= o.failureThreshold
    ) {
      stats.state = "OPEN";
      stats.openedAt = Date.now();
      logger.warn(
        { breaker: name, failures: stats.consecutiveFailures },
        "Circuit breaker → OPEN",
      );
    }
    throw err;
  }
}

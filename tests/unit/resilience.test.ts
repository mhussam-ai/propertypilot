import { describe, it, expect, beforeEach } from "vitest";
import { withBreaker, getBreakerState, resetBreaker, CircuitOpenError } from "@/lib/resilience/circuit-breaker";
import { withRetry } from "@/lib/resilience/retry";

describe("circuit breaker", () => {
  beforeEach(() => resetBreaker("test"));

  it("starts CLOSED", () => {
    expect(getBreakerState("test")).toBe("CLOSED");
  });

  it("opens after consecutive failures hit the threshold", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        withBreaker("test", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    }
    expect(getBreakerState("test")).toBe("OPEN");
  });

  it("short-circuits while OPEN", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        withBreaker("test", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow();
    }
    await expect(withBreaker("test", async () => "ok")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("transitions to HALF_OPEN after openMs and closes on successes", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        withBreaker("test", async () => {
          throw new Error("boom");
        }, { failureThreshold: 5, openMs: 1, halfOpenSuccessThreshold: 2 }),
      ).rejects.toThrow();
    }
    expect(getBreakerState("test")).toBe("OPEN");
    await new Promise((r) => setTimeout(r, 5));
    // 1 success → HALF_OPEN
    await withBreaker("test", async () => "ok", { failureThreshold: 5, openMs: 1, halfOpenSuccessThreshold: 2 });
    expect(getBreakerState("test")).toBe("HALF_OPEN");
    // 2nd success → CLOSED
    await withBreaker("test", async () => "ok", { failureThreshold: 5, openMs: 1, halfOpenSuccessThreshold: 2 });
    expect(getBreakerState("test")).toBe("CLOSED");
  });
});

describe("withRetry", () => {
  it("retries 5xx errors and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          const err = new Error("server") as Error & { status?: number };
          err.status = 503;
          throw err;
        }
        return "ok";
      },
      { baseMs: 1 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("does NOT retry on 401", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          const err = new Error("unauth") as Error & { status?: number };
          err.status = 401;
          throw err;
        },
        { baseMs: 1 },
      ),
    ).rejects.toThrow("unauth");
    expect(attempts).toBe(1);
  });

  it("retries 429 (rate limit)", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) {
          const err = new Error("ratelimit") as Error & { status?: number };
          err.status = 429;
          throw err;
        }
        return "ok";
      },
      { baseMs: 1 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("gives up after maxAttempts", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          const err = new Error("boom") as Error & { status?: number };
          err.status = 500;
          throw err;
        },
        { baseMs: 1, maxAttempts: 3 },
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(3);
  });
});

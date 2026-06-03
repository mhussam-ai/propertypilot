import { describe, it, expect, beforeEach } from "vitest";
import { BolnaApiError, BolnaClient } from "@/lib/bolna/client";
import { resetBreaker } from "@/lib/resilience/circuit-breaker";

/**
 * The timeout/abort path is enforced inside BolnaClient.request via an AbortController.
 * withRetry retries on 408 — so a stalled upstream produces:
 *   timeout → 408 → retry (up to maxAttempts) → 408 finally surfaces to the caller.
 * The breaker uses the label, so we reset between tests to avoid OPEN state leaking.
 */

const dummyAgent = { agent_config: { agent_name: "x", webhook_url: "http://x", tasks: [] } } as never;

function neverResolveFetch(): typeof fetch {
  return ((_url: string, opts: { signal?: AbortSignal } = {}): Promise<Response> => {
    return new Promise((_resolve, reject) => {
      if (opts.signal?.aborted) {
        const e = new Error("aborted");
        (e as Error & { name: string }).name = "AbortError";
        reject(e);
        return;
      }
      opts.signal?.addEventListener("abort", () => {
        const e = new Error("aborted");
        (e as Error & { name: string }).name = "AbortError";
        reject(e);
      });
    });
  }) as unknown as typeof fetch;
}

describe("BolnaClient timeout", () => {
  beforeEach(() => {
    resetBreaker("test.createAgent");
    resetBreaker("test.bulkCreateDispositions");
  });

  it("rejects with BolnaApiError(408) when an explicit per-call timeout elapses", async () => {
    // createAgent has a 15s per-method default, so the test must pass timeoutMs explicitly.
    const client = new BolnaClient({
      apiKey: "test",
      breakerPrefix: "test",
      fetchImpl: neverResolveFetch(),
    });

    const start = Date.now();
    await expect(
      client.createAgent(dummyAgent, { timeoutMs: 40 }),
    ).rejects.toMatchObject({
      name: "BolnaApiError",
      status: 408,
    });
    const elapsed = Date.now() - start;
    // withRetry retries (3 attempts default) with exponential backoff baseMs=500.
    // ~40ms attempt + ~500-700ms + ~40ms + ~1000-1200ms + ~40ms ≈ 1.7-2.1s on a healthy box.
    // Cap at 6s to leave ample headroom on slow CI runners.
    expect(elapsed).toBeLessThan(6_000);
  }, 10_000);

  it("rejects without retry when an external AbortSignal aborts mid-flight", async () => {
    const client = new BolnaClient({
      apiKey: "test",
      breakerPrefix: "test",
      defaultTimeoutMs: 10_000,
      fetchImpl: neverResolveFetch(),
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("caller-cancelled")), 30);

    await expect(
      client.createAgent(dummyAgent, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("per-call timeoutMs overrides the client default", async () => {
    const client = new BolnaClient({
      apiKey: "test",
      breakerPrefix: "test",
      defaultTimeoutMs: 10_000,
      fetchImpl: neverResolveFetch(),
    });

    const start = Date.now();
    await expect(
      client.bulkCreateDispositions(
        { agent_id: "a", dispositions: [] },
        { timeoutMs: 40 },
      ),
    ).rejects.toBeInstanceOf(BolnaApiError);
    expect(Date.now() - start).toBeLessThan(6_000);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import {
  authenticateWebhook,
  extractClientIp,
  idempotencyKey,
} from "@/lib/bolna/auth-webhook";

describe("authenticateWebhook", () => {
  const goodToken = "tok_correct_horse_battery_staple";

  beforeEach(() => {
    process.env.BOLNA_WEBHOOK_SOURCE_IPS = "13.203.39.153";
  });

  it("accepts a request from the Bolna IP with the correct token", () => {
    const result = authenticateWebhook({
      ip: "13.203.39.153",
      pathToken: goodToken,
      expectedToken: goodToken,
      allowDevBypass: false,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown IP in production mode", () => {
    const result = authenticateWebhook({
      ip: "203.0.113.42",
      pathToken: goodToken,
      expectedToken: goodToken,
      allowDevBypass: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ip_not_allowed");
  });

  it("rejects a token mismatch even from the right IP", () => {
    const result = authenticateWebhook({
      ip: "13.203.39.153",
      pathToken: "tok_wrong",
      expectedToken: goodToken,
      allowDevBypass: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token_mismatch");
  });

  it("rejects when the path token is empty", () => {
    const result = authenticateWebhook({
      ip: "13.203.39.153",
      pathToken: "",
      expectedToken: goodToken,
      allowDevBypass: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_token");
  });

  it("rejects when the expected token is missing (no secret stored yet)", () => {
    const result = authenticateWebhook({
      ip: "13.203.39.153",
      pathToken: goodToken,
      expectedToken: "",
      allowDevBypass: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_expected");
  });

  it("allows localhost when dev bypass is on", () => {
    const result = authenticateWebhook({
      ip: "127.0.0.1",
      pathToken: goodToken,
      expectedToken: goodToken,
      allowDevBypass: true,
    });
    expect(result.ok).toBe(true);
  });

  it("does NOT allow localhost when dev bypass is off (prod)", () => {
    const result = authenticateWebhook({
      ip: "127.0.0.1",
      pathToken: goodToken,
      expectedToken: goodToken,
      allowDevBypass: false,
    });
    expect(result.ok).toBe(false);
  });

  it("compares tokens in constant time (signal: equal-length mismatch still rejected)", () => {
    // Sanity: a token-length match but mismatched chars still returns token_mismatch,
    // not some earlier short-circuit.
    const a = "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const b = "tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(a.length).toBe(b.length);
    const result = authenticateWebhook({
      ip: "13.203.39.153",
      pathToken: a,
      expectedToken: b,
      allowDevBypass: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token_mismatch");
  });

  it("respects the env var override for allowed IPs", () => {
    process.env.BOLNA_WEBHOOK_SOURCE_IPS = "10.0.0.1, 10.0.0.2";
    const ok = authenticateWebhook({
      ip: "10.0.0.2",
      pathToken: goodToken,
      expectedToken: goodToken,
      allowDevBypass: false,
    });
    expect(ok.ok).toBe(true);

    const denied = authenticateWebhook({
      ip: "13.203.39.153",
      pathToken: goodToken,
      expectedToken: goodToken,
      allowDevBypass: false,
    });
    expect(denied.ok).toBe(false);
  });
});

describe("extractClientIp", () => {
  it("prefers the leftmost x-forwarded-for hop", () => {
    const h = new Headers({ "x-forwarded-for": "13.203.39.153, 10.0.0.1, 10.0.0.2" });
    expect(extractClientIp(h)).toBe("13.203.39.153");
  });

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "13.203.39.153" });
    expect(extractClientIp(h)).toBe("13.203.39.153");
  });

  it("returns empty string when nothing is present", () => {
    expect(extractClientIp(new Headers())).toBe("");
  });
});

describe("idempotencyKey", () => {
  it("combines execution id, status, retry count", () => {
    const k = idempotencyKey({ id: "exec_1", status: "completed", retry_count: 0 });
    expect(k).toBe("exec_1:completed:0");
  });

  it("differentiates retries from the same execution", () => {
    expect(idempotencyKey({ id: "exec_1", status: "no-answer", retry_count: 0 })).not.toBe(
      idempotencyKey({ id: "exec_1", status: "no-answer", retry_count: 1 }),
    );
  });

  it("differentiates status transitions for the same execution", () => {
    expect(idempotencyKey({ id: "exec_1", status: "queued", retry_count: 0 })).not.toBe(
      idempotencyKey({ id: "exec_1", status: "completed", retry_count: 0 }),
    );
  });

  it("handles missing fields gracefully", () => {
    expect(idempotencyKey({})).toBe("unknown:unknown:0");
  });
});

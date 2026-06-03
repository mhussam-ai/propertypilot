import { constantTimeEqual } from "@/lib/utils";
import { logger } from "@/lib/logger";

/**
 * Bolna does NOT sign webhooks (no HMAC). They send from a fixed source IP and recommend
 * IP whitelisting:
 *   https://www.bolna.ai/docs/polling-call-status-webhooks#ip-whitelist
 *
 * PropertyPilot defends in depth:
 *   1. IP allowlist (BOLNA_WEBHOOK_SOURCE_IPS, default 13.203.39.153).
 *   2. Per-tenant opaque 32-byte token embedded in the webhook URL path. Each tenant's
 *      Bolna agent's `webhook_url` is /api/webhooks/bolna/{tenant_id}/{token}. We compare
 *      the path token against the value stored (decrypted) in tenant_secrets in constant time.
 *
 * In development, 127.0.0.1 and ::1 are allowed automatically so the replay-webhook
 * script and tests can run without changing env vars.
 */

const DEV_BYPASS_IPS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface AuthInput {
  /** Client IP, ideally from x-forwarded-for. */
  ip: string;
  /** Token from the URL path. */
  pathToken: string;
  /** The expected (decrypted) token for the tenant. */
  expectedToken: string;
  /** Allow dev/test bypass for localhost. Default true when NODE_ENV !== 'production'. */
  allowDevBypass?: boolean;
}

export interface AuthResult {
  ok: boolean;
  reason?:
    | "ip_not_allowed"
    | "missing_token"
    | "token_mismatch"
    | "missing_expected";
}

function loadAllowedIps(): string[] {
  const raw = process.env.BOLNA_WEBHOOK_SOURCE_IPS ?? "13.203.39.153";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Extract the leftmost IP from an x-forwarded-for header chain. Vercel sets this. */
export function extractClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "";
}

export function authenticateWebhook(input: AuthInput): AuthResult {
  const allowDevBypass =
    input.allowDevBypass ?? process.env.NODE_ENV !== "production";

  // 1. IP check
  const allowedIps = loadAllowedIps();
  const isIpAllowed =
    allowedIps.includes(input.ip) ||
    (allowDevBypass && DEV_BYPASS_IPS.has(input.ip));
  if (!isIpAllowed) {
    logger.warn(
      { ip: input.ip, allowedIps, allowDevBypass },
      "Webhook rejected: IP not in allowlist",
    );
    return { ok: false, reason: "ip_not_allowed" };
  }

  // 2. Token check
  if (!input.pathToken) return { ok: false, reason: "missing_token" };
  if (!input.expectedToken) return { ok: false, reason: "missing_expected" };
  if (!constantTimeEqual(input.pathToken, input.expectedToken)) {
    logger.warn({ ip: input.ip }, "Webhook rejected: token mismatch");
    return { ok: false, reason: "token_mismatch" };
  }

  return { ok: true };
}

/**
 * Compose the per-tenant idempotency key from a webhook payload.
 *
 * Bolna sends multiple updates per execution as status progresses
 * (scheduled → queued → in-progress → completed). We want at-most-once delivery
 * per logical event, so we key on (execution_id, status, retry_count).
 */
export function idempotencyKey(payload: {
  id?: string;
  status?: string;
  retry_count?: number | null;
}): string {
  const id = payload.id ?? "unknown";
  const status = payload.status ?? "unknown";
  const retry = payload.retry_count ?? 0;
  return `${id}:${status}:${retry}`;
}

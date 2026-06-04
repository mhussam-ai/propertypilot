import { NextResponse } from "next/server";
import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/middleware/rate-limit";
import { extractClientIp } from "@/lib/bolna/auth-webhook";
import type { Database } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

const LeadInput = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(8).max(20),
  source: z.string().max(80).optional(),
  language_hint: z.string().max(8).optional().default("en"),
  custom_vars: z.record(z.string()).optional().default({}),
});

const BodySchema = z.object({
  property_id: z.string().uuid(),
  leads: z.array(LeadInput).min(1).max(500),
});

/**
 * Public ingestion endpoint. Auth via per-tenant Bearer token from tenant_secrets.bolna_api_key
 * is not appropriate here (that's the Bolna API key, not a customer-facing token).
 *
 * For v1 we use the same per-tenant webhook_token as a customer-API token. The token is in the
 * Authorization: Bearer header. Header-based auth is required because public API consumers
 * shouldn't expose tokens via URL.
 */
export async function POST(req: Request) {
  const ip = extractClientIp(req.headers);
  const rl = rateLimit(`v1.leads.${ip || "anon"}`, { windowMs: 60_000, max: 30 });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearer) {
    return NextResponse.json({ ok: false, error: "missing_token" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Locate the tenant by matching webhook_token across all tenants. In a multi-million-tenant
  // deployment this would be a problem; for v1 with N≤100 tenants, scan once per request.
  // TODO V2: index on a sha256(token) column for O(1) lookup.
  const { data: secrets } = await admin
    .from("tenant_secrets")
    .select("tenant_id, webhook_token_ciphertext");
  const match = (secrets ?? []).find((s) => {
    try {
      return decrypt(s.webhook_token_ciphertext as string) === bearer;
    } catch {
      return false;
    }
  });
  if (!match) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 401 });
  }
  const tenantId = match.tenant_id as string;

  // Verify the property belongs to this tenant.
  const { data: property } = await admin
    .from("properties")
    .select("id, tenant_id")
    .eq("id", parsed.data.property_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!property) {
    return NextResponse.json(
      { ok: false, error: "property_not_found" },
      { status: 404 },
    );
  }

  const accepted: string[] = [];
  const rejected: Array<{ phone: string; reason: string }> = [];
  const upserts: Database["public"]["Tables"]["leads"]["Insert"][] = [];

  for (const lead of parsed.data.leads) {
    const pn = parsePhoneNumberFromString(lead.phone, "IN");
    if (!pn || !pn.isValid()) {
      rejected.push({ phone: lead.phone, reason: "invalid_phone" });
      continue;
    }
    const e164 = pn.number;
    upserts.push({
      tenant_id: tenantId,
      property_id: property.id,
      name: lead.name,
      phone_e164: e164,
      source: lead.source ?? "api",
      language_hint: lead.language_hint ?? "en",
      custom_vars: lead.custom_vars,
    });
    accepted.push(e164);
  }

  if (upserts.length > 0) {
    const { error: upsertErr } = await admin
      .from("leads")
      .upsert(upserts, { onConflict: "tenant_id,phone_e164", ignoreDuplicates: false });
    if (upsertErr) {
      logger.error({ err: upsertErr.message }, "v1/leads: upsert failed");
      return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, accepted: accepted.length, rejected });
}

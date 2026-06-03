import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Bolna calls this endpoint via the `book_site_visit` custom function tool registered on
 * the agent. Authentication: the agent is configured with `api_token` = the tenant's
 * webhook_token (Bearer in the Authorization header). Constant-time compare via token lookup.
 *
 * The tool sends:
 *   { day, time, bhk, budget_inr, purpose, execution_id (from {execution_id} context var) }
 * We write a tentative inbox_items row and ack so the agent reads back a confirmation.
 */

const BodySchema = z.object({
  execution_id: z.string().min(1),
  day: z.string().min(1).max(80),
  time: z.string().min(1).max(40),
  bhk: z.string().min(1).max(8),
  budget_inr: z.coerce.number().int().nonnegative().optional().nullable(),
  purpose: z.enum(["self", "investment", "unknown"]).optional().default("unknown"),
  caller_name: z.string().max(120).optional(),
});

export async function POST(req: Request) {
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

  // Locate the live call by bolna_execution_id within this tenant.
  const { data: call } = await admin
    .from("calls")
    .select("id, lead_id")
    .eq("bolna_execution_id", parsed.data.execution_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!call) {
    logger.warn(
      { tenantId, execId: parsed.data.execution_id },
      "book-visit: no matching call row — agent fired tool before call.start finished?",
    );
    // Still ack so the agent can continue.
    return NextResponse.json({
      ok: true,
      confirmation: `Booked tentatively for ${parsed.data.day} at ${parsed.data.time}.`,
      warning: "call_row_not_found",
    });
  }

  const summary = `${parsed.data.bhk} BHK · ${parsed.data.day} at ${parsed.data.time} · purpose=${parsed.data.purpose}`;

  await admin.from("inbox_items").upsert(
    {
      tenant_id: tenantId,
      call_id: call.id,
      lead_id: call.lead_id,
      status: "site_visit_booked",
      summary,
    },
    { onConflict: "call_id" },
  );

  return NextResponse.json({
    ok: true,
    confirmation: `Your visit is booked for ${parsed.data.day} at ${parsed.data.time}. Our advisor will WhatsApp you the directions shortly.`,
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BolnaClient } from "@/lib/bolna/client";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const BodySchema = z.object({
  property_id: z.string().uuid(),
  transcript: z.string().min(20).max(50_000),
  user_data: z.record(z.string()).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  // RLS-enforced: this query returns nothing if the user can't see the property.
  const { data: property, error: propErr } = await supabase
    .from("properties")
    .select("id, tenant_id, bolna_agent_id")
    .eq("id", parsed.data.property_id)
    .maybeSingle();

  if (propErr) {
    logger.error({ err: propErr.message }, "test-dispositions: property lookup failed");
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
  if (!property || !property.bolna_agent_id) {
    return NextResponse.json(
      { ok: false, error: "property_or_agent_not_found" },
      { status: 404 },
    );
  }

  // Resolve the tenant's encrypted Bolna API key via service-role.
  const admin = createSupabaseAdminClient();
  const { data: secrets } = await admin
    .from("tenant_secrets")
    .select("bolna_api_key_ciphertext")
    .eq("tenant_id", property.tenant_id)
    .maybeSingle();
  if (!secrets?.bolna_api_key_ciphertext) {
    return NextResponse.json(
      { ok: false, error: "bolna_credentials_not_configured" },
      { status: 412 },
    );
  }
  const apiKey = decrypt(secrets.bolna_api_key_ciphertext as string);
  const client = new BolnaClient({ apiKey, breakerPrefix: `bolna.${property.tenant_id}` });

  try {
    const result = await client.testAgentDispositions(property.bolna_agent_id, {
      transcript: parsed.data.transcript,
      user_data: parsed.data.user_data,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err: String(err) }, "test-dispositions: Bolna call failed");
    return NextResponse.json(
      { ok: false, error: "bolna_call_failed", detail: String(err) },
      { status: 502 },
    );
  }
}

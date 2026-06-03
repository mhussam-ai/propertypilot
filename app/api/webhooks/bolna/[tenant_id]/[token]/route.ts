import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authenticateWebhook, extractClientIp, idempotencyKey } from "@/lib/bolna/auth-webhook";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { WebhookPayloadSchema } from "@/lib/schema/outcome";
import { inngest } from "@/inngest/client";
import { logger } from "@/lib/logger";

// Always run as a Node.js route — we use node:crypto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ tenant_id: string; token: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
  const { tenant_id: tenantId, token: pathToken } = await ctx.params;
  const ip = extractClientIp(req.headers);

  const supabase = createSupabaseAdminClient();

  // Look up the expected token for this tenant.
  const { data: secrets, error: secretsErr } = await supabase
    .from("tenant_secrets")
    .select("webhook_token_ciphertext")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (secretsErr) {
    logger.error({ tenantId, err: secretsErr.message }, "Webhook: secrets lookup failed");
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
  if (!secrets?.webhook_token_ciphertext) {
    logger.warn({ tenantId, ip }, "Webhook: no token registered for tenant");
    return NextResponse.json({ ok: false, error: "unknown_tenant" }, { status: 404 });
  }

  let expectedToken: string;
  try {
    expectedToken = decrypt(secrets.webhook_token_ciphertext as string);
  } catch (err) {
    logger.error({ tenantId, err: String(err) }, "Webhook: token decryption failed");
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }

  const auth = authenticateWebhook({ ip, pathToken, expectedToken });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  // Parse + validate payload.
  const raw = await req.text();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    logger.warn({ tenantId, ip }, "Webhook: malformed JSON");
    return NextResponse.json({ ok: false, error: "malformed_json" }, { status: 400 });
  }
  const parsed = WebhookPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    logger.warn(
      { tenantId, ip, issues: parsed.error.flatten() },
      "Webhook: payload schema validation failed",
    );
    return NextResponse.json({ ok: false, error: "bad_payload" }, { status: 400 });
  }
  const payload = parsed.data;
  const idemKey = idempotencyKey({
    id: payload.id,
    status: payload.status,
    retry_count: payload.retry_count ?? 0,
  });

  // Find the property/call this maps to by Bolna agent_id.
  const { data: property } = await supabase
    .from("properties")
    .select("id, tenant_id")
    .eq("bolna_agent_id", payload.agent_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!property) {
    logger.warn(
      { tenantId, agentId: payload.agent_id },
      "Webhook: no property linked to this Bolna agent_id; journaling without call_id",
    );
  }

  // Find the existing calls row (if call.start has already inserted it).
  const { data: existingCall } = await supabase
    .from("calls")
    .select("id")
    .eq("bolna_execution_id", payload.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // Insert the event idempotently. The unique constraint on idempotency_key makes replays no-ops.
  const { data: insertedEvent, error: insertErr } = await supabase
    .from("call_events")
    .insert({
      tenant_id: tenantId,
      call_id: existingCall?.id ?? null,
      bolna_execution_id: payload.id,
      kind: "status_update",
      status: payload.status,
      retry_count: payload.retry_count ?? 0,
      payload: payload as unknown as Record<string, unknown>,
      source_ip: ip,
      idempotency_key: idemKey,
    })
    .select("id")
    .single();

  if (insertErr) {
    // Idempotent replay = unique violation 23505. That's expected and fine.
    if ((insertErr as { code?: string }).code === "23505") {
      logger.debug({ tenantId, idemKey }, "Webhook: idempotent replay no-op");
      return NextResponse.json({ ok: true, deduped: true });
    }
    logger.error({ tenantId, err: insertErr.message }, "Webhook: insert call_event failed");
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }

  // Hand off async finalization to Inngest. Return fast.
  await inngest.send({
    name: "call.webhook.ingested",
    data: {
      tenantId,
      callEventId: insertedEvent.id as string,
      bolnaExecutionId: payload.id,
      status: payload.status,
    },
  });

  return NextResponse.json({ ok: true });
}

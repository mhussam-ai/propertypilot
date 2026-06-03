"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto/aes-gcm";
import { getTenantContext } from "@/lib/tenant/context";
import { BolnaClient } from "@/lib/bolna/client";
import { logger } from "@/lib/logger";

const InputSchema = z.object({
  api_key: z.string().min(20, "API key looks too short").max(400),
  validate: z.boolean().default(true),
});

export type UpdateBolnaResult =
  | { ok: true; validated: boolean }
  | { ok: false; error: string };

/**
 * Stores the tenant's Bolna API key, encrypted at rest with AES-256-GCM.
 * Optionally validates the key by calling Bolna's GET /v2/agent/all before saving.
 */
export async function updateBolnaCredentials(input: unknown): Promise<UpdateBolnaResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "invalid input" };
  }

  const tenant = await getTenantContext();
  if (!tenant) return { ok: false, error: "unauthenticated" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { ok: false, error: "forbidden — only owner or admin can update credentials" };
  }

  // Validate the key against Bolna before persisting. Saves you finding out two days later.
  if (parsed.data.validate) {
    try {
      const client = new BolnaClient({
        apiKey: parsed.data.api_key,
        breakerPrefix: `bolna.${tenant.tenantId}.validate`,
      });
      // GET /v2/agent/all is rate-limited at 500/min; one call is fine.
      // We don't need to inspect the response — just confirm 2xx.
      await client["request" as never]({ method: "GET", path: "/v2/agent/all", label: "validate-key" });
    } catch (err) {
      logger.warn({ err: String(err) }, "Bolna API key validation failed");
      return {
        ok: false,
        error: `Bolna rejected this key. ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const admin = createSupabaseAdminClient();
  const ciphertext = encrypt(parsed.data.api_key);
  const { error } = await admin
    .from("tenant_secrets")
    .update({ bolna_api_key_ciphertext: ciphertext })
    .eq("tenant_id", tenant.tenantId);

  if (error) {
    logger.error({ err: error.message }, "tenant_secrets update failed");
    return { ok: false, error: "could not save key" };
  }

  await admin.from("audit_log").insert({
    tenant_id: tenant.tenantId,
    actor_user_id: tenant.userId,
    action: "update_bolna_api_key",
    target_kind: "tenant_secrets",
    target_id: tenant.tenantId,
  });

  revalidatePath("/app/settings");
  return { ok: true, validated: parsed.data.validate };
}

"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encrypt, generateOpaqueToken } from "@/lib/crypto/aes-gcm";
import { logger } from "@/lib/logger";

/**
 * Called from the signup page after Supabase Auth signUp succeeds. Idempotent.
 * Returns the tenant_id the user now belongs to.
 */
export async function bootstrapTenant(companyName: string): Promise<{ ok: true; tenantId: string } | { ok: false; error: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) {
    return { ok: false, error: "unauthenticated" };
  }

  const admin = createSupabaseAdminClient();
  const webhookToken = generateOpaqueToken(32);
  const ciphertext = encrypt(webhookToken);

  const { data: tenantId, error } = await admin.rpc("bootstrap_tenant", {
    p_user_id: auth.user.id,
    p_company_name: companyName,
    p_webhook_token_ciphertext: ciphertext,
  });

  if (error) {
    logger.error({ err: error.message, userId: auth.user.id }, "bootstrap_tenant RPC failed");
    return { ok: false, error: "bootstrap_failed" };
  }

  logger.info({ tenantId, userId: auth.user.id }, "Tenant bootstrapped");
  return { ok: true, tenantId: tenantId as string };
}

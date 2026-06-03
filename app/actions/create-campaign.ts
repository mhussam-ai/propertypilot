"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/tenant/context";
import { logger } from "@/lib/logger";

const InputSchema = z.object({
  property_id: z.string().uuid(),
  name: z.string().min(2).max(120),
  daily_cap: z.coerce.number().int().positive().max(10_000),
  budget_cap_inr: z.coerce.number().int().nonnegative().optional(),
  prompt_version: z.coerce.number().int().positive().default(1),
  status: z.enum(["draft", "active"]).default("active"),
});

export type CreateCampaignResult =
  | { ok: true; campaignId: string }
  | { ok: false; error: string };

export async function createCampaign(input: unknown): Promise<CreateCampaignResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "invalid input" };
  }
  const tenant = await getTenantContext();
  if (!tenant) return { ok: false, error: "unauthenticated" };

  const admin = createSupabaseAdminClient();

  const { data: campaign, error } = await admin
    .from("campaigns")
    .insert({
      tenant_id: tenant.tenantId,
      property_id: parsed.data.property_id,
      name: parsed.data.name,
      daily_cap: parsed.data.daily_cap,
      budget_cap_inr: parsed.data.budget_cap_inr ?? null,
      prompt_version: parsed.data.prompt_version,
      status: parsed.data.status,
      created_by: tenant.userId,
    })
    .select("id")
    .single();

  if (error || !campaign) {
    logger.error({ err: error?.message }, "create-campaign insert failed");
    return { ok: false, error: error?.message ?? "insert failed" };
  }

  revalidatePath("/app/campaigns");
  return { ok: true, campaignId: campaign.id };
}

export async function createCampaignForm(formData: FormData): Promise<void> {
  const result = await createCampaign({
    property_id: formData.get("property_id"),
    name: formData.get("name"),
    daily_cap: formData.get("daily_cap"),
    budget_cap_inr: formData.get("budget_cap_inr") || undefined,
    prompt_version: formData.get("prompt_version") ?? 1,
    status: formData.get("status") ?? "active",
  });
  if (!result.ok) {
    redirect(`/app/campaigns/new?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/app/campaigns/${result.campaignId}/leads`);
}

/* ---------- Lifecycle actions ---------- */

export async function pauseCampaign(campaignId: string): Promise<{ ok: boolean; error?: string }> {
  const tenant = await getTenantContext();
  if (!tenant) return { ok: false, error: "unauthenticated" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("campaigns")
    .update({ status: "paused" })
    .eq("id", campaignId)
    .eq("tenant_id", tenant.tenantId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/app/campaigns/${campaignId}`);
  return { ok: true };
}

export async function resumeCampaign(campaignId: string): Promise<{ ok: boolean; error?: string }> {
  const tenant = await getTenantContext();
  if (!tenant) return { ok: false, error: "unauthenticated" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("campaigns")
    .update({ status: "active" })
    .eq("id", campaignId)
    .eq("tenant_id", tenant.tenantId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/app/campaigns/${campaignId}`);
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/tenant/context";

export interface CopyLeadsResult {
  ok: boolean;
  copied: number;
  duplicates: number;
  error?: string;
}

export async function copyLeads(
  sourceCampaignId: string,
  targetCampaignId: string,
): Promise<CopyLeadsResult> {
  const tenant = await getTenantContext();
  if (!tenant) return { ok: false, copied: 0, duplicates: 0, error: "unauthenticated" };

  const admin = createSupabaseAdminClient();

  // Validate target campaign
  const { data: targetCampaign } = await admin
    .from("campaigns")
    .select("property_id")
    .eq("id", targetCampaignId)
    .eq("tenant_id", tenant.tenantId)
    .single();

  if (!targetCampaign) {
    return { ok: false, copied: 0, duplicates: 0, error: "target_campaign_not_found" };
  }

  // Fetch leads from source
  const { data: sourceLeads, error: sourceError } = await admin
    .from("leads")
    .select("*")
    .eq("campaign_id", sourceCampaignId)
    .eq("tenant_id", tenant.tenantId);

  if (sourceError || !sourceLeads) {
    return { ok: false, copied: 0, duplicates: 0, error: "failed_to_fetch_source_leads" };
  }

  if (sourceLeads.length === 0) {
    return { ok: true, copied: 0, duplicates: 0 };
  }

  // Prepare upsert payload
  const upserts = sourceLeads.map((l) => ({
    tenant_id: tenant.tenantId,
    property_id: targetCampaign.property_id,
    campaign_id: targetCampaignId,
    phone_e164: l.phone_e164,
    name: l.name,
    language_hint: l.language_hint,
    source: "campaign_copy",
    custom_vars: l.custom_vars,
    status: "new",
  }));

  // Perform a single big upsert, ignoring duplicates on (campaign_id, phone_e164).
  const { error: insertError, count } = await admin
    .from("leads")
    .upsert(upserts, {
      onConflict: "campaign_id, phone_e164",
      ignoreDuplicates: true,
      count: "exact",
    });

  if (insertError) {
    return { ok: false, copied: 0, duplicates: 0, error: insertError.message };
  }

  const insertedCount = count ?? 0;
  const duplicates = upserts.length - insertedCount;

  revalidatePath("/app/campaigns");
  revalidatePath(`/app/campaigns/${targetCampaignId}`);
  return { ok: true, copied: insertedCount, duplicates };
}

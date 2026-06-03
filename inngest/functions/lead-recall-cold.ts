import { inngest } from "@/inngest/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BolnaClient } from "@/lib/bolna/client";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { logger } from "@/lib/logger";

/**
 * lead.recall_cold: hybrid dispatch.
 *
 * After a campaign's hot-launch wave completes, leads that never picked up or never
 * promised a visit are batched up and uploaded to Bolna's Batch API + scheduled at
 * +24h / +72h / +7d. Bolna owns scheduling + intra-call retries for these recalls;
 * we own the campaign-level cap of 3 cold-recall batches per lead per campaign.
 */
export const leadRecallCold = inngest.createFunction(
  { id: "lead.recall_cold", name: "Schedule cold-recall batch", retries: 2 },
  { event: "lead.recall_cold" },
  async ({ event, step }) => {
    const { tenantId, campaignId } = event.data;
    const admin = createSupabaseAdminClient();

    const prior = await step.run("count-prior-batches", async () => {
      const { count } = await admin
        .from("campaign_recall_batches")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId);
      return count ?? 0;
    });

    if (prior >= 3) {
      // Cap exceeded; mark remaining un-booked leads as exhausted.
      await admin
        .from("leads")
        .update({ status: "exhausted" })
        .in("status", ["contacted", "queued"])
        .eq("tenant_id", tenantId);
      return { ok: true, action: "exhausted_cap" };
    }

    const attemptNumber = prior + 1;
    const intervalsHours = [24, 72, 168];
    const offsetMs = intervalsHours[attemptNumber - 1]! * 60 * 60 * 1000;
    const scheduledAt = new Date(Date.now() + offsetMs);

    const ctx = await step.run("load-campaign-context", async () => {
      const { data: campaign } = await admin
        .from("campaigns")
        .select("property_id, tenant_id, retry_policy")
        .eq("id", campaignId)
        .single();
      if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

      const { data: property } = await admin
        .from("properties")
        .select("bolna_agent_id, retry_policy")
        .eq("id", campaign.property_id)
        .single();
      if (!property?.bolna_agent_id) throw new Error("Property has no Bolna agent");

      const { data: secrets } = await admin
        .from("tenant_secrets")
        .select("bolna_api_key_ciphertext")
        .eq("tenant_id", campaign.tenant_id)
        .single();
      if (!secrets?.bolna_api_key_ciphertext) throw new Error("Missing Bolna API key");

      return { campaign, property, apiKey: decrypt(secrets.bolna_api_key_ciphertext as string) };
    });

    // Pick the leads to recall: contacted in this campaign but never visit_booked, not DNC.
    const leadsToRecall = await step.run("pick-recall-leads", async () => {
      const { data } = await admin
        .from("leads")
        .select("id, name, phone_e164, language_hint, source")
        .eq("tenant_id", tenantId)
        .eq("property_id", ctx.campaign.property_id)
        .in("status", ["contacted", "queued"])
        .eq("dnc", false)
        .limit(1000);
      return data ?? [];
    });

    if (leadsToRecall.length === 0) {
      return { ok: true, action: "no_leads_to_recall" };
    }

    // Build CSV body: contact_number,first_name,language_hint,lead_source
    const header = "contact_number,caller_name,language_hint,lead_source";
    const rows = leadsToRecall.map((l) =>
      [l.phone_e164, csvEscape(l.name), l.language_hint ?? "en", l.source ?? "csv_upload"].join(","),
    );
    const csvText = [header, ...rows].join("\n");
    const csvBlob = new Blob([csvText], { type: "text/csv" });

    const retryPolicy = (ctx.property.retry_policy ?? {}) as {
      max_retries?: number;
      retry_intervals_minutes?: number[];
      retry_on_voicemail?: boolean;
    };

    const client = new BolnaClient({ apiKey: ctx.apiKey, breakerPrefix: `bolna.${tenantId}` });

    const batch = await step.run("create-batch", () =>
      client.createBatch({
        agentId: ctx.property.bolna_agent_id as string,
        csv: csvBlob,
        retryConfig: {
          enabled: true,
          max_retries: retryPolicy.max_retries ?? 3,
          retry_intervals_minutes: retryPolicy.retry_intervals_minutes ?? [30, 60, 120],
          retry_on_voicemail: retryPolicy.retry_on_voicemail ?? false,
        },
      }),
    );

    await step.run("schedule-batch", () =>
      client.scheduleBatch(batch.batch_id, { scheduled_at: scheduledAt.toISOString() }),
    );

    await admin.from("campaign_recall_batches").insert({
      tenant_id: tenantId,
      campaign_id: campaignId,
      attempt_number: attemptNumber,
      bolna_batch_id: batch.batch_id,
      scheduled_at: scheduledAt.toISOString(),
      lead_count: leadsToRecall.length,
      status: "scheduled",
    });

    logger.info(
      { tenantId, campaignId, attemptNumber, batchId: batch.batch_id, leadCount: leadsToRecall.length },
      "Cold-recall batch scheduled",
    );
    return { ok: true, batchId: batch.batch_id, attemptNumber };
  },
);

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

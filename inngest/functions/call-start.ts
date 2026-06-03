import { inngest } from "@/inngest/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BolnaClient } from "@/lib/bolna/client";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { buildUserData } from "@/lib/prompt/render";
import { logger } from "@/lib/logger";

/**
 * call.start: build user_data, call Bolna /call, persist a calls row in `dialing` status.
 */
export const callStart = inngest.createFunction(
  { id: "call.start", name: "Start outbound call via Bolna", retries: 3 },
  { event: "call.start" },
  async ({ event, step }) => {
    const { tenantId, leadId, campaignId, propertyId, promptVersion, traceId } = event.data;
    const admin = createSupabaseAdminClient();

    const lead = await step.run("load-lead", async () => {
      const { data } = await admin
        .from("leads")
        .select("id, name, phone_e164, source, language_hint, custom_vars, dnc")
        .eq("id", leadId)
        .eq("tenant_id", tenantId)
        .single();
      if (!data) throw new Error(`Lead ${leadId} not found for tenant ${tenantId}`);
      if (data.dnc) throw new Error(`Lead ${leadId} is on DNC`);
      return data;
    });

    const property = await step.run("load-property", async () => {
      const { data } = await admin
        .from("properties")
        .select(
          "id, name, bolna_agent_id, default_voice_id, language_voice_overrides, retry_policy",
        )
        .eq("id", propertyId)
        .eq("tenant_id", tenantId)
        .single();
      if (!data || !data.bolna_agent_id) {
        throw new Error(`Property ${propertyId} has no Bolna agent linked`);
      }
      return data;
    });

    const apiKey = await step.run("load-bolna-key", async () => {
      const { data } = await admin
        .from("tenant_secrets")
        .select("bolna_api_key_ciphertext")
        .eq("tenant_id", tenantId)
        .single();
      if (!data?.bolna_api_key_ciphertext) throw new Error("Missing Bolna API key for tenant");
      return decrypt(data.bolna_api_key_ciphertext as string);
    });

    const userData = buildUserData({
      caller_name: lead.name,
      language_hint: lead.language_hint ?? "en",
      lead_source: lead.source ?? "csv_upload",
      custom_vars: lead.custom_vars as Record<string, string> | undefined,
    });

    const overrides = (property.language_voice_overrides ?? {}) as Record<string, string>;
    const voiceId = overrides[lead.language_hint] ?? property.default_voice_id;

    const retryPolicy = (property.retry_policy ?? {}) as {
      max_retries?: number;
      retry_intervals_minutes?: number[];
      retry_on_voicemail?: boolean;
    };

    const client = new BolnaClient({ apiKey, breakerPrefix: `bolna.${tenantId}` });

    const callResult = await step.run("bolna-start-call", () =>
      client.startCall({
        agent_id: property.bolna_agent_id as string,
        recipient_phone_number: lead.phone_e164,
        from_phone_number: "+918047280881",
        user_data: userData,
        agent_data: { voice_id: voiceId },
        retry_config: {
          enabled: true,
          max_retries: retryPolicy.max_retries ?? 3,
          retry_on_statuses: ["no-answer", "busy", "failed"],
          retry_on_voicemail: retryPolicy.retry_on_voicemail ?? false,
          retry_intervals_minutes: retryPolicy.retry_intervals_minutes ?? [30, 60, 120],
        },
      }),
    );

    await step.run("persist-call-row", async () => {
      const { error } = await admin.from("calls").insert({
        tenant_id: tenantId,
        lead_id: leadId,
        property_id: propertyId,
        campaign_id: campaignId,
        prompt_version: promptVersion,
        bolna_execution_id: callResult.execution_id,
        to_number: lead.phone_e164,
        status: callResult.status ?? "queued",
        trace_id: traceId,
      });
      if (error) throw new Error(`Persist call failed: ${error.message}`);

      // Mark lead as dialing so campaign-dispatch won't re-pick it.
      await admin.from("leads").update({ status: "dialing" }).eq("id", leadId);

      const { error: incErr } = await admin.rpc("increment_lead_attempt", { p_lead_id: leadId });
      if (incErr) throw new Error(`Increment attempt failed: ${incErr.message}`);
    });

    logger.info(
      { tenantId, leadId, executionId: callResult.execution_id, traceId },
      "call.start completed",
    );
    return { executionId: callResult.execution_id };
  },
);

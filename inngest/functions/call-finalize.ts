import { inngest } from "@/inngest/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  WebhookPayloadSchema,
  isVisitPromised,
  needsHumanReview,
  detectedLanguage,
} from "@/lib/schema/outcome";
import { logger } from "@/lib/logger";
import type { Database, Json } from "@/lib/supabase/database.types";

/**
 * call.webhook.ingested: read the raw call_event row, hydrate the calls table,
 * flatten extracted_data into call_disposition_results, and emit follow-up events
 * for hot/cold routing.
 */
export const callFinalize = inngest.createFunction(
  { id: "call.finalize", name: "Finalize Bolna call", retries: 3 },
  { event: "call.webhook.ingested" },
  async ({ event, step }) => {
    const { tenantId, callEventId, bolnaExecutionId, status } = event.data;
    const admin = createSupabaseAdminClient();

    const callEvent = await step.run("load-event", async () => {
      const { data } = await admin
        .from("call_events")
        .select("id, tenant_id, payload, source_ip")
        .eq("id", callEventId)
        .single();
      if (!data) throw new Error(`call_event ${callEventId} not found`);
      return data;
    });

    const parsed = WebhookPayloadSchema.safeParse(callEvent.payload);
    if (!parsed.success) {
      logger.error({ callEventId, issues: parsed.error.flatten() }, "Bad payload in call_event");
      return { ok: false, reason: "bad_payload" };
    }
    const payload = parsed.data;

    // Ensure a calls row exists. If call.start hasn't run yet (race condition), upsert
    // a minimal stub so subsequent events have a parent row.
    const callRow = await step.run("upsert-calls-row", async () => {
      const { data: existing } = await admin
        .from("calls")
        .select("id, lead_id, property_id, campaign_id")
        .eq("bolna_execution_id", bolnaExecutionId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      const update: Database["public"]["Tables"]["calls"]["Update"] = {
        status: status as Database["public"]["Enums"]["call_status"],
        cost_inr: payload.cost ?? null,
        duration_s: payload.conversation_time ?? null,
        hangup_reason: payload.hangup_reason ?? null,
        recording_url: payload.recording_url ?? null,
        transcript: payload.transcript ?? null,
        extracted_data: (payload.extracted_data ?? null) as unknown as Json,
        answered_by_voice_mail: payload.answered_by_voice_mail ?? null,
        telephony_provider: payload.telephony_provider ?? null,
        to_number_carrier: payload.to_number_carrier ?? null,
        retry_count: payload.retry_count ?? 0,
        from_number: payload.from_number ?? null,
        to_number: payload.to_number ?? null,
        needs_human_review: needsHumanReview(payload.extracted_data ?? null),
        ended_at: status === "completed" ? new Date().toISOString() : null,
      };

      if (existing) {
        const { error } = await admin.from("calls").update(update).eq("id", existing.id);
        if (error) throw new Error(`Update call failed: ${error.message}`);
        return existing;
      } else {
        // Unknown call — likely arrived before call.start. Insert a stub.
        const { data: inserted, error } = await admin
          .from("calls")
          .insert({
            tenant_id: tenantId,
            bolna_execution_id: bolnaExecutionId,
            // lead_id/property_id may be null here; we'll backfill on next event if call.start arrives.
            lead_id: null as unknown as string,
            property_id: null as unknown as string,
            ...update,
          })
          .select("id, lead_id, property_id, campaign_id")
          .single();
        if (error) throw new Error(`Insert call failed: ${error.message}`);
        return inserted;
      }
    });

    // Link the event back to the call row.
    await admin.from("call_events").update({ call_id: callRow.id }).eq("id", callEventId);

    // Flatten dispositions into the queryable table.
    if (payload.extracted_data) {
      await step.run("upsert-disposition-results", async () => {
        const rows: Database["public"]["Tables"]["call_disposition_results"]["Insert"][] = [];
        for (const [category, dispositions] of Object.entries(payload.extracted_data ?? {})) {
          for (const [name, result] of Object.entries(dispositions)) {
            const objArray = Array.isArray(result.objective) ? result.objective : null;
            const objScalar = !Array.isArray(result.objective) ? (result.objective as string | null) : null;
            rows.push({
              tenant_id: tenantId,
              call_id: callRow.id,
              category,
              name,
              subjective: result.subjective,
              objective: objScalar,
              objective_array: objArray,
              confidence: result.confidence,
              confidence_label: result.confidence_label,
              reasoning_subjective: result.reasoning_subjective ?? null,
              reasoning_objective: result.reasoning_objective ?? null,
              validation: (result.validation ?? null) as unknown as Json,
            });
          }
        }
        if (rows.length === 0) return;
        const { error } = await admin
          .from("call_disposition_results")
          .upsert(rows, { onConflict: "call_id,category,name" });
        if (error) throw new Error(`Upsert dispositions failed: ${error.message}`);
      });
    }

    // Route hot/cold.
    if (status === "completed" && callRow.lead_id) {
      if (isVisitPromised(payload.extracted_data ?? null)) {
        await step.sendEvent("hot-route", {
          name: "lead.route_hot",
          data: { tenantId, callId: callRow.id, leadId: callRow.lead_id },
        });
        await admin.from("leads").update({ status: "visit_booked" }).eq("id", callRow.lead_id);
      } else {
        await admin.from("leads").update({ status: "contacted" }).eq("id", callRow.lead_id);
      }

      // Update detected language as a write-through on the lead for cold-recall reuse.
      const lang = detectedLanguage(payload.extracted_data ?? null);
      if (lang) {
        await admin.from("leads").update({ language_hint: lang }).eq("id", callRow.lead_id);
      }
    }

    return { ok: true, status };
  },
);

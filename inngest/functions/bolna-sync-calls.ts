import { inngest } from "@/inngest/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BolnaClient } from "@/lib/bolna/client";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { logger } from "@/lib/logger";
import type { Database, Json } from "@/lib/supabase/database.types";

/**
 * bolna.sync-calls: poll Bolna for in-flight call status updates.
 *
 * Runs every 30 seconds. For every call in a non-terminal status (queued, dialing,
 * in-progress), fetches the latest execution data from Bolna and hydrates the
 * local calls + leads tables. This is essential when running locally (localhost
 * can't receive webhooks) and serves as a safety net in production.
 */
const TERMINAL_STATUSES = new Set([
  "completed", "failed", "error", "no-answer", "busy", "voicemail",
]);

const BOLNA_TO_LEAD_STATUS: Record<string, Database["public"]["Enums"]["lead_status"]> = {
  "completed": "contacted",
  "failed": "exhausted",
  "error": "exhausted",
  "no-answer": "exhausted",
  "busy": "exhausted",
  "voicemail": "contacted",
};

export const bolnaSyncCalls = inngest.createFunction(
  { id: "bolna.sync-calls", name: "Sync in-flight call statuses from Bolna" },
  { cron: "*/1 * * * *" },
  async ({ step }) => {
    const admin = createSupabaseAdminClient();

    // Find all calls that are still in a non-terminal status.
    const pendingCalls = await step.run("find-pending", async () => {
      const { data } = await admin
        .from("calls")
        .select("id, tenant_id, bolna_execution_id, property_id, lead_id, status")
        .in("status", ["queued", "initiated", "dialing", "in-progress", "scheduled"])
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    });

    if (pendingCalls.length === 0) return { ok: true, synced: 0 };

    // Group calls by tenant_id to avoid loading the API key multiple times.
    const byTenant = new Map<string, typeof pendingCalls>();
    for (const call of pendingCalls) {
      const arr = byTenant.get(call.tenant_id) ?? [];
      arr.push(call);
      byTenant.set(call.tenant_id, arr);
    }

    let synced = 0;

    for (const [tenantId, calls] of byTenant) {
      const apiKey = await step.run(`load-key-${tenantId}`, async () => {
        const { data } = await admin
          .from("tenant_secrets")
          .select("bolna_api_key_ciphertext")
          .eq("tenant_id", tenantId)
          .single();
        return data?.bolna_api_key_ciphertext
          ? decrypt(data.bolna_api_key_ciphertext as string)
          : null;
      });
      if (!apiKey) continue;

      const client = new BolnaClient({ apiKey, breakerPrefix: `bolna.${tenantId}` });

      for (const call of calls) {
        try {
          const exec = await step.run(`poll-${call.bolna_execution_id}`, () =>
            client.getExecution(call.bolna_execution_id),
          );

          // Only update if something changed.
          if (exec.status === call.status) continue;

          const td = exec.telephony_data;
          const update: Database["public"]["Tables"]["calls"]["Update"] = {
            status: exec.status as Database["public"]["Enums"]["call_status"],
            cost_inr: exec.total_cost ?? null,
            duration_s: exec.conversation_duration ?? td?.duration ?? null,
            hangup_reason: td?.hangup_reason ?? null,
            recording_url: td?.recording_url ?? null,
            transcript: exec.transcript ?? null,
            extracted_data: (exec.extracted_data ?? null) as unknown as Json,
            answered_by_voice_mail: exec.answered_by_voice_mail ?? null,
            retry_count: exec.retry_count ?? 0,
            from_number: td?.from_number ?? exec.agent_number ?? null,
            to_number: td?.to_number ?? exec.user_number ?? null,
          };

          if (TERMINAL_STATUSES.has(exec.status)) {
            update.ended_at = new Date().toISOString();
          }

          await step.run(`update-call-${call.id}`, async () => {
            await admin.from("calls").update(update).eq("id", call.id);
          });

          // Update lead status for terminal calls.
          if (call.lead_id && TERMINAL_STATUSES.has(exec.status)) {
            const newLeadStatus = BOLNA_TO_LEAD_STATUS[exec.status] ?? "contacted";
            await step.run(`update-lead-${call.lead_id}`, async () => {
              await admin
                .from("leads")
                .update({ status: newLeadStatus, last_attempted_at: new Date().toISOString() })
                .eq("id", call.lead_id);
            });
          }

          synced += 1;
          logger.info(
            { tenantId, callId: call.id, oldStatus: call.status, newStatus: exec.status },
            "bolna.sync-calls updated",
          );
        } catch (err) {
          logger.error(
            { tenantId, executionId: call.bolna_execution_id, err: String(err) },
            "bolna.sync-calls: failed to poll execution",
          );
        }
      }
    }

    return { ok: true, synced };
  },
);

import { inngest } from "@/inngest/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BolnaClient } from "@/lib/bolna/client";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { logger } from "@/lib/logger";

/**
 * bolna.poll-executions: nightly DR reconcile.
 *
 * For every property with a Bolna agent, list executions from the last 24 hours and
 * ensure each one has a corresponding call_events row. Heals any missed webhooks.
 *
 * Runs at 02:00 IST daily.
 */
export const bolnaPoll = inngest.createFunction(
  { id: "bolna.poll-executions", name: "Reconcile missed Bolna executions" },
  { cron: "TZ=Asia/Kolkata 0 2 * * *" },
  async ({ step }) => {
    const admin = createSupabaseAdminClient();

    const properties = await step.run("list-properties", async () => {
      const { data } = await admin
        .from("properties")
        .select("id, tenant_id, bolna_agent_id")
        .not("bolna_agent_id", "is", null);
      return data ?? [];
    });

    let reconciled = 0;

    for (const property of properties) {
      const apiKey = await step.run(`load-key-${property.id}`, async () => {
        const { data } = await admin
          .from("tenant_secrets")
          .select("bolna_api_key_ciphertext")
          .eq("tenant_id", property.tenant_id)
          .single();
        return data?.bolna_api_key_ciphertext ? decrypt(data.bolna_api_key_ciphertext as string) : null;
      });
      if (!apiKey) continue;

      const client = new BolnaClient({ apiKey, breakerPrefix: `bolna.${property.tenant_id}` });
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const res = await step.run(`list-execs-${property.id}-p${page}`, () =>
          client.listAgentExecutions(property.bolna_agent_id as string, {
            page_number: page,
            page_size: 50,
          }),
        );
        for (const exec of res.data) {
          const { data: existing } = await admin
            .from("call_events")
            .select("id")
            .eq("bolna_execution_id", exec.id)
            .eq("status", exec.status)
            .limit(1);
          if (existing && existing.length > 0) continue;

          // Synthesize a webhook-shaped event from the execution.
          const idemKey = `${exec.id}:${exec.status}:reconcile`;
          await admin.from("call_events").insert({
            tenant_id: property.tenant_id,
            bolna_execution_id: exec.id,
            kind: "reconcile",
            status: exec.status,
            retry_count: exec.retry_count ?? 0,
            payload: exec as unknown as Record<string, unknown>,
            source_ip: "reconcile",
            idempotency_key: idemKey,
          });
          reconciled += 1;
        }
        hasMore = res.has_more;
        page += 1;
        if (page > 20) break; // safety
      }
    }

    logger.info({ reconciled }, "bolna.poll-executions completed");
    return { ok: true, reconciled };
  },
);

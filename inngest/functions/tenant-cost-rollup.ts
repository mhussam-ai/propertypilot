import { inngest } from "@/inngest/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * tenant.cost-rollup: hourly aggregate of completed-call costs into the campaign
 * budget_consumed_inr field. Triggers soft/hard stop logic.
 */
export const tenantCostRollup = inngest.createFunction(
  { id: "tenant.cost-rollup", name: "Hourly campaign cost rollup" },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const admin = createSupabaseAdminClient();

    const active = await step.run("list-active-campaigns", async () => {
      const { data } = await admin
        .from("campaigns")
        .select("id, budget_cap_inr, budget_consumed_inr")
        .in("status", ["active", "paused"]);
      return data ?? [];
    });

    for (const c of active) {
      const { data: sum, error: sumErr } = await admin.rpc("cost_rollup_for_campaign", {
        p_campaign_id: c.id,
      });
      if (sumErr) {
        logger.error({ campaignId: c.id, err: sumErr.message }, "cost rollup RPC failed");
        continue;
      }
      const consumed = Number(sum ?? 0);
      await admin
        .from("campaigns")
        .update({ budget_consumed_inr: consumed })
        .eq("id", c.id);

      if (c.budget_cap_inr && consumed >= c.budget_cap_inr) {
        await admin.from("campaigns").update({ status: "paused" }).eq("id", c.id);
        logger.warn({ campaignId: c.id }, "Campaign hard-stopped on budget");
      } else if (c.budget_cap_inr && consumed >= 0.8 * c.budget_cap_inr) {
        logger.info({ campaignId: c.id }, "Campaign at 80% of budget");
      }
    }
    return { ok: true };
  },
);

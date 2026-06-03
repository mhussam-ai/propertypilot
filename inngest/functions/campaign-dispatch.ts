import { inngest } from "@/inngest/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { newTraceId } from "@/lib/middleware/trace-id";
import { logger } from "@/lib/logger";

/**
 * campaign.dispatch: scan active campaigns, pick N leads respecting daily cap + DNC + cost cap,
 * enqueue call.start events. Time-of-day windowing is delegated to Bolna's calling_guardrails
 * on the agent, so this function does NOT check hour-of-day.
 *
 * Runs every 60 seconds via Inngest cron.
 */
export const campaignDispatch = inngest.createFunction(
  { id: "campaign.dispatch", name: "Dispatch active campaigns" },
  { cron: "* * * * *" },
  async ({ step }) => {
    const admin = createSupabaseAdminClient();

    const campaigns = await step.run("active-campaigns", async () => {
      const { data } = await admin
        .from("campaigns")
        .select(
          "id, tenant_id, property_id, daily_cap, budget_cap_inr, budget_consumed_inr, prompt_version",
        )
        .eq("status", "active");
      return data ?? [];
    });

    if (campaigns.length === 0) return { ok: true, dispatched: 0 };

    let totalDispatched = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const campaign of campaigns) {
      const remainingBudget =
        campaign.budget_cap_inr != null
          ? campaign.budget_cap_inr - Number(campaign.budget_consumed_inr ?? 0)
          : Infinity;
      if (remainingBudget <= 0) {
        logger.info({ campaignId: campaign.id }, "Campaign hard-stopped on budget");
        await admin.from("campaigns").update({ status: "paused" }).eq("id", campaign.id);
        continue;
      }

      const dispatchedToday = await step.run(`count-today-${campaign.id}`, async () => {
        const { count } = await admin
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .gte("created_at", today.toISOString());
        return count ?? 0;
      });
      const remainingToday = Math.max(0, campaign.daily_cap - dispatchedToday);
      if (remainingToday === 0) continue;

      // Pick N new leads for this campaign respecting DNC.
      // Only pick 'new' — once dispatched they move to 'queued', then 'dialing' when call-start runs.
      const batchSize = Math.min(remainingToday, 25);
      const leads = await step.run(`pick-leads-${campaign.id}`, async () => {
        const { data } = await admin
          .from("leads")
          .select("id, tenant_id")
          .eq("campaign_id", campaign.id)
          .eq("status", "new")
          .eq("dnc", false)
          .limit(batchSize);
        return data ?? [];
      });

      if (leads.length === 0) {
        // No new leads left — check if all leads are in terminal states.
        // If so, auto-complete the campaign.
        const { count: inFlightCount } = await admin
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .in("status", ["queued", "dialing"]);

        if ((inFlightCount ?? 0) === 0) {
          // All leads are terminal (contacted, exhausted, visit_booked, dnc, etc.)
          const { count: totalLeads } = await admin
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", campaign.id);

          if ((totalLeads ?? 0) > 0) {
            await admin.from("campaigns").update({ status: "completed" }).eq("id", campaign.id);
            logger.info({ campaignId: campaign.id }, "Campaign auto-completed — all leads processed");
          }
        }
        continue;
      }

      // Enqueue call.start for each lead. Inngest fan-out is cheap; no need to batch internally.
      for (const lead of leads) {
        await step.sendEvent("start-call", {
          name: "call.start",
          data: {
            tenantId: campaign.tenant_id,
            leadId: lead.id,
            campaignId: campaign.id,
            propertyId: campaign.property_id,
            promptVersion: campaign.prompt_version,
            traceId: newTraceId(),
          },
        });
      }

      // Atomically mark dispatched leads as 'queued' so they won't be picked again.
      await admin
        .from("leads")
        .update({ status: "queued" })
        .in("id", leads.map((l) => l.id));

      totalDispatched += leads.length;
      logger.info(
        { campaignId: campaign.id, dispatched: leads.length },
        "campaign.dispatch enqueued",
      );
    }

    return { ok: true, dispatched: totalDispatched };
  },
);

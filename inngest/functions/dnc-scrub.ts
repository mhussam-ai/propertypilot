import { inngest } from "@/inngest/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * dnc.scrub: nightly cross-check of leads against dnc_list. Flip dnc=true on matches.
 */
export const dncScrub = inngest.createFunction(
  { id: "dnc.scrub", name: "Scrub leads against DNC list" },
  { cron: "TZ=Asia/Kolkata 0 3 * * *" },
  async ({ step }) => {
    const admin = createSupabaseAdminClient();

    const tenants = await step.run("list-tenants", async () => {
      const { data } = await admin.from("tenants").select("id");
      return data ?? [];
    });

    let scrubbed = 0;
    for (const tenant of tenants) {
      const { data: dncRows } = await admin
        .from("dnc_list")
        .select("phone_e164")
        .eq("tenant_id", tenant.id);
      const dncPhones = (dncRows ?? []).map((r) => r.phone_e164);
      if (dncPhones.length === 0) continue;

      const { data: matches } = await admin
        .from("leads")
        .update({ dnc: true, status: "dnc" })
        .eq("tenant_id", tenant.id)
        .in("phone_e164", dncPhones)
        .select("id");
      scrubbed += matches?.length ?? 0;
    }

    logger.info({ scrubbed }, "dnc.scrub completed");
    return { ok: true, scrubbed };
  },
);

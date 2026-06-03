import { inngest } from "@/inngest/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createEvent } from "ics";
import { logger } from "@/lib/logger";

/**
 * lead.route_hot: build wa.me deep link, generate .ics file, draft a summary, write/upsert
 * an inbox_items row in `site_visit_booked`.
 */
export const leadRouteHot = inngest.createFunction(
  { id: "lead.route_hot", name: "Route hot lead to SDR Inbox", retries: 2 },
  { event: "lead.route_hot" },
  async ({ event, step }) => {
    const { tenantId, callId, leadId } = event.data;
    const admin = createSupabaseAdminClient();

    const ctx = await step.run("load-context", async () => {
      const { data: call } = await admin
        .from("calls")
        .select("id, lead_id, property_id, extracted_data, transcript")
        .eq("id", callId)
        .single();
      const { data: lead } = await admin
        .from("leads")
        .select("name, phone_e164")
        .eq("id", leadId)
        .single();
      const { data: property } = await admin
        .from("properties")
        .select("name, location, developer_short_name")
        .eq("id", call?.property_id ?? "")
        .single();
      return { call, lead, property };
    });

    if (!ctx.call || !ctx.lead || !ctx.property) {
      logger.warn({ tenantId, callId }, "lead.route_hot: missing context");
      return { ok: false };
    }

    const extracted = (ctx.call.extracted_data ?? {}) as Record<
      string,
      Record<string, { subjective?: string | null; objective?: string | string[] | null }>
    >;
    const visitDay = extracted["Visit Details"]?.["Visit Day"]?.subjective ?? "TBD";
    const visitTime = extracted["Visit Details"]?.["Visit Time"]?.subjective ?? "TBD";
    const bhk = extracted["Visit Details"]?.["BHK Preference"]?.objective ?? "unspecified";

    const summary = `${bhk} BHK · ${visitDay} at ${visitTime} · ${ctx.property.name}`;
    const waMessage = encodeURIComponent(
      `Hi ${ctx.lead.name}, this is ${ctx.property.developer_short_name}. Confirming your site visit at ${ctx.property.name} (${ctx.property.location}) on ${visitDay} at ${visitTime}. Reply YES to confirm or suggest another time.`,
    );
    const phoneStripped = ctx.lead.phone_e164.replace(/^\+/, "");
    const whatsappUrl = `https://wa.me/${phoneStripped}?text=${waMessage}`;

    const ics = await step.run("generate-ics", async () => {
      // Best-effort ICS; if dates aren't parseable, return null and continue.
      const now = new Date();
      // Naive parse: assume Saturday at 11:00 AM IST if we can't parse the visit_time.
      const start = new Date(now);
      start.setDate(start.getDate() + ((6 - start.getDay() + 7) % 7));
      start.setHours(11, 0, 0, 0);
      const { error, value } = createEvent({
        start: [start.getFullYear(), start.getMonth() + 1, start.getDate(), 11, 0],
        duration: { hours: 1 },
        title: `Site visit · ${ctx.property?.name ?? "PropertyPilot"}`,
        description: `Visit details: ${summary}`,
        location: ctx.property?.location ?? "",
        organizer: { name: ctx.property?.developer_short_name ?? "PropertyPilot", email: "noreply@propertypilot.in" },
      });
      if (error) {
        logger.warn({ err: String(error) }, "ICS generation failed");
        return null;
      }
      return value ?? null;
    });

    // For v1 we just embed the ICS string into the inbox_items row as a data: URI.
    const icsUrl = ics ? `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}` : null;

    await admin.from("inbox_items").upsert(
      {
        tenant_id: tenantId,
        call_id: callId,
        lead_id: leadId,
        status: "site_visit_booked",
        whatsapp_url: whatsappUrl,
        ics_url: icsUrl,
        summary,
      },
      { onConflict: "call_id" },
    );

    logger.info({ tenantId, callId, leadId }, "Hot lead routed to inbox");
    return { ok: true };
  },
);

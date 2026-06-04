"use server";

import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/tenant/context";
import { LeadCsvRowSchema, extractCustomVars } from "@/lib/schema/lead-csv";
import { logger } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";

type LeadInsert = Database["public"]["Tables"]["leads"]["Insert"];

export interface UploadLeadsResult {
  ok: boolean;
  accepted: number;
  duplicates: number;
  rejected: Array<{ rowIndex: number; reason: string }>;
  error?: string;
}

const KNOWN_PHONE_COLS = ["contact_number", "phone", "mobile", "phone_number", "phone_e164"];
const KNOWN_NAME_COLS = ["name", "first_name", "full_name", "caller_name"];

/**
 * Parse a CSV text body and upsert leads for a given property. Returns a per-row breakdown
 * so the UI can show what was accepted vs rejected.
 *
 * CSV expectations (we're lenient):
 *   - Some column resolving to a phone number (contact_number/phone/mobile/...)
 *   - Some column resolving to a name (name/first_name/...)
 *   - Optional language_hint, source
 *   - All other columns preserved as custom_vars JSONB and passed to Bolna as user_data
 */
export async function uploadLeads(input: { campaign_id: string; csv_text: string }): Promise<UploadLeadsResult> {
  const tenant = await getTenantContext();
  if (!tenant) {
    return { ok: false, accepted: 0, duplicates: 0, rejected: [], error: "unauthenticated" };
  }

  const admin = createSupabaseAdminClient();

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, tenant_id, property_id")
    .eq("id", input.campaign_id)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle();
  if (!campaign) {
    return { ok: false, accepted: 0, duplicates: 0, rejected: [], error: "campaign_not_found" };
  }

  const parsed = Papa.parse<Record<string, string>>(input.csv_text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (parsed.errors.length > 0) {
    return {
      ok: false,
      accepted: 0,
      duplicates: 0,
      rejected: [],
      error: `CSV parse errors: ${parsed.errors.map((e) => e.message).join("; ")}`,
    };
  }

  const rows = parsed.data ?? [];
  const upserts: LeadInsert[] = [];
  const rejected: Array<{ rowIndex: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? {};
    const phoneRaw = KNOWN_PHONE_COLS.map((c) => row[c]).find(Boolean);
    const nameRaw = KNOWN_NAME_COLS.map((c) => row[c]).find(Boolean) ?? "Unknown";
    if (!phoneRaw) {
      rejected.push({ rowIndex: i + 2, reason: "no phone column found" });
      continue;
    }
    const phone = parsePhoneNumberFromString(phoneRaw, "IN");
    if (!phone || !phone.isValid()) {
      rejected.push({ rowIndex: i + 2, reason: `invalid phone: ${phoneRaw}` });
      continue;
    }
    // Validate via Zod to enforce language_hint enum.
    const validated = LeadCsvRowSchema.safeParse({
      name: nameRaw,
      contact_number: phoneRaw,
      source: row.source ?? "csv_upload",
      language_hint: row.language_hint ?? "en",
      ...row,
    });
    if (!validated.success) {
      rejected.push({
        rowIndex: i + 2,
        reason: validated.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
      });
      continue;
    }
    upserts.push({
      tenant_id: tenant.tenantId,
      property_id: campaign.property_id,
      campaign_id: campaign.id,
      name: validated.data.name,
      phone_e164: phone.number,
      source: validated.data.source ?? "csv_upload",
      language_hint: validated.data.language_hint ?? "en",
      custom_vars: extractCustomVars(validated.data),
    });
  }

  let accepted = 0;
  let duplicates = 0;
  if (upserts.length > 0) {
    // We want to know whether each row was an insert or a noop (existing). Use the
    // returning clause + a pre-count to compute duplicates.
    const { data: existing } = await admin
      .from("leads")
      .select("phone_e164")
      .eq("campaign_id", campaign.id)
      .in("phone_e164", upserts.map((r) => r.phone_e164 as string));
    const existingSet = new Set((existing ?? []).map((r) => r.phone_e164 as string));
    duplicates = upserts.filter((r) => existingSet.has(r.phone_e164 as string)).length;

    const { error } = await admin
      .from("leads")
      .upsert(upserts, { onConflict: "campaign_id,phone_e164" });
    if (error) {
      logger.error({ err: error.message }, "upload-leads upsert failed");
      return {
        ok: false,
        accepted: 0,
        duplicates: 0,
        rejected,
        error: `Persist failed: ${error.message}`,
      };
    }
    accepted = upserts.length - duplicates;
  }

  revalidatePath("/app/leads");
  return { ok: true, accepted, duplicates, rejected };
}

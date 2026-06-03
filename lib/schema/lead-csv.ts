import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Languages we support voice routing for in v1. */
export const SupportedLanguage = z.enum([
  "en",
  "hi",
  "mr",
  "gu",
  "ta",
  "te",
  "kn",
  "ml",
  "bn",
  "pa",
]);
export type SupportedLanguageT = z.infer<typeof SupportedLanguage>;

const e164 = z
  .string()
  .min(8)
  .max(20)
  .transform((s, ctx) => {
    const pn = parsePhoneNumberFromString(s, "IN");
    if (!pn || !pn.isValid()) {
      ctx.addIssue({ code: "custom", message: "Not a valid phone number" });
      return z.NEVER;
    }
    return pn.number; // E.164
  });

export const LeadCsvRowSchema = z
  .object({
    name: z.string().min(1).max(120),
    contact_number: e164,
    source: z.string().max(80).default("csv_upload"),
    language_hint: SupportedLanguage.optional().default("en"),
  })
  .passthrough(); // preserve arbitrary custom_vars columns
export type LeadCsvRowT = z.infer<typeof LeadCsvRowSchema>;

export interface LeadCsvParseResult {
  valid: LeadCsvRowT[];
  invalid: Array<{ rowIndex: number; raw: Record<string, unknown>; errors: string[] }>;
  totalRows: number;
}

/** Strip known columns and keep the rest as custom_vars passed to Bolna user_data. */
export function extractCustomVars(row: LeadCsvRowT): Record<string, string> {
  const KNOWN = new Set(["name", "contact_number", "source", "language_hint"]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (KNOWN.has(k)) continue;
    if (v == null) continue;
    out[k] = String(v);
  }
  return out;
}

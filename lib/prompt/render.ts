import fs from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import type { PropertyFormT } from "@/lib/schema/property-form";
import { formatINR } from "@/lib/utils";

/**
 * Two-stage prompt rendering for PropertyPilot agents:
 *
 *   Stage 1 (build-time, here) — Handlebars `{{var}}` substitution of property-level fields.
 *     Output is stored in agent_prompts.template_text and registered with Bolna once.
 *
 *   Stage 2 (call-time, Bolna) — single-brace `{var}` substitution from POST /call user_data,
 *     including default vars Bolna injects: agent_id, execution_id, call_sid, from_number,
 *     to_number, current_date, current_time, timezone.
 */

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  mr: "Marathi",
  gu: "Gujarati",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  bn: "Bengali",
  pa: "Punjabi",
};

export interface PropertyTemplateContext {
  property_name: string;
  rera: string;
  location: string;
  bhk_list: string;
  amenities_list: string;
  usp_lines: string[];
  price_band_text: string;
  visit_hours_text: string;
  supported_languages_list: string;
  primary_language_name: string;
  disallowed_bhk_pivot: string;
  agent_persona_name: string;
  agent_role: string;
  developer_short_name: string;
}

export interface BuildContextInput {
  property: PropertyFormT;
  developerShortName: string;
  agentPersonaName?: string;
  agentRole?: string;
}

/** Project a PropertyFormT row into a fully-resolved template context. */
export function buildContextForProperty(input: BuildContextInput): PropertyTemplateContext {
  const { property, developerShortName } = input;
  const primary = property.supported_languages[0] ?? "en";
  const visitHrs = property.visit_hours;
  const start12 = formatHour12(visitHrs.start_hour);
  const end12 = formatHour12(visitHrs.end_hour);
  return {
    property_name: property.name,
    rera: property.rera,
    location: property.location,
    bhk_list: property.bhk_configs.map((c) => `${c.bhk} BHK`).join(", "),
    amenities_list: property.amenities.join(", "),
    usp_lines: property.usp_lines,
    price_band_text: `${formatINR(property.price_band.min_inr)} – ${formatINR(property.price_band.max_inr)}`,
    visit_hours_text: `${start12} to ${end12} IST, every day`,
    supported_languages_list: property.supported_languages
      .map((c) => LANGUAGE_NAMES[c] ?? c)
      .join(", "),
    primary_language_name: LANGUAGE_NAMES[primary] ?? primary,
    disallowed_bhk_pivot: deriveDisallowedBhkPivot(property.bhk_configs.map((c) => c.bhk)),
    agent_persona_name: input.agentPersonaName ?? "Priya",
    agent_role: input.agentRole ?? "real-estate associate",
    developer_short_name: developerShortName,
  };
}

function formatHour12(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour} ${period}`;
}

function deriveDisallowedBhkPivot(offered: string[]): string {
  const standard = ["1", "2", "2.5", "3", "3.5", "4", "5"];
  const missing = standard.filter((s) => !offered.includes(s));
  if (missing.length === 0) return "none";
  return missing.map((m) => `${m} BHK`).join(" or ");
}

/* ---------- Template loading + rendering ---------- */

// Module-level Handlebars instance with strict mode so missing vars throw.
const HBS_INSTANCE = Handlebars.create();
HBS_INSTANCE.registerHelper("eq", (a: unknown, b: unknown) => a === b);

const templateCache = new Map<string, HandlebarsTemplateDelegate>();

const TEMPLATES_DIR = path.join(process.cwd(), "prompts", "templates");

export async function loadTemplate(name: string): Promise<HandlebarsTemplateDelegate> {
  const cached = templateCache.get(name);
  if (cached) return cached;
  const filePath = path.join(TEMPLATES_DIR, name);
  const src = await fs.readFile(filePath, "utf8");
  const tmpl = HBS_INSTANCE.compile(src, { strict: true, noEscape: true });
  templateCache.set(name, tmpl);
  return tmpl;
}

export async function renderPropertyPrompt(
  templateName: string,
  ctx: PropertyTemplateContext,
): Promise<string> {
  const tmpl = await loadTemplate(templateName);
  return tmpl(ctx);
}

/** Default site-visit-booking template. */
export const SITE_VISIT_TEMPLATE = "site_visit_booking.v1.hbs";

/* ---------- Per-call user_data builder ---------- */

export interface BuildUserDataInput {
  caller_name: string;
  language_hint: string;
  lead_source: string;
  custom_vars?: Record<string, string>;
  timezone?: string;
}

export function buildUserData(input: BuildUserDataInput): Record<string, string> {
  return {
    caller_name: input.caller_name,
    language_hint: input.language_hint,
    lead_source: input.lead_source,
    timezone: input.timezone ?? "Asia/Kolkata",
    ...(input.custom_vars ?? {}),
  };
}

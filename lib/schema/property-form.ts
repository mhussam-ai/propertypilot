import { z } from "zod";
import { SupportedLanguage } from "./lead-csv";

export const BhkConfigSchema = z.object({
  bhk: z.string().min(1), // "2", "2.5", "3", "4+"
  carpet_area_sqft: z.number().int().positive().optional(),
  price_inr: z.number().int().positive().optional(),
});

export const PriceBandSchema = z.object({
  min_inr: z.number().int().positive(),
  max_inr: z.number().int().positive(),
});

export const VisitHoursSchema = z.object({
  /** 0-23 in IST. Bolna enforces this in the recipient's timezone via calling_guardrails. */
  start_hour: z.number().int().min(0).max(23),
  end_hour: z.number().int().min(0).max(23),
  /** Days of week, 0=Sun..6=Sat */
  days: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
});

export const PropertyFormSchema = z.object({
  name: z.string().min(2).max(120),
  rera: z.string().regex(/^[A-Z0-9/-]{8,32}$/i, "Invalid RERA format"),
  location: z.string().min(2).max(200),
  bhk_configs: z.array(BhkConfigSchema).min(1).max(8),
  amenities: z.array(z.string().min(1)).default([]),
  usp_lines: z.array(z.string().min(1)).max(8).default([]),
  price_band: PriceBandSchema,
  visit_hours: VisitHoursSchema,
  supported_languages: z.array(SupportedLanguage).min(1),
  default_voice_id: z.string().min(1),
  language_voice_overrides: z.record(SupportedLanguage, z.string().min(1)).default({}),
  daily_call_cap: z.number().int().positive().max(10_000).default(500),
  retry_policy: z
    .object({
      max_retries: z.number().int().min(1).max(3).default(3),
      retry_intervals_minutes: z.array(z.number().int().positive()).default([30, 60, 120]),
      retry_on_voicemail: z.boolean().default(false),
    })
    .default({}),
});
export type PropertyFormT = z.infer<typeof PropertyFormSchema>;

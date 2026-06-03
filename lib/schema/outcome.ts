import { z } from "zod";

/**
 * Bolna's `extracted_data` payload shape (Mar 2026 Dispositions API + Apr 2026 confidence/reasoning).
 *
 * Source: bolna-llms-full.txt §"Bolna AI Updates for April, 2026" — 14th April entry shows the
 * augmented shape with confidence / confidence_label / reasoning_subjective / validation.
 *
 *   extracted_data: {
 *     "Category Name": {
 *       "Disposition Name": {
 *         subjective: string|null,
 *         objective: string|string[]|null,
 *         confidence: 0.0-1.0,
 *         confidence_label: "High"|"Medium"|"Low",
 *         reasoning_subjective?: string,
 *         reasoning_objective?: string,
 *         validation?: { is_valid: boolean, expected_type: string }
 *       }
 *     }
 *   }
 */

export const ConfidenceLabel = z.enum(["High", "Medium", "Low"]);
export type ConfidenceLabel = z.infer<typeof ConfidenceLabel>;

export const ValidationResult = z.object({
  is_valid: z.boolean(),
  expected_type: z.string(),
});

export const DispositionResultSchema = z.object({
  subjective: z.string().nullable(),
  objective: z.union([z.string(), z.array(z.string())]).nullable(),
  confidence: z.number().min(0).max(1),
  confidence_label: ConfidenceLabel,
  reasoning_subjective: z.string().optional(),
  reasoning_objective: z.string().optional(),
  validation: ValidationResult.optional(),
});
export type DispositionResult = z.infer<typeof DispositionResultSchema>;

export const ExtractedDataSchema = z.record(
  z.string(),
  z.record(z.string(), DispositionResultSchema),
);
export type ExtractedDataT = z.infer<typeof ExtractedDataSchema>;

/* ---------- Bolna webhook payload (call status update) ---------- */

export const BolnaCallStatus = z.enum([
  "scheduled",
  "queued",
  "initiated",
  "dialing",
  "in-progress",
  "completed",
  "failed",
  "no-answer",
  "busy",
  "voicemail",
  "rescheduled",
  "error",
]);
export type BolnaCallStatusT = z.infer<typeof BolnaCallStatus>;

export const RetryHistorySchema = z.array(
  z.object({
    attempt: z.number().int(),
    status: z.string(),
    at: z.string(),
  }),
);

export const WebhookPayloadSchema = z
  .object({
    id: z.string(), // execution_id
    agent_id: z.string(),
    status: BolnaCallStatus,
    conversation_time: z.number().optional().nullable(),
    cost: z.number().optional().nullable(),
    recording_url: z.string().url().nullable().optional(),
    transcript: z.string().nullable().optional(),
    hangup_reason: z.string().nullable().optional(),
    answered_by_voice_mail: z.boolean().nullable().optional(),
    to_number: z.string().optional(),
    from_number: z.string().optional(),
    telephony_provider: z.string().optional(),
    to_number_carrier: z.string().optional(),
    user_data: z.record(z.unknown()).optional().nullable(),
    extracted_data: ExtractedDataSchema.optional().nullable(),
    retry_count: z.number().int().nullable().optional(),
    retry_history: RetryHistorySchema.optional(),
    scheduled_at: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough(); // tolerate forward-compatible extra fields
export type WebhookPayloadT = z.infer<typeof WebhookPayloadSchema>;

/* ---------- Helpers ---------- */

/** Lookup a specific disposition result by category + name with full type safety. */
export function getDispositionResult(
  data: ExtractedDataT | null | undefined,
  category: string,
  name: string,
): DispositionResult | undefined {
  return data?.[category]?.[name];
}

/**
 * The dispositions that, if Low-confidence, must be routed to a human reviewer in the
 * Inbox Kanban's "Manual Review" column. Tuned for site-visit-booking.
 */
export const CRITICAL_DISPOSITIONS: ReadonlyArray<{ category: string; name: string }> = [
  { category: "Lead Quality", name: "Call Outcome" },
  { category: "Visit Details", name: "Visit Promised" },
  { category: "Conversation", name: "Needs Human" },
];

export function needsHumanReview(data: ExtractedDataT | null | undefined): boolean {
  if (!data) return false;
  for (const { category, name } of CRITICAL_DISPOSITIONS) {
    const r = getDispositionResult(data, category, name);
    if (r?.confidence_label === "Low") return true;
  }
  // Explicit signal from the agent itself.
  const explicit = getDispositionResult(data, "Conversation", "Needs Human");
  if (explicit?.objective === "true" || explicit?.subjective?.toLowerCase() === "true") return true;
  return false;
}

export function isVisitPromised(data: ExtractedDataT | null | undefined): boolean {
  const r = getDispositionResult(data, "Visit Details", "Visit Promised");
  if (!r) return false;
  if (r.objective === "true") return true;
  if (r.subjective?.toLowerCase() === "true") return true;
  return false;
}

export function detectedLanguage(data: ExtractedDataT | null | undefined): string | null {
  const r = getDispositionResult(data, "Conversation", "Language Detected");
  return r?.subjective ?? (Array.isArray(r?.objective) ? r?.objective[0] ?? null : (r?.objective as string | null) ?? null);
}

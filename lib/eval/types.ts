import type { ExtractedDataT } from "@/lib/schema/outcome";

/**
 * Scenario labels for golden eval cases. Each tag maps to a row in
 * docs/FAILURE_MODES.md so the corpus is a living regression guard for the
 * failure modes we've reasoned about — not an abstract accuracy number.
 */
export const KNOWN_TAGS = [
  "english-happy",
  "hindi",
  "code-switch",
  "accent-garbled",
  "false-booking-attempt",
  "dnc-request",
  "voicemail",
  "not-interested",
  "wrong-person",
  "low-confidence",
  "needs-human",
] as const;

export type GoldenTag = (typeof KNOWN_TAGS)[number];

/**
 * One labelled evaluation case: a transcript + the disposition extraction we
 * expect Bolna's post-call LLM to produce. `expected` is exactly the
 * `extracted_data` shape (see lib/schema/outcome.ts) so the scorer can compare
 * apples to apples against a live `dispositions/test` response.
 */
export interface GoldenCase {
  id: string;
  description: string;
  tags: GoldenTag[];
  transcript: string;
  user_data?: Record<string, string>;
  expected: ExtractedDataT;
}

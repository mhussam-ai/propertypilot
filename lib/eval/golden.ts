/**
 * Golden-corpus loader + validator. Node-only (uses fs) — imported by the eval
 * test and scripts/eval-live.ts, never by the Next app runtime. Kept separate
 * from scorer.ts so the scorer stays pure and bundle-safe.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ExtractedDataSchema } from "@/lib/schema/outcome";
import { KNOWN_TAGS, type GoldenCase } from "./types";

export const GoldenCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.enum(KNOWN_TAGS)).min(1),
  transcript: z.string().min(20),
  user_data: z.record(z.string()).optional(),
  expected: ExtractedDataSchema,
});

export const DEFAULT_GOLDEN_DIR = path.resolve(process.cwd(), "tests/eval/golden");

/**
 * Read and validate every *.json golden case in `dir`. Throws with the offending
 * filename if any case is malformed — a malformed label would silently corrupt
 * the scores, so we fail loud.
 */
export function loadGoldenCases(dir: string = DEFAULT_GOLDEN_DIR): GoldenCase[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  return files.map((file) => {
    const raw = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as unknown;
    const parsed = GoldenCaseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid golden case ${file}: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

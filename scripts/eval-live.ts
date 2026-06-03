/**
 * Live AI-quality eval — runs the golden corpus through a real Bolna agent's
 * post-call disposition extraction and scores it against ground truth.
 *
 * This is the half of the evaluation pipeline that needs credentials, so it is
 * opt-in (local / demo) and NOT wired into CI. The offline scorer + golden-corpus
 * validity run in CI via `pnpm test` (tests/eval/scorer.test.ts).
 *
 * Run via:
 *   BOLNA_PLATFORM_API_KEY=... EVAL_AGENT_ID=agt_... pnpm eval
 *   pnpm eval --agent=agt_...        # override the agent id
 *
 * Exits non-zero if DEFAULT_THRESHOLDS are breached (critical-field accuracy,
 * false-booking rate, missed-review rate, calibration) — so it can gate a demo
 * branch if you choose to wire it up.
 */
import { writeFileSync } from "node:fs";
import { BolnaClient } from "@/lib/bolna/client";
import { ExtractedDataSchema } from "@/lib/schema/outcome";
import { loadGoldenCases } from "@/lib/eval/golden";
import {
  scoreExecution,
  scoreCorpus,
  evaluateThresholds,
  type ExecutionScore,
} from "@/lib/eval/scorer";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const args = parseArgs();
  const apiKey = process.env.BOLNA_PLATFORM_API_KEY;
  const agentId = args.agent ?? process.env.EVAL_AGENT_ID;

  if (!apiKey || !agentId) {
    console.log(
      "⏭  Live eval skipped — set BOLNA_PLATFORM_API_KEY and EVAL_AGENT_ID (or pass --agent=) to run.\n" +
        "   The offline scorer + golden-corpus validity already run in CI via `pnpm test`.",
    );
    process.exit(0);
  }

  const cases = loadGoldenCases();
  const client = new BolnaClient({ apiKey, breakerPrefix: "eval" });
  console.log(`Running ${cases.length} golden cases against agent ${agentId}…\n`);

  const scores: ExecutionScore[] = [];
  for (const c of cases) {
    try {
      const res = await client.testAgentDispositions(agentId, { transcript: c.transcript, user_data: c.user_data });
      const parsed = ExtractedDataSchema.safeParse(res.extracted_data);
      if (!parsed.success) {
        console.error(`✗ ${c.id}: response failed schema validation — ${parsed.error.message}`);
        continue;
      }
      const score = scoreExecution(c.expected, parsed.data, c.id);
      scores.push(score);
      const flag = score.falseBooking ? " ⚠ FALSE BOOKING" : "";
      console.log(`✓ ${c.id.padEnd(24)} dispositions ${pct(score.dispositionAccuracy)}  critical ${pct(score.criticalAccuracy)}${flag}`);
    } catch (err) {
      console.error(`✗ ${c.id}: ${(err as Error).message}`);
    }
  }

  if (scores.length === 0) {
    console.error("\nNo cases scored — aborting.");
    process.exit(1);
  }

  const corpus = scoreCorpus(scores);
  console.log("\n── Corpus ─────────────────────────────────────");
  console.log(`cases scored            ${scores.length}/${cases.length}`);
  console.log(`disposition accuracy    ${pct(corpus.dispositionAccuracy)}`);
  console.log(`critical-field accuracy ${pct(corpus.criticalAccuracy)}`);
  console.log(`visit-promised accuracy ${pct(corpus.visitPromisedAccuracy)}`);
  console.log(`needs-human accuracy    ${pct(corpus.needsHumanReviewAccuracy)}`);
  console.log(`language accuracy       ${pct(corpus.languageAccuracy)}`);
  console.log(`false-booking rate      ${pct(corpus.falseBookingRate)}`);
  console.log(`missed-review rate      ${pct(corpus.missedReviewRate)}`);
  console.log(`mean calibration error  ${corpus.meanCalibrationError.toFixed(3)}`);
  console.log("\nper-disposition:");
  for (const [name, b] of Object.entries(corpus.perDisposition)) {
    console.log(`  ${name.padEnd(34)} ${pct(b.accuracy)}  (${b.matched}/${b.total})`);
  }

  const report = evaluateThresholds(corpus);
  const out = { generatedAt: new Date().toISOString(), agentId, corpus, thresholds: report };
  writeFileSync("eval-report.json", JSON.stringify(out, null, 2));
  console.log("\nWrote eval-report.json");

  if (!report.passed) {
    console.error(`\n❌ Thresholds breached:\n  - ${report.failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("\n✅ All thresholds passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

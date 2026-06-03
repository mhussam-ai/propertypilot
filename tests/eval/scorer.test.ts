import { describe, it, expect } from "vitest";
import { loadGoldenCases } from "@/lib/eval/golden";
import {
  scoreDisposition,
  scoreExecution,
  scoreCorpus,
  evaluateThresholds,
} from "@/lib/eval/scorer";
import { isVisitPromised, needsHumanReview, detectedLanguage, type ExtractedDataT } from "@/lib/schema/outcome";
import type { GoldenCase } from "@/lib/eval/types";

const cases = loadGoldenCases();
const byId = new Map(cases.map((c) => [c.id, c]));
const get = (id: string): GoldenCase => {
  const c = byId.get(id);
  if (!c) throw new Error(`missing golden case ${id}`);
  return c;
};
const clone = (d: ExtractedDataT): ExtractedDataT => JSON.parse(JSON.stringify(d));

describe("golden corpus validity", () => {
  it("loads at least 10 cases (loader throws on any malformed label)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it("covers the key failure-mode scenarios by id", () => {
    for (const id of [
      "english-happy",
      "hindi",
      "code-switch",
      "accent-garbled",
      "false-booking-attempt",
      "dnc-request",
      "voicemail",
      "wrong-person",
      "needs-human-explicit",
    ]) {
      expect(byId.has(id)).toBe(true);
    }
  });

  it("self-scores to 100% with zero false bookings (guards against malformed golden labels)", () => {
    const self = cases.map((c) => scoreExecution(c.expected, c.expected, c.id));
    for (const s of self) {
      expect(s.dispositionAccuracy).toBe(1);
      expect(s.criticalAccuracy).toBe(1);
      expect(s.falseBooking).toBe(false);
      expect(s.missedReview).toBe(false);
    }
    const corpus = scoreCorpus(self);
    expect(corpus.falseBookingRate).toBe(0);
    expect(corpus.criticalAccuracy).toBe(1);
    expect(evaluateThresholds(corpus).passed).toBe(true);
  });
});

describe("golden labels encode the failure-mode invariants", () => {
  it("books only the genuine-commitment cases", () => {
    expect(isVisitPromised(get("english-happy").expected)).toBe(true);
    expect(isVisitPromised(get("hindi").expected)).toBe(true);
    expect(isVisitPromised(get("code-switch").expected)).toBe(true);
    for (const id of ["false-booking-attempt", "dnc-request", "not-interested", "voicemail", "wrong-person"]) {
      expect(isVisitPromised(get(id).expected)).toBe(false);
    }
  });

  it("routes both low-confidence and explicit-signal cases to human review", () => {
    expect(needsHumanReview(get("accent-garbled").expected)).toBe(true); // low-confidence path
    expect(needsHumanReview(get("needs-human-explicit").expected)).toBe(true); // explicit path
    expect(needsHumanReview(get("english-happy").expected)).toBe(false);
  });

  it("resolves the detected language even across a code-switch", () => {
    expect(detectedLanguage(get("hindi").expected)).toBe("hi");
    expect(detectedLanguage(get("code-switch").expected)).toBe("mr");
  });
});

describe("scoreDisposition dimensions", () => {
  const high = (over: Record<string, unknown>) => ({ subjective: null, objective: null, confidence: 0.9, confidence_label: "High" as const, ...over });

  it("fails on objective mismatch", () => {
    const s = scoreDisposition("Lead Quality", "Call Outcome", high({ objective: "interested" }), high({ objective: "not_interested" }));
    expect(s.objectiveMatch).toBe(false);
    expect(s.matched).toBe(false);
  });

  it("scores free-text subjective on presence, not exact wording", () => {
    const s = scoreDisposition("Lead Quality", "Call Outcome", high({ subjective: "Agreed to a Saturday visit" }), high({ subjective: "Customer said yes for the weekend" }));
    expect(s.subjectiveMatch).toBe(true);
    expect(s.matched).toBe(true);
  });

  it("scores numeric subjective on normalized equality", () => {
    const exp = high({ subjective: "18000000", validation: { is_valid: true, expected_type: "numeric" } });
    expect(scoreDisposition("Visit Details", "Budget INR", exp, high({ subjective: "18000000", validation: { is_valid: true, expected_type: "numeric" } })).matched).toBe(true);
    expect(scoreDisposition("Visit Details", "Budget INR", exp, high({ subjective: "9000000", validation: { is_valid: true, expected_type: "numeric" } })).matched).toBe(false);
  });

  it("marks an omitted disposition as not present and not matched", () => {
    const s = scoreDisposition("Visit Details", "Visit Promised", high({ objective: "true" }), undefined);
    expect(s.present).toBe(false);
    expect(s.matched).toBe(false);
    expect(s.calibrationError).toBeNull();
  });
});

describe("safety + calibration metrics fire on wrong predictions", () => {
  it("flags a hallucinated booking and penalizes the confident-wrong answer", () => {
    const golden = get("false-booking-attempt");
    const actual = clone(golden.expected);
    // Agent confidently (and wrongly) claims a booking that never happened.
    actual["Visit Details"]["Visit Promised"] = { subjective: "true", objective: "true", confidence: 0.95, confidence_label: "High" };

    const score = scoreExecution(golden.expected, actual, golden.id);
    expect(score.falseBooking).toBe(true);
    expect(score.derived.visitPromised.correct).toBe(false);

    const vp = score.dispositions.find((d) => d.name === "Visit Promised")!;
    expect(vp.matched).toBe(false);
    expect(vp.calibrationError).toBeGreaterThan(0.9); // |0.95 − 0|
  });

  it("flags a missed human-review routing", () => {
    const golden = get("needs-human-explicit");
    const actual = clone(golden.expected);
    actual["Conversation"]["Needs Human"] = { subjective: "false", objective: "false", confidence: 0.8, confidence_label: "High" };

    const score = scoreExecution(golden.expected, actual, golden.id);
    expect(score.missedReview).toBe(true);
  });

  it("a corpus with a false booking fails the default thresholds", () => {
    const golden = get("dnc-request");
    const actual = clone(golden.expected);
    actual["Visit Details"]["Visit Promised"] = { subjective: "true", objective: "true", confidence: 0.9, confidence_label: "High" };
    const report = evaluateThresholds(scoreCorpus([scoreExecution(golden.expected, actual)]));
    expect(report.passed).toBe(false);
    expect(report.failures.some((f) => f.includes("falseBookingRate"))).toBe(true);
  });
});

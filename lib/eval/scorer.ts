/**
 * Disposition-extraction scorer — the core of PropertyPilot's evaluation pipeline.
 *
 * Pure functions, no I/O: given an `expected` (golden) extraction and an `actual`
 * one (from a live Bolna `dispositions/test` call, or a fixture), compute how well
 * the agent's post-call understanding matches ground truth. We score what the
 * product actually routes on — the three CRITICAL_DISPOSITIONS plus the derived
 * signals (visit promised / needs human / detected language) — and we surface a
 * deliberate safety metric: the false-booking rate (the "hallucinated approval"
 * failure mode where the agent claims a booking that never happened).
 *
 * Reuses the canonical schema + helpers from lib/schema/outcome.ts so there is a
 * single source of truth for the extracted-data shape and routing logic.
 */
import {
  CRITICAL_DISPOSITIONS,
  detectedLanguage,
  getDispositionResult,
  isVisitPromised,
  needsHumanReview,
  type DispositionResult,
  type ExtractedDataT,
} from "@/lib/schema/outcome";

/* ---------- normalization ---------- */

function normText(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function normObjective(v: string | string[] | null | undefined): string {
  if (v == null) return "";
  if (Array.isArray(v)) return [...v].map((s) => s.trim().toLowerCase()).sort().join("|");
  return v.trim().toLowerCase();
}

function isNumericish(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s.trim());
}

/* ---------- per-disposition ---------- */

export interface DispositionScore {
  category: string;
  name: string;
  /** Did the actual result match the expected on every applicable dimension? */
  matched: boolean;
  /** Whether the agent produced this disposition at all. */
  present: boolean;
  /** Per-dimension breakdown. `null` = dimension not applicable for this case. */
  objectiveMatch: boolean | null;
  subjectiveMatch: boolean | null;
  labelMatch: boolean;
  validationMatch: boolean | null;
  /** |expected.confidence − actual.confidence|. */
  confidenceDelta: number;
  /**
   * Calibration error = |actual.confidence − correctness|, where correctness is
   * 1 when matched else 0. Penalizes confidently-wrong answers. `null` when the
   * agent omitted the disposition (no confidence to assess).
   */
  calibrationError: number | null;
}

/**
 * Score one expected disposition against the actual the agent produced.
 * Free-text subjective fields are scored on *presence agreement* (an LLM
 * paraphrase shouldn't be marked wrong); typed subjective fields
 * (numeric/timestamp) and all objective fields are scored on normalized equality.
 */
export function scoreDisposition(
  category: string,
  name: string,
  expected: DispositionResult,
  actual: DispositionResult | undefined,
): DispositionScore {
  const present = actual != null;

  let objectiveMatch: boolean | null = null;
  if (expected.objective != null) {
    objectiveMatch = normObjective(expected.objective) === normObjective(actual?.objective);
  }

  let subjectiveMatch: boolean | null = null;
  if (expected.subjective != null) {
    const expType = expected.validation?.expected_type;
    const typed = expType === "numeric" || expType === "timestamp" || isNumericish(expected.subjective);
    subjectiveMatch = typed
      ? normText(expected.subjective) === normText(actual?.subjective)
      : actual?.subjective != null; // free text: did the agent capture *something*?
  }

  const labelMatch = expected.confidence_label === actual?.confidence_label;
  const confidenceDelta = Math.abs((actual?.confidence ?? 0) - expected.confidence);

  let validationMatch: boolean | null = null;
  if (expected.validation) {
    validationMatch = expected.validation.is_valid === actual?.validation?.is_valid;
  }

  const dims = [objectiveMatch, subjectiveMatch].filter((d): d is boolean => d !== null);
  const matched = present && (dims.length === 0 ? true : dims.every(Boolean));

  const calibrationError = present ? Math.abs((actual as DispositionResult).confidence - (matched ? 1 : 0)) : null;

  return { category, name, matched, present, objectiveMatch, subjectiveMatch, labelMatch, validationMatch, confidenceDelta, calibrationError };
}

/* ---------- per-execution ---------- */

export interface DerivedSignal<T> {
  expected: T;
  actual: T;
  correct: boolean;
}

export interface ExecutionScore {
  caseId?: string;
  dispositions: DispositionScore[];
  dispositionAccuracy: number;
  criticalAccuracy: number;
  derived: {
    visitPromised: DerivedSignal<boolean>;
    needsHumanReview: DerivedSignal<boolean>;
    language: DerivedSignal<string | null>;
  };
  /** Agent claimed a booking that ground truth says didn't happen. The safety metric. */
  falseBooking: boolean;
  /** Ground truth needed a human but the agent wouldn't have routed it for review. */
  missedReview: boolean;
  meanCalibrationError: number;
}

const isCritical = (s: DispositionScore) =>
  CRITICAL_DISPOSITIONS.some((c) => c.category === s.category && c.name === s.name);

export function scoreExecution(
  expected: ExtractedDataT,
  actual: ExtractedDataT | null | undefined,
  caseId?: string,
): ExecutionScore {
  const dispositions: DispositionScore[] = [];
  for (const [category, byName] of Object.entries(expected)) {
    for (const [name, expectedResult] of Object.entries(byName)) {
      dispositions.push(scoreDisposition(category, name, expectedResult, getDispositionResult(actual, category, name)));
    }
  }

  const dispositionAccuracy = ratio(dispositions.filter((d) => d.matched).length, dispositions.length);
  const critical = dispositions.filter(isCritical);
  const criticalAccuracy = ratio(critical.filter((d) => d.matched).length, critical.length);

  const visitExp = isVisitPromised(expected);
  const visitAct = isVisitPromised(actual);
  const reviewExp = needsHumanReview(expected);
  const reviewAct = needsHumanReview(actual);
  const langExp = detectedLanguage(expected);
  const langAct = detectedLanguage(actual);

  const calibrations = dispositions.map((d) => d.calibrationError).filter((e): e is number => e !== null);

  return {
    caseId,
    dispositions,
    dispositionAccuracy,
    criticalAccuracy,
    derived: {
      visitPromised: { expected: visitExp, actual: visitAct, correct: visitExp === visitAct },
      needsHumanReview: { expected: reviewExp, actual: reviewAct, correct: reviewExp === reviewAct },
      language: { expected: langExp, actual: langAct, correct: normText(langExp) === normText(langAct) },
    },
    falseBooking: visitAct && !visitExp,
    missedReview: reviewExp && !reviewAct,
    meanCalibrationError: mean(calibrations),
  };
}

/* ---------- corpus aggregate ---------- */

export interface CorpusScore {
  cases: number;
  dispositionAccuracy: number;
  criticalAccuracy: number;
  visitPromisedAccuracy: number;
  needsHumanReviewAccuracy: number;
  languageAccuracy: number;
  falseBookingRate: number;
  missedReviewRate: number;
  meanCalibrationError: number;
  /** Per-disposition accuracy keyed by "Category / Name". */
  perDisposition: Record<string, { matched: number; total: number; accuracy: number }>;
}

export function scoreCorpus(executions: ExecutionScore[]): CorpusScore {
  const perDisposition: CorpusScore["perDisposition"] = {};
  let dispMatched = 0;
  let dispTotal = 0;
  let critMatched = 0;
  let critTotal = 0;

  for (const exec of executions) {
    for (const d of exec.dispositions) {
      const key = `${d.category} / ${d.name}`;
      const bucket = (perDisposition[key] ??= { matched: 0, total: 0, accuracy: 0 });
      bucket.total += 1;
      dispTotal += 1;
      if (d.matched) {
        bucket.matched += 1;
        dispMatched += 1;
      }
      if (isCritical(d)) {
        critTotal += 1;
        if (d.matched) critMatched += 1;
      }
    }
  }
  for (const bucket of Object.values(perDisposition)) {
    bucket.accuracy = ratio(bucket.matched, bucket.total);
  }

  const n = executions.length;
  return {
    cases: n,
    dispositionAccuracy: ratio(dispMatched, dispTotal),
    criticalAccuracy: ratio(critMatched, critTotal),
    visitPromisedAccuracy: ratio(executions.filter((e) => e.derived.visitPromised.correct).length, n),
    needsHumanReviewAccuracy: ratio(executions.filter((e) => e.derived.needsHumanReview.correct).length, n),
    languageAccuracy: ratio(executions.filter((e) => e.derived.language.correct).length, n),
    falseBookingRate: ratio(executions.filter((e) => e.falseBooking).length, n),
    missedReviewRate: ratio(executions.filter((e) => e.missedReview).length, n),
    meanCalibrationError: mean(executions.map((e) => e.meanCalibrationError)),
    perDisposition,
  };
}

/* ---------- thresholds (gate for the opt-in live runner) ---------- */

export interface EvalThresholds {
  minCriticalAccuracy: number;
  maxFalseBookingRate: number;
  maxMissedReviewRate: number;
  maxMeanCalibrationError: number;
}

export const DEFAULT_THRESHOLDS: EvalThresholds = {
  minCriticalAccuracy: 0.8,
  maxFalseBookingRate: 0, // a hallucinated booking is never acceptable
  maxMissedReviewRate: 0.1,
  maxMeanCalibrationError: 0.35,
};

export interface ThresholdReport {
  passed: boolean;
  failures: string[];
}

export function evaluateThresholds(score: CorpusScore, t: EvalThresholds = DEFAULT_THRESHOLDS): ThresholdReport {
  const failures: string[] = [];
  if (score.criticalAccuracy < t.minCriticalAccuracy)
    failures.push(`criticalAccuracy ${fmt(score.criticalAccuracy)} < ${fmt(t.minCriticalAccuracy)}`);
  if (score.falseBookingRate > t.maxFalseBookingRate)
    failures.push(`falseBookingRate ${fmt(score.falseBookingRate)} > ${fmt(t.maxFalseBookingRate)}`);
  if (score.missedReviewRate > t.maxMissedReviewRate)
    failures.push(`missedReviewRate ${fmt(score.missedReviewRate)} > ${fmt(t.maxMissedReviewRate)}`);
  if (score.meanCalibrationError > t.maxMeanCalibrationError)
    failures.push(`meanCalibrationError ${fmt(score.meanCalibrationError)} > ${fmt(t.maxMeanCalibrationError)}`);
  return { passed: failures.length === 0, failures };
}

/* ---------- small math helpers ---------- */

function ratio(num: number, denom: number): number {
  return denom === 0 ? 1 : num / denom;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function fmt(n: number): string {
  return n.toFixed(3);
}

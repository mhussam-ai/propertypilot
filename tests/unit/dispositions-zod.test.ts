import { describe, it, expect } from "vitest";
import fixture from "../fixtures/bolna-completed-execution.json";
import {
  WebhookPayloadSchema,
  ExtractedDataSchema,
  needsHumanReview,
  isVisitPromised,
  detectedLanguage,
  getDispositionResult,
  ExtractedDataT,
} from "@/lib/schema/outcome";

describe("WebhookPayloadSchema", () => {
  it("parses a real Bolna completed-execution payload", () => {
    const parsed = WebhookPayloadSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe(fixture.id);
      expect(parsed.data.status).toBe("completed");
      expect(parsed.data.extracted_data).toBeDefined();
    }
  });

  it("tolerates unknown forward-compatible fields", () => {
    const payload = { ...fixture, new_field_bolna_added_later: "yes" };
    const parsed = WebhookPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("rejects a payload missing the required id", () => {
    const { id: _id, ...rest } = fixture;
    const parsed = WebhookPayloadSchema.safeParse(rest);
    expect(parsed.success).toBe(false);
  });

  it("rejects a payload with an invalid status enum", () => {
    const payload = { ...fixture, status: "totally-not-a-real-status" };
    const parsed = WebhookPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});

describe("ExtractedDataSchema", () => {
  it("accepts the nested-by-category fixture shape", () => {
    const parsed = ExtractedDataSchema.safeParse(fixture.extracted_data);
    expect(parsed.success).toBe(true);
  });

  it("rejects a flat shape (the old plan's assumption)", () => {
    const flatShape = { picked_up: true, visit_promised: true } as unknown;
    const parsed = ExtractedDataSchema.safeParse(flatShape);
    expect(parsed.success).toBe(false);
  });

  it("rejects a disposition result with confidence > 1", () => {
    const bad = {
      "Lead Quality": {
        "Call Outcome": {
          subjective: "x",
          objective: "y",
          confidence: 1.5,
          confidence_label: "High",
        },
      },
    };
    const parsed = ExtractedDataSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown confidence_label", () => {
    const bad = {
      "Lead Quality": {
        "Call Outcome": {
          subjective: "x",
          objective: "y",
          confidence: 0.9,
          confidence_label: "Maybe",
        },
      },
    };
    const parsed = ExtractedDataSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });
});

describe("outcome helpers", () => {
  const data = fixture.extracted_data as any as ExtractedDataT;

  it("detects visit promised from objective=true", () => {
    expect(isVisitPromised(data)).toBe(true);
  });

  it("returns false when visit_promised disposition is absent", () => {
    const trimmed = { ...data, "Visit Details": { ...data["Visit Details"] } } as Record<string, Record<string, unknown>>;
    delete trimmed["Visit Details"]["Visit Promised"];
    expect(isVisitPromised(trimmed as unknown as typeof data)).toBe(false);
  });

  it("extracts detected language code", () => {
    expect(detectedLanguage(data)).toBe("en");
  });

  it("does not flag for human review when all critical signals are High", () => {
    expect(needsHumanReview(data)).toBe(false);
  });

  it("flags for human review when Visit Promised is Low confidence", () => {
    const mutated = JSON.parse(JSON.stringify(data));
    mutated["Visit Details"]["Visit Promised"].confidence_label = "Low";
    mutated["Visit Details"]["Visit Promised"].confidence = 0.3;
    expect(needsHumanReview(mutated)).toBe(true);
  });

  it("returns undefined for a non-existent disposition", () => {
    expect(getDispositionResult(data, "Nonexistent", "Whatever")).toBeUndefined();
  });
});

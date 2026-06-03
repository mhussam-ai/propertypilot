import { describe, it, expect } from "vitest";
import { LeadCsvRowSchema, extractCustomVars } from "@/lib/schema/lead-csv";

describe("LeadCsvRowSchema", () => {
  it("accepts a minimal valid row and normalizes phone to E.164", () => {
    const parsed = LeadCsvRowSchema.safeParse({
      name: "Aditya Mehra",
      contact_number: "9876543210", // 10-digit IN
      source: "portal_99acres",
      language_hint: "en",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.contact_number).toBe("+919876543210");
      expect(parsed.data.language_hint).toBe("en");
    }
  });

  it("accepts already-E.164 phone unchanged", () => {
    const parsed = LeadCsvRowSchema.safeParse({
      name: "Aditya",
      contact_number: "+919876543210",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.contact_number).toBe("+919876543210");
    }
  });

  it("rejects an invalid phone", () => {
    const parsed = LeadCsvRowSchema.safeParse({
      name: "x",
      contact_number: "12345",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unsupported language_hint", () => {
    const parsed = LeadCsvRowSchema.safeParse({
      name: "x",
      contact_number: "+919876543210",
      language_hint: "fr",
    });
    expect(parsed.success).toBe(false);
  });

  it("defaults source and language_hint when omitted", () => {
    const parsed = LeadCsvRowSchema.safeParse({
      name: "x",
      contact_number: "+919876543210",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.source).toBe("csv_upload");
      expect(parsed.data.language_hint).toBe("en");
    }
  });

  it("preserves unknown columns (passthrough)", () => {
    const parsed = LeadCsvRowSchema.safeParse({
      name: "x",
      contact_number: "+919876543210",
      city: "Bangalore",
      referral_code: "ABC123",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as Record<string, unknown>;
      expect(data.city).toBe("Bangalore");
      expect(data.referral_code).toBe("ABC123");
    }
  });
});

describe("extractCustomVars", () => {
  it("strips known columns and keeps the rest as string values", () => {
    const row = {
      name: "Aditya",
      contact_number: "+919876543210",
      source: "portal",
      language_hint: "en",
      city: "Bangalore",
      referral_code: "ABC",
      score: 42 as unknown as string,
    };
    const customs = extractCustomVars(row as never);
    expect(customs).toEqual({ city: "Bangalore", referral_code: "ABC", score: "42" });
  });

  it("returns an empty object when only known columns are present", () => {
    const row = {
      name: "x",
      contact_number: "+919876543210",
      source: "csv_upload",
      language_hint: "en",
    };
    expect(extractCustomVars(row as never)).toEqual({});
  });
});

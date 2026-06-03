import { describe, it, expect } from "vitest";
import {
  buildCanonicalDispositions,
  CANONICAL_NAMES,
} from "@/lib/dispositions/canonical";

describe("buildCanonicalDispositions", () => {
  const dispositions = buildCanonicalDispositions({
    bhk_configs: [
      { bhk: "2", carpet_area_sqft: 1000, price_inr: 12_500_000 },
      { bhk: "3", carpet_area_sqft: 1400, price_inr: 18_000_000 },
    ],
  });

  it("registers all 11 canonical names", () => {
    const names = new Set(dispositions.map((d) => `${d.category}::${d.name}`));
    for (const ref of Object.values(CANONICAL_NAMES)) {
      expect(names.has(`${ref.category}::${ref.name}`)).toBe(true);
    }
    expect(dispositions.length).toBe(Object.keys(CANONICAL_NAMES).length);
  });

  it("makes BHK Preference's objective_options match the property's actual configs", () => {
    const bhk = dispositions.find((d) => d.name === "BHK Preference")!;
    expect(bhk.objective_options).toBeDefined();
    const values = bhk.objective_options!.map((o) => o.value);
    expect(values).toEqual(["2", "3"]);
  });

  it("constrains Language Detected to a regex of allowed ISO codes", () => {
    const lang = dispositions.find((d) => d.name === "Language Detected")!;
    expect(lang.subjective_type).toBe("regex");
    expect(lang.subjective_type_config?.pattern).toContain("hi");
    expect(lang.subjective_type_config?.pattern).toContain("ta");
  });

  it("uses numeric subjective_type for Budget INR", () => {
    const budget = dispositions.find((d) => d.name === "Budget INR")!;
    expect(budget.subjective_type).toBe("numeric");
  });

  it("uses timestamp subjective_type for Visit Time", () => {
    const time = dispositions.find((d) => d.name === "Visit Time")!;
    expect(time.subjective_type).toBe("timestamp");
  });

  it("includes the dnc_request option on Call Outcome (TRAI compliance signal)", () => {
    const co = dispositions.find((d) => d.name === "Call Outcome")!;
    const values = co.objective_options!.map((o) => o.value);
    expect(values).toContain("dnc_request");
    expect(values).toContain("interested");
    expect(values).toContain("wrong_person");
  });
});

import { describe, it, expect } from "vitest";
import {
  buildContextForProperty,
  renderPropertyPrompt,
  SITE_VISIT_TEMPLATE,
  buildUserData,
} from "@/lib/prompt/render";
import type { PropertyFormT } from "@/lib/schema/property-form";

const PRESTIGE: PropertyFormT = {
  name: "Prestige Falcon City",
  rera: "PR/KA/RERA/1251/308/PR/220523",
  location: "Whitefield, Bangalore",
  bhk_configs: [
    { bhk: "2", carpet_area_sqft: 1080, price_inr: 12_500_000 },
    { bhk: "3", carpet_area_sqft: 1430, price_inr: 18_000_000 },
  ],
  amenities: ["35-acre integrated township", "Sports academy", "Clubhouse"],
  usp_lines: ["Integrated 35-acre township", "Possession Q4 2027"],
  price_band: { min_inr: 12_500_000, max_inr: 21_000_000 },
  visit_hours: { start_hour: 9, end_hour: 20, days: [0, 1, 2, 3, 4, 5, 6] },
  supported_languages: ["en", "hi", "ta"],
  default_voice_id: "eleven_turbo_v2_5_rachel",
  language_voice_overrides: {},
  daily_call_cap: 500,
  retry_policy: { max_retries: 3, retry_intervals_minutes: [30, 60, 120], retry_on_voicemail: false },
};

describe("buildContextForProperty", () => {
  it("formats BHK list, amenities, price band, languages", () => {
    const ctx = buildContextForProperty({
      property: PRESTIGE,
      developerShortName: "Prestige Group",
    });
    expect(ctx.property_name).toBe("Prestige Falcon City");
    expect(ctx.rera).toBe("PR/KA/RERA/1251/308/PR/220523");
    expect(ctx.bhk_list).toBe("2 BHK, 3 BHK");
    expect(ctx.amenities_list).toContain("Clubhouse");
    expect(ctx.price_band_text).toContain("₹");
    expect(ctx.price_band_text).toContain("12,50,00,000");
    expect(ctx.supported_languages_list).toBe("English, Hindi, Tamil");
    expect(ctx.primary_language_name).toBe("English");
    expect(ctx.developer_short_name).toBe("Prestige Group");
  });

  it("computes disallowed_bhk_pivot from the gap to standard configs", () => {
    const ctx = buildContextForProperty({
      property: PRESTIGE,
      developerShortName: "x",
    });
    // Standard: 1, 2, 2.5, 3, 3.5, 4, 5; offered: 2, 3
    expect(ctx.disallowed_bhk_pivot).toContain("1 BHK");
    expect(ctx.disallowed_bhk_pivot).toContain("4 BHK");
    expect(ctx.disallowed_bhk_pivot).not.toContain("2 BHK");
  });

  it("renders visit hours in 12-hour AM/PM", () => {
    const ctx = buildContextForProperty({
      property: PRESTIGE,
      developerShortName: "x",
    });
    expect(ctx.visit_hours_text).toMatch(/9 AM/);
    expect(ctx.visit_hours_text).toMatch(/8 PM/);
  });
});

describe("renderPropertyPrompt", () => {
  it("substitutes Handlebars variables and leaves Bolna {var} single-braces intact", async () => {
    const ctx = buildContextForProperty({
      property: PRESTIGE,
      developerShortName: "Prestige Group",
    });
    const rendered = await renderPropertyPrompt(SITE_VISIT_TEMPLATE, ctx);

    // Handlebars vars are substituted
    expect(rendered).toContain("Prestige Falcon City");
    expect(rendered).toContain("PR/KA/RERA/1251/308/PR/220523");
    expect(rendered).toContain("Whitefield, Bangalore");
    expect(rendered).toContain("2 BHK, 3 BHK");
    expect(rendered).toContain("Prestige Group");

    // Bolna single-brace runtime vars remain
    expect(rendered).toContain("{caller_name}");
    expect(rendered).toContain("{language_hint}");
    expect(rendered).toContain("{current_date}");
    expect(rendered).toContain("{current_time}");
    expect(rendered).toContain("{timezone}");

    // No unsubstituted Handlebars markers should remain.
    expect(rendered).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it("throws on missing required template var (strict mode)", async () => {
    const partial = { property_name: "x" } as never;
    await expect(renderPropertyPrompt(SITE_VISIT_TEMPLATE, partial)).rejects.toThrow();
  });
});

describe("buildUserData", () => {
  it("includes default timezone if not provided", () => {
    const ud = buildUserData({
      caller_name: "Aditya",
      language_hint: "en",
      lead_source: "portal",
    });
    expect(ud.timezone).toBe("Asia/Kolkata");
    expect(ud.caller_name).toBe("Aditya");
  });

  it("merges custom_vars without clobbering core fields", () => {
    const ud = buildUserData({
      caller_name: "Aditya",
      language_hint: "en",
      lead_source: "portal",
      custom_vars: { city: "Bangalore", referral_code: "ABC123" },
    });
    expect(ud.city).toBe("Bangalore");
    expect(ud.referral_code).toBe("ABC123");
    expect(ud.caller_name).toBe("Aditya");
  });
});

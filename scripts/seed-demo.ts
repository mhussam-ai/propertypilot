/**
 * PropertyPilot demo seed.
 *
 * Creates 2 tenants, 2 properties, 20 demo leads, 1 completed campaign with 6 calls
 * including a populated extracted_data per the canonical disposition set.
 *
 * Run via: pnpm seed
 *
 * Idempotent on tenant name + property name + lead phone within tenant.
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   KMS_KEY_B64
 */

import { createClient } from "@supabase/supabase-js";
import { encrypt, generateOpaqueToken } from "@/lib/crypto/aes-gcm";
import fixture from "../tests/fixtures/bolna-completed-execution.json";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const TENANT_FIXTURES = [
  {
    name: "Lodha Group",
    plan: "pro",
    bolnaApiKey: "bn-demo-lodha-fake-key-for-seed-only-replace-me-aaaa",
    properties: [
      {
        name: "Lodha Park Worli",
        rera: "P51800020045",
        location: "Worli, Mumbai",
        bhk_configs: [
          { bhk: "2", carpet_area_sqft: 1100, price_inr: 35_000_000 },
          { bhk: "2.5", carpet_area_sqft: 1350, price_inr: 45_000_000 },
        ],
        amenities: ["80+ amenities", "11-acre podium", "Tennis & cricket", "Hotel-grade spa"],
        usp_lines: [
          "South Mumbai address with sea + race-course views",
          "Possession-ready inventory",
          "Curated by world-class architects",
        ],
        price_band: { min_inr: 35_000_000, max_inr: 45_000_000 },
        supported_languages: ["en", "hi", "mr", "gu"],
        default_voice_id: "eleven_turbo_v2_5_rachel",
        language_voice_overrides: {
          hi: "sarvam-bulbul-v3-hindi",
          mr: "sarvam-bulbul-v3-marathi",
          gu: "sarvam-bulbul-v3-gujarati",
        },
      },
    ],
  },
  {
    name: "Prestige Group",
    plan: "pro",
    bolnaApiKey: "bn-demo-prestige-fake-key-for-seed-only-replace-me-bbbb",
    properties: [
      {
        name: "Prestige Falcon City",
        rera: "PR/KA/RERA/1251/308/PR/220523",
        location: "Whitefield, Bangalore",
        bhk_configs: [
          { bhk: "2", carpet_area_sqft: 1080, price_inr: 12_500_000 },
          { bhk: "3", carpet_area_sqft: 1430, price_inr: 18_000_000 },
          { bhk: "3.5", carpet_area_sqft: 1680, price_inr: 21_000_000 },
        ],
        amenities: ["35-acre integrated township", "100+ amenities", "Sports academy", "Clubhouse"],
        usp_lines: [
          "Integrated 35-acre township",
          "Possession Q4 2027",
          "70% open green space",
          "Walkable to Whitefield ITPL tech park",
        ],
        price_band: { min_inr: 12_500_000, max_inr: 21_000_000 },
        supported_languages: ["en", "hi", "ta", "kn"],
        default_voice_id: "eleven_turbo_v2_5_rachel",
        language_voice_overrides: {
          hi: "sarvam-bulbul-v3-hindi",
          ta: "sarvam-bulbul-v3-tamil",
          kn: "sarvam-bulbul-v3-kannada",
        },
      },
    ],
  },
];

const DEMO_LEADS: Array<{ name: string; phone: string; lang: string; source: string }> = [
  { name: "Aditya Mehra", phone: "+919876543210", lang: "en", source: "portal_99acres" },
  { name: "Rohit Sharma", phone: "+919812345678", lang: "hi", source: "facebook_ads" },
  { name: "Priya Patel", phone: "+919823456789", lang: "gu", source: "direct_call" },
  { name: "Karthik Iyer", phone: "+919876123456", lang: "ta", source: "google_ads" },
  { name: "Anjali Kulkarni", phone: "+919765432109", lang: "mr", source: "portal_magicbricks" },
  { name: "Vikram Reddy", phone: "+919876765432", lang: "en", source: "instagram_ads" },
  { name: "Sneha Joshi", phone: "+919712345677", lang: "mr", source: "portal_99acres" },
  { name: "Amit Singh", phone: "+919898123456", lang: "hi", source: "google_ads" },
  { name: "Pooja Rajan", phone: "+919840012345", lang: "ta", source: "facebook_ads" },
  { name: "Suresh Nair", phone: "+919847012345", lang: "en", source: "referral" },
];

async function main() {
  const supabase = admin();

  console.log("Seeding tenants…");
  const tenantIds: string[] = [];
  for (const tf of TENANT_FIXTURES) {
    const { data: existing } = await supabase
      .from("tenants")
      .select("id")
      .eq("name", tf.name)
      .maybeSingle();
    let tenantId: string;
    if (existing) {
      tenantId = existing.id as string;
      console.log(`  • ${tf.name} already exists (${tenantId})`);
    } else {
      const { data: t, error } = await supabase
        .from("tenants")
        .insert({ name: tf.name, plan: tf.plan })
        .select("id")
        .single();
      if (error) throw error;
      tenantId = t.id as string;
      console.log(`  • created ${tf.name} (${tenantId})`);
    }
    tenantIds.push(tenantId);

    // Secrets
    const { data: secretsExist } = await supabase
      .from("tenant_secrets")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!secretsExist) {
      const webhookToken = generateOpaqueToken(32);
      await supabase.from("tenant_secrets").insert({
        tenant_id: tenantId,
        bolna_api_key_ciphertext: encrypt(tf.bolnaApiKey),
        webhook_token_ciphertext: encrypt(webhookToken),
      });
      const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
      console.log(`    webhook URL: ${base}/api/webhooks/bolna/${tenantId}/${webhookToken}`);
    }

    // Properties
    for (const pf of tf.properties) {
      const { data: pExist } = await supabase
        .from("properties")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("name", pf.name)
        .maybeSingle();
      let propertyId: string;
      if (pExist) {
        propertyId = pExist.id as string;
        console.log(`    • ${pf.name} already exists`);
      } else {
        const { data: p, error } = await supabase
          .from("properties")
          .insert({
            tenant_id: tenantId,
            name: pf.name,
            rera: pf.rera,
            location: pf.location,
            bhk_configs: pf.bhk_configs,
            amenities: pf.amenities,
            usp_lines: pf.usp_lines,
            price_band: pf.price_band,
            visit_hours: { start_hour: 9, end_hour: 20, days: [0, 1, 2, 3, 4, 5, 6] },
            supported_languages: pf.supported_languages,
            default_voice_id: pf.default_voice_id,
            language_voice_overrides: pf.language_voice_overrides,
            // bolna_agent_id is left null until the real Bolna account is wired.
            developer_short_name: tf.name,
          })
          .select("id")
          .single();
        if (error) throw error;
        propertyId = p.id as string;
        console.log(`    • created ${pf.name}`);
      }

      // Leads for this property (only for the first property to keep volume manageable).
      if (pf === tf.properties[0]) {
        const rows = DEMO_LEADS.map((l) => ({
          tenant_id: tenantId,
          property_id: propertyId,
          name: l.name,
          phone_e164: l.phone.replace(/^\+91/, "+9199"), // ensure 12-digit IN-style
          source: l.source,
          language_hint: l.lang,
        }));
        await supabase
          .from("leads")
          .upsert(rows, { onConflict: "tenant_id,phone_e164" });
        console.log(`    • ${rows.length} leads seeded for ${pf.name}`);
      }
    }
  }

  // Demo campaign with 6 completed calls on the first tenant's first property.
  console.log("Seeding demo campaign + calls…");
  const tenantId = tenantIds[0];
  const { data: prop } = await supabase
    .from("properties")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .single();
  if (!prop) {
    console.log("No property to attach demo campaign to; done.");
    return;
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .upsert(
      [
        {
          tenant_id: tenantId,
          property_id: prop.id,
          name: "Demo · Worli Q2 outreach",
          status: "completed",
          daily_cap: 500,
          budget_cap_inr: 100000,
          budget_consumed_inr: 18.5 * 6,
          prompt_version: 1,
        },
      ],
      { onConflict: "id" },
    )
    .select("id")
    .single();

  if (!campaign) return;

  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, phone_e164")
    .eq("tenant_id", tenantId)
    .limit(6);

  for (const lead of leads ?? []) {
    const execId = `exec_demo_${lead.id.slice(0, 8)}`;
    const { data: existing } = await supabase
      .from("calls")
      .select("id")
      .eq("bolna_execution_id", execId)
      .maybeSingle();
    if (existing) continue;

    await supabase.from("calls").insert({
      tenant_id: tenantId,
      lead_id: lead.id,
      property_id: prop.id,
      campaign_id: campaign.id,
      prompt_version: 1,
      bolna_execution_id: execId,
      to_number: lead.phone_e164,
      status: "completed",
      duration_s: fixture.conversation_time,
      cost_inr: fixture.cost,
      hangup_reason: fixture.hangup_reason,
      recording_url: fixture.recording_url,
      transcript: fixture.transcript,
      extracted_data: fixture.extracted_data,
      retry_count: 0,
      from_number: fixture.from_number,
      telephony_provider: fixture.telephony_provider,
      to_number_carrier: fixture.to_number_carrier,
      needs_human_review: false,
      started_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      ended_at: new Date(Date.now() - 2 * 24 * 3600 * 1000 + fixture.conversation_time * 1000).toISOString(),
    });
  }

  console.log("\nSeed complete. Sign up as a new user and Supabase will create a fresh tenant for you.");
  console.log("To attach yourself to an existing demo tenant, manually insert a tenant_users row.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

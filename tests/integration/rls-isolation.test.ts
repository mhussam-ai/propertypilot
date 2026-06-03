import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { cleanup, makeTwoTenants, seedProperty, type TenantPair } from "./setup-tenants";

/**
 * RLS tenant-isolation contract.
 *
 * For each business table, tenant B must NEVER be able to read, update, or delete tenant A's rows
 * via the anon client (which goes through RLS). Service-role bypasses RLS and is used here only
 * for setup/teardown.
 *
 * Catching a single regression here is the entire reason this suite exists — please do not skip
 * it under "no time, just commit". Either fix the policy or fix the test.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let pair: TenantPair;
let aPropertyId: string;
let bPropertyId: string;

const adminClient = () =>
  createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

beforeAll(async () => {
  pair = await makeTwoTenants();
  aPropertyId = await seedProperty(pair.tenantA.tenantId, "A");
  bPropertyId = await seedProperty(pair.tenantB.tenantId, "B");
}, 30_000);

afterAll(async () => {
  if (pair) await cleanup(pair);
});

describe("RLS isolation", () => {
  it("properties: tenant B cannot read tenant A's property", async () => {
    const { data, error } = await pair.tenantB.anonClient
      .from("properties")
      .select("id")
      .eq("id", aPropertyId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("properties: tenant B cannot update tenant A's property", async () => {
    const { data, error } = await pair.tenantB.anonClient
      .from("properties")
      .update({ name: "PWNED" })
      .eq("id", aPropertyId)
      .select("id");
    // Either returns empty rows (RLS hid it) or errors. Both mean no leak.
    expect(error === null ? (data ?? []).length : 0).toBe(0);

    // Verify the row in tenant A is unchanged.
    const { data: check } = await adminClient()
      .from("properties")
      .select("name")
      .eq("id", aPropertyId)
      .single();
    expect(check?.name).not.toBe("PWNED");
  });

  it("properties: tenant A cannot spoof tenant_id on insert", async () => {
    const { data, error } = await pair.tenantA.anonClient
      .from("properties")
      .insert({
        tenant_id: pair.tenantB.tenantId,
        name: "evil",
        rera: `R-${randomBytes(4).toString("hex")}`,
        location: "x",
        bhk_configs: [],
        price_band: { min_inr: 1, max_inr: 2 },
        visit_hours: { start_hour: 9, end_hour: 20, days: [0] },
        supported_languages: ["en"],
        default_voice_id: "v",
      })
      .select("id");
    // RLS with-check should reject. Either an error, or zero rows returned.
    expect(error === null ? (data ?? []).length : 0).toBe(0);
  });

  it("leads: tenant B cannot read tenant A's lead", async () => {
    const a = adminClient();
    const { data: lead } = await a
      .from("leads")
      .insert({
        tenant_id: pair.tenantA.tenantId,
        property_id: aPropertyId,
        name: "Alice",
        phone_e164: "+911234567890",
      })
      .select("id")
      .single();
    expect(lead?.id).toBeTruthy();

    const { data, error } = await pair.tenantB.anonClient
      .from("leads")
      .select("id")
      .eq("id", lead!.id);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("campaigns: tenant B cannot read tenant A's campaign", async () => {
    const a = adminClient();
    const { data: camp } = await a
      .from("campaigns")
      .insert({
        tenant_id: pair.tenantA.tenantId,
        property_id: aPropertyId,
        name: "A-Campaign",
      })
      .select("id")
      .single();
    const { data } = await pair.tenantB.anonClient
      .from("campaigns")
      .select("id")
      .eq("id", camp!.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("dispositions: tenant B cannot read tenant A's disposition", async () => {
    const a = adminClient();
    const { data: d } = await a
      .from("dispositions")
      .insert({
        tenant_id: pair.tenantA.tenantId,
        property_id: aPropertyId,
        name: `d-${randomBytes(3).toString("hex")}`,
        category: "intent",
        question: "?",
      })
      .select("id")
      .single();
    const { data } = await pair.tenantB.anonClient
      .from("dispositions")
      .select("id")
      .eq("id", d!.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("dnc_list: tenant B cannot read tenant A's DNC entries (regulatory)", async () => {
    const a = adminClient();
    const phone = `+9199${randomBytes(4).toString("hex").slice(0, 8)}`;
    const { data: row } = await a
      .from("dnc_list")
      .insert({ tenant_id: pair.tenantA.tenantId, phone_e164: phone })
      .select("id")
      .single();
    const { data } = await pair.tenantB.anonClient
      .from("dnc_list")
      .select("id")
      .eq("id", row!.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("calls: tenant B cannot read tenant A's calls", async () => {
    const a = adminClient();
    const { data: lead } = await a
      .from("leads")
      .insert({
        tenant_id: pair.tenantA.tenantId,
        property_id: aPropertyId,
        name: "Bob",
        phone_e164: "+911234567891",
      })
      .select("id")
      .single();
    const { data: call } = await a
      .from("calls")
      .insert({
        tenant_id: pair.tenantA.tenantId,
        lead_id: lead!.id,
        property_id: aPropertyId,
        bolna_execution_id: `exec-${randomBytes(4).toString("hex")}`,
      })
      .select("id")
      .single();
    const { data } = await pair.tenantB.anonClient
      .from("calls")
      .select("id")
      .eq("id", call!.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("call_events: anon client cannot insert (writes are service-role-only)", async () => {
    const { error } = await pair.tenantA.anonClient.from("call_events").insert({
      tenant_id: pair.tenantA.tenantId,
      bolna_execution_id: "spoofed",
      kind: "spoof",
      payload: {},
      idempotency_key: `spoof-${randomBytes(4).toString("hex")}`,
    });
    expect(error).not.toBeNull();
  });

  it("tenant_secrets: tenant B cannot read tenant A's secrets", async () => {
    const { data } = await pair.tenantB.anonClient
      .from("tenant_secrets")
      .select("tenant_id")
      .eq("tenant_id", pair.tenantA.tenantId);
    expect(data ?? []).toHaveLength(0);
  });

  it("inbox_items: tenant B cannot read tenant A's inbox items", async () => {
    const a = adminClient();
    const { data: lead } = await a
      .from("leads")
      .insert({
        tenant_id: pair.tenantA.tenantId,
        property_id: aPropertyId,
        name: "Inbox-A",
        phone_e164: "+911234567892",
      })
      .select("id")
      .single();
    const { data: call } = await a
      .from("calls")
      .insert({
        tenant_id: pair.tenantA.tenantId,
        lead_id: lead!.id,
        property_id: aPropertyId,
        bolna_execution_id: `inbox-${randomBytes(4).toString("hex")}`,
      })
      .select("id")
      .single();
    const { data: item } = await a
      .from("inbox_items")
      .insert({
        tenant_id: pair.tenantA.tenantId,
        call_id: call!.id,
        lead_id: lead!.id,
      })
      .select("id")
      .single();
    const { data } = await pair.tenantB.anonClient
      .from("inbox_items")
      .select("id")
      .eq("id", item!.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("user_tenant_ids() helper: user with no tenant_users row sees zero rows everywhere", async () => {
    // Make a third user with no tenant membership.
    const a = adminClient();
    const email = `rls-stranger-${randomBytes(4).toString("hex")}@example.test`;
    const password = `Pw!${randomBytes(8).toString("hex")}`;
    const { data: stranger, error: createErr } = await a.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createErr).toBeNull();
    try {
      const strangerClient = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await strangerClient.auth.signInWithPassword({ email, password });
      expect(signInErr).toBeNull();

      const [props, leads, camps, calls] = await Promise.all([
        strangerClient.from("properties").select("id"),
        strangerClient.from("leads").select("id"),
        strangerClient.from("campaigns").select("id"),
        strangerClient.from("calls").select("id"),
      ]);
      expect(props.data ?? []).toHaveLength(0);
      expect(leads.data ?? []).toHaveLength(0);
      expect(camps.data ?? []).toHaveLength(0);
      expect(calls.data ?? []).toHaveLength(0);
    } finally {
      if (stranger?.user) await a.auth.admin.deleteUser(stranger.user.id);
    }
  });
});

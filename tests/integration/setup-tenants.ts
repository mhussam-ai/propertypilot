import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { encrypt } from "@/lib/crypto/aes-gcm";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!anonKey || !serviceKey) {
  throw new Error(
    "integration tests require NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY — run `pnpm supabase:start` first and export the keys from `supabase status -o env`",
  );
}

export interface TestTenant {
  userId: string;
  email: string;
  password: string;
  tenantId: string;
  anonClient: SupabaseClient;
}

function admin(): SupabaseClient {
  return createClient(url, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function newAnon(): SupabaseClient {
  // Each anon client maintains its own session in memory. No shared cookies.
  return createClient(url, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function makeOneTenant(label: string): Promise<TestTenant> {
  const a = admin();
  const suffix = randomBytes(6).toString("hex");
  const email = `rls-${label}-${suffix}@example.test`;
  const password = `Pw!${randomBytes(12).toString("hex")}`;

  const { data: user, error: userErr } = await a.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !user.user) throw new Error(`createUser failed: ${userErr?.message}`);

  const webhookTokenCiphertext = encrypt(randomBytes(16).toString("hex"));
  const { data: tenantId, error: rpcErr } = await a.rpc("bootstrap_tenant", {
    p_user_id: user.user.id,
    p_company_name: `RLS-${label}-${suffix}`,
    p_webhook_token_ciphertext: webhookTokenCiphertext,
  });
  if (rpcErr || !tenantId) throw new Error(`bootstrap_tenant failed: ${rpcErr?.message}`);

  const anonClient = newAnon();
  const { error: signInErr } = await anonClient.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);

  return {
    userId: user.user.id,
    email,
    password,
    tenantId: tenantId as string,
    anonClient,
  };
}

export interface TenantPair {
  tenantA: TestTenant;
  tenantB: TestTenant;
}

export async function makeTwoTenants(): Promise<TenantPair> {
  const [tenantA, tenantB] = await Promise.all([makeOneTenant("A"), makeOneTenant("B")]);
  return { tenantA, tenantB };
}

export async function cleanup({ tenantA, tenantB }: TenantPair) {
  const a = admin();
  // Tenant cascade-deletes properties/leads/campaigns/calls. User cascade-deletes tenant_users.
  // Delete tenants first to clear FK-constrained child rows in one go.
  await a.from("tenants").delete().in("id", [tenantA.tenantId, tenantB.tenantId]);
  await Promise.all([
    a.auth.admin.deleteUser(tenantA.userId),
    a.auth.admin.deleteUser(tenantB.userId),
  ]);
}

/**
 * Seed a property under a tenant using the service-role client (bypasses RLS for setup).
 * Returns the inserted property id.
 */
export async function seedProperty(tenantId: string, label: string): Promise<string> {
  const a = admin();
  const { data, error } = await a
    .from("properties")
    .insert({
      tenant_id: tenantId,
      name: `Test Property ${label}`,
      rera: `RERA-${randomBytes(4).toString("hex")}`,
      location: "Mumbai",
      bhk_configs: [{ bhk: "2BHK", carpet_sqft: 800 }],
      price_band: { min_inr: 10_000_000, max_inr: 20_000_000 },
      visit_hours: { start_hour: 9, end_hour: 20, days: [0, 1, 2, 3, 4, 5, 6] },
      supported_languages: ["en"],
      default_voice_id: "test-voice",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedProperty failed: ${error?.message}`);
  return data.id as string;
}

/**
 * Replay a synthetic Bolna webhook against our local endpoint. Useful for:
 *   - Demoing the hot-lead → SDR Inbox flow without making a live call
 *   - Recovering from a missed webhook (use the bolna-poll cron in prod instead)
 *
 * The script reads tests/fixtures/bolna-completed-execution.json, looks up the first
 * tenant's webhook token, and POSTs the payload to /api/webhooks/bolna/{tenantId}/{token}.
 * Dev IP bypass (127.0.0.1) lets the route accept it.
 *
 * Run via: pnpm replay-webhook [--exec=<exec_id>] [--agent=<agent_id>]
 */

import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto/aes-gcm";
import fixture from "../tests/fixtures/bolna-completed-execution.json";

const APP_BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: secrets } = await supabase
    .from("tenant_secrets")
    .select("tenant_id, webhook_token_ciphertext")
    .limit(1)
    .single();

  if (!secrets) {
    console.error("No tenants found. Run pnpm seed first.");
    process.exit(1);
  }

  const tenantId = secrets.tenant_id as string;
  const token = decrypt(secrets.webhook_token_ciphertext as string);

  const payload = {
    ...fixture,
    id: args.exec ?? fixture.id,
    agent_id: args.agent ?? fixture.agent_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Try to use a real agent if the tenant has one.
  if (!args.agent) {
    const { data: prop } = await supabase
      .from("properties")
      .select("bolna_agent_id")
      .eq("tenant_id", tenantId)
      .not("bolna_agent_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (prop?.bolna_agent_id) {
      payload.agent_id = prop.bolna_agent_id as string;
    }
  }

  const target = `${APP_BASE}/api/webhooks/bolna/${tenantId}/${token}`;
  console.log(`POST ${target}`);
  console.log(`  execution_id: ${payload.id}`);
  console.log(`  agent_id:     ${payload.agent_id}`);
  console.log(`  status:       ${payload.status}`);

  const res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log(`\n${res.status} ${res.statusText}`);
  console.log(text);

  if (res.ok) {
    console.log("\nNow visit /app/inbox to see the synthetic call.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

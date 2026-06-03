import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { getTenantContext } from "@/lib/tenant/context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BolnaKeyForm } from "@/components/feature/Settings/BolnaKeyForm";
import { Copy } from "lucide-react";

export default async function SettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const supabase = await createSupabaseServerClient();

  const { data: members } = await supabase
    .from("tenant_users")
    .select("user_id, role, created_at")
    .eq("tenant_id", ctx.tenantId);

  const { data: usage } = await supabase
    .from("calls")
    .select("id, cost_inr")
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  // Render the webhook URL the user copy-pastes into Bolna agents. We can compute it
  // from the per-tenant token. We need the cleartext token, so go through admin client.
  let webhookUrl = "";
  let hasBolnaKey = false;
  const admin = createSupabaseAdminClient();
  const { data: secrets } = await admin
    .from("tenant_secrets")
    .select("webhook_token_ciphertext, bolna_api_key_ciphertext")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (secrets?.webhook_token_ciphertext) {
    try {
      const token = decrypt(secrets.webhook_token_ciphertext as string);
      const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
      webhookUrl = `${base}/api/webhooks/bolna/${ctx.tenantId}/${token}`;
    } catch {
      webhookUrl = "[token decryption failed — regenerate]";
    }
  }
  hasBolnaKey = Boolean(secrets?.bolna_api_key_ciphertext);

  const totalCallsThisMonth = usage?.length ?? 0;
  const totalCostThisMonth = (usage ?? []).reduce((s, r) => s + Number(r.cost_inr ?? 0), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Bolna credentials</CardTitle>
          <CardDescription>
            Paste the API key from{" "}
            <a
              href="https://platform.bolna.ai"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              platform.bolna.ai → Developers
            </a>
            . We&apos;ll validate it against Bolna and encrypt it at rest (AES-256-GCM).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BolnaKeyForm hasKey={hasBolnaKey} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook URL</CardTitle>
          <CardDescription>
            Bolna will POST execution updates to this URL. Auth is IP allowlist
            (13.203.39.153) + per-tenant opaque token. Whitelist that IP on your firewall
            if you proxy webhooks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="block flex-1 break-all rounded-md border bg-muted px-3 py-2 text-xs">
              {webhookUrl || "—"}
            </code>
            <CopyButton text={webhookUrl} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(members ?? []).map((m) => (
              <div key={m.user_id} className="flex items-center justify-between rounded-md border p-3">
                <div className="font-mono text-xs">{m.user_id}</div>
                <Badge variant="outline">{m.role}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage this month</CardTitle>
          <CardDescription>Sum of completed-call cost (billed by Bolna).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">{totalCallsThisMonth} calls</div>
          <div className="text-sm text-muted-foreground">
            ₹{Math.round(totalCostThisMonth).toLocaleString("en-IN")} consumed
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  if (!text) return null;
  return (
    <button
      type="button"
      className="rounded-md border bg-background p-2 hover:bg-accent"
      title="Copy"
      // Client islands need their own component — but this static placeholder is fine for SSR;
      // upgraded version lives in components/feature/Settings/CopyButton.tsx.
    >
      <Copy className="h-4 w-4" />
    </button>
  );
}

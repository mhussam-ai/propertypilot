import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function OpsPage() {
  const supabase = await createSupabaseServerClient();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: recentEvents, count: eventsTotal },
    { count: pendingCalls },
    { count: needsReview },
    { count: failedCalls24h },
    { count: completed24h },
  ] = await Promise.all([
    supabase
      .from("call_events")
      .select("id, bolna_execution_id, kind, status, retry_count, source_ip, received_at", { count: "exact" })
      .order("received_at", { ascending: false })
      .limit(50),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "dialing", "in-progress"]),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("needs_human_review", true),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "error"])
      .gte("created_at", since24h),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("created_at", since24h),
  ]);

  // Source-IP distribution to spot anomalies (non-Bolna IPs hitting webhook).
  const ipCounts = new Map<string, number>();
  for (const e of recentEvents ?? []) {
    if (!e.source_ip) continue;
    ipCounts.set(e.source_ip, (ipCounts.get(e.source_ip) ?? 0) + 1);
  }
  const ipBreakdown = Array.from(ipCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Ops health</h1>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Total webhook events" value={String(eventsTotal ?? 0)} />
        <Stat label="Pending calls" value={String(pendingCalls ?? 0)} hint="queued + dialing + in-progress" />
        <Stat label="Manual-review queue" value={String(needsReview ?? 0)} />
        <Stat
          label="Failed / completed (24h)"
          value={`${failedCalls24h ?? 0} / ${completed24h ?? 0}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Webhook source IP breakdown (last 50)</CardTitle>
          <CardDescription>
            Anything other than <code className="text-xs">13.203.39.153</code> or <code>127.0.0.1</code>{" "}
            (dev) is suspicious.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ipBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {ipBreakdown.map(([ip, count]) => {
                const expected =
                  ip === "13.203.39.153" || ip === "127.0.0.1" || ip === "::1" || ip === "reconcile";
                return (
                  <div key={ip} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <code className="font-mono">{ip}</code>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{count} events</span>
                      <Badge variant={expected ? "success" : "destructive"}>
                        {expected ? "expected" : "unexpected"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent webhook events</CardTitle>
          <CardDescription>Newest first. Idempotent — replays are no-ops.</CardDescription>
        </CardHeader>
        <CardContent>
          {(recentEvents ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Execution</th>
                    <th className="py-2 pr-4">Kind</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Retry</th>
                    <th className="py-2 pr-4">From IP</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentEvents ?? []).map((e) => (
                    <tr key={e.id} className="border-b">
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {new Date(e.received_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {e.bolna_execution_id.slice(0, 12)}…
                      </td>
                      <td className="py-2 pr-4"><Badge variant="outline">{e.kind}</Badge></td>
                      <td className="py-2 pr-4"><Badge variant="secondary">{e.status}</Badge></td>
                      <td className="py-2 pr-4">{e.retry_count ?? 0}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{e.source_ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
        {hint && <CardDescription className="text-xs">{hint}</CardDescription>}
      </CardHeader>
      <CardContent className="text-2xl font-semibold">{value}</CardContent>
    </Card>
  );
}

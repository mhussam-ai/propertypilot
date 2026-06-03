import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";

export default async function UsagePage() {
  const supabase = await createSupabaseServerClient();

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: calls } = await supabase
    .from("calls")
    .select("cost_inr, duration_s, status, created_at")
    .gte("created_at", since30);

  const totalCost = (calls ?? []).reduce((s, c) => s + Number(c.cost_inr ?? 0), 0);
  const totalSeconds = (calls ?? []).reduce((s, c) => s + Number(c.duration_s ?? 0), 0);
  const totalCalls = calls?.length ?? 0;

  // Daily series for the last 30 days.
  const byDay = new Map<string, { count: number; cost: number; seconds: number }>();
  for (const c of calls ?? []) {
    const day = new Date(c.created_at).toISOString().slice(0, 10);
    const slot = byDay.get(day) ?? { count: 0, cost: 0, seconds: 0 };
    slot.count += 1;
    slot.cost += Number(c.cost_inr ?? 0);
    slot.seconds += Number(c.duration_s ?? 0);
    byDay.set(day, slot);
  }
  const series = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Usage</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Calls (30d)" value={String(totalCalls)} />
        <Stat
          label="Minutes (30d)"
          value={Math.round(totalSeconds / 60).toLocaleString("en-IN")}
        />
        <Stat label="Spend (30d)" value={formatINR(Math.round(totalCost))} hint="Bolna billing (mocked rollup)" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily breakdown</CardTitle>
          <CardDescription>Mocked from <code>calls.cost_inr</code>. Replace with Stripe billing in V2.</CardDescription>
        </CardHeader>
        <CardContent>
          {series.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Day</th>
                  <th className="py-2 pr-4">Calls</th>
                  <th className="py-2 pr-4">Minutes</th>
                  <th className="py-2 pr-4">Spend</th>
                </tr>
              </thead>
              <tbody>
                {series.map(([day, slot]) => (
                  <tr key={day} className="border-b">
                    <td className="py-2 pr-4">{day}</td>
                    <td className="py-2 pr-4">{slot.count}</td>
                    <td className="py-2 pr-4">{Math.round(slot.seconds / 60)}</td>
                    <td className="py-2 pr-4">{formatINR(Math.round(slot.cost))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

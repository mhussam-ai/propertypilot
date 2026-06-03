import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FunnelChart, CpsvbByLanguageChart, PickupByHourChart } from "@/components/feature/Analytics/Charts";
import { formatINR } from "@/lib/utils";

export default async function AnalyticsPage() {
  const supabase = await createSupabaseServerClient();

  // Funnel (last 30 days)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [
    { count: leadsCount },
    { count: dialedCount },
    { count: pickedCount },
    { count: bookedCount },
  ] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .in("status", ["in-progress", "completed"]),
    supabase
      .from("inbox_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "site_visit_booked"),
  ]);

  const funnelData = [
    { stage: "Leads", count: leadsCount ?? 0 },
    { stage: "Dialed", count: dialedCount ?? 0 },
    { stage: "Picked up", count: pickedCount ?? 0 },
    { stage: "Visit booked", count: bookedCount ?? 0 },
  ];

  // CPSVB by language: language_hint of the call's lead × cost summed ÷ bookings counted.
  const { data: calls } = await supabase
    .from("calls")
    .select("cost_inr, status, started_at, leads(language_hint)")
    .gte("created_at", since);

  const byLang = new Map<string, { cost: number; visits: number }>();
  for (const c of calls ?? []) {
    const lang = (c.leads as unknown as { language_hint?: string } | null)?.language_hint ?? "unknown";
    const slot = byLang.get(lang) ?? { cost: 0, visits: 0 };
    slot.cost += Number(c.cost_inr ?? 0);
    if (c.status === "completed") slot.visits += 1;
    byLang.set(lang, slot);
  }
  const cpsvbByLang = Array.from(byLang.entries())
    .map(([language, { cost, visits }]) => ({
      language,
      cpsvb: visits > 0 ? cost / visits : 0,
      visits,
    }))
    .sort((a, b) => b.visits - a.visits);

  // Pickup rate by hour of dial.
  const byHour = new Map<number, { picked: number; total: number }>();
  for (const c of calls ?? []) {
    const when = c.started_at ? new Date(c.started_at) : null;
    if (!when) continue;
    const hour = when.getHours();
    const slot = byHour.get(hour) ?? { picked: 0, total: 0 };
    slot.total += 1;
    if (c.status === "completed" || c.status === "in-progress") slot.picked += 1;
    byHour.set(hour, slot);
  }
  const pickupByHour = Array.from({ length: 24 }, (_, h) => {
    const slot = byHour.get(h);
    return {
      hour: h,
      pickup_rate: slot && slot.total > 0 ? slot.picked / slot.total : 0,
    };
  });

  const totalCost = (calls ?? []).reduce((s, c) => s + Number(c.cost_inr ?? 0), 0);
  const cpsvb = bookedCount && bookedCount > 0 ? totalCost / bookedCount : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Analytics</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="CPSVB (30d)" value={cpsvb > 0 ? formatINR(cpsvb) : "—"} hint="Cost ÷ site-visits booked" />
        <Stat label="Total spend (30d)" value={formatINR(Math.round(totalCost))} />
        <Stat
          label="Pickup rate (30d)"
          value={
            dialedCount && dialedCount > 0
              ? `${Math.round(((pickedCount ?? 0) / dialedCount) * 100)}%`
              : "—"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Funnel (last 30 days)</CardTitle>
          <CardDescription>From CSV upload to booked site-visit.</CardDescription>
        </CardHeader>
        <CardContent><FunnelChart data={funnelData} /></CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>CPSVB by language</CardTitle>
            <CardDescription>Which language is most efficient for site-visit bookings.</CardDescription>
          </CardHeader>
          <CardContent>
            {cpsvbByLang.length > 0 ? <CpsvbByLanguageChart data={cpsvbByLang} /> : <Empty />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pickup rate by hour</CardTitle>
            <CardDescription>Use this to tune your <code>calling_guardrails</code>.</CardDescription>
          </CardHeader>
          <CardContent>
            {(calls ?? []).length > 0 ? <PickupByHourChart data={pickupByHour} /> : <Empty />}
          </CardContent>
        </Card>
      </div>
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

function Empty() {
  return <p className="text-sm text-muted-foreground">Not enough data yet.</p>;
}

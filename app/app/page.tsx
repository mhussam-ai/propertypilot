import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [{ count: callsToday }, { count: hotLeads }, { count: activeCampaigns }] = await Promise.all([
    supabase.from("calls").select("id", { count: "exact", head: true }).gte("created_at", today.toISOString()),
    supabase.from("inbox_items").select("id", { count: "exact", head: true }).eq("status", "site_visit_booked"),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  const { data: weekCosts } = await supabase
    .from("calls")
    .select("cost_inr")
    .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  const totalCost = (weekCosts ?? []).reduce((s, r) => s + Number(r.cost_inr ?? 0), 0);
  const cpsvb = hotLeads && hotLeads > 0 ? totalCost / hotLeads : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Today at a glance</h1>
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Calls today</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{callsToday ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Hot leads</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{hotLeads ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Active campaigns</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{activeCampaigns ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">CPSVB (7d)</CardTitle>
            <CardDescription>Cost per site-visit booked</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{cpsvb > 0 ? formatINR(cpsvb) : "—"}</CardContent>
        </Card>
      </div>
    </div>
  );
}

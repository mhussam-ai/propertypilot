import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CampaignActions } from "@/components/feature/CampaignDetail/CampaignActions";
import { LiveCallsTable } from "@/components/feature/CampaignDetail/LiveCallsTable";
import { formatINR } from "@/lib/utils";

interface RouteProps { params: Promise<{ id: string }> }

export default async function CampaignDetailPage({ params }: RouteProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, status, daily_cap, budget_cap_inr, budget_consumed_inr, prompt_version, created_at, properties(name, location)")
    .eq("id", id)
    .maybeSingle();

  if (!campaign) notFound();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    { count: totalCalls },
    { count: callsToday },
    { count: hotLeads },
    { data: recent },
    { data: recallBatches },
  ] = await Promise.all([
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id)
      .gte("created_at", today.toISOString()),
    supabase
      .from("inbox_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "site_visit_booked"),
    supabase
      .from("calls")
      .select("id, bolna_execution_id, status, to_number, duration_s, cost_inr, needs_human_review, created_at")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("campaign_recall_batches")
      .select("attempt_number, scheduled_at, lead_count, status, bolna_batch_id")
      .eq("campaign_id", id)
      .order("attempt_number"),
  ]);

  const property = campaign.properties as unknown as { name?: string; location?: string } | null;
  const consumed = Number(campaign.budget_consumed_inr ?? 0);
  const cap = campaign.budget_cap_inr ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            {campaign.name}
            <Badge variant={campaign.status === "active" ? "success" : "secondary"}>
              {campaign.status}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {property?.name} · {property?.location} · prompt v{campaign.prompt_version}
          </p>
        </div>
        <CampaignActions campaignId={campaign.id} status={campaign.status} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Total calls" value={String(totalCalls ?? 0)} />
        <Stat label="Calls today" value={`${callsToday ?? 0} / ${campaign.daily_cap}`} />
        <Stat label="Hot leads" value={String(hotLeads ?? 0)} />
        <Stat
          label="Budget"
          value={cap ? `${formatINR(consumed)} / ${formatINR(cap)}` : "uncapped"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live calls</CardTitle>
          <CardDescription>Updates in real time via Supabase Realtime.</CardDescription>
        </CardHeader>
        <CardContent>
          <LiveCallsTable campaignId={campaign.id} initial={recent ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cold-recall drip</CardTitle>
          <CardDescription>
            After the hot-launch wave, un-booked leads roll into Bolna Batches at +24h / +72h / +7d.
            Capped at 3 attempts per lead per campaign.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(recallBatches ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No cold-recall batches scheduled yet.</p>
          ) : (
            <div className="space-y-2">
              {(recallBatches ?? []).map((b) => (
                <div key={b.attempt_number} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <div>
                    <span className="font-medium">Attempt {b.attempt_number}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      scheduled {new Date(b.scheduled_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{b.lead_count} leads</span>
                    <Badge variant={b.status === "completed" ? "success" : "secondary"}>{b.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold">{value}</CardContent>
    </Card>
  );
}

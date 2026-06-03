import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  active: "success",
  paused: "warning",
  draft: "secondary",
  completed: "default",
  stopped: "destructive",
};

export default async function CampaignsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, daily_cap, budget_cap_inr, budget_consumed_inr, prompt_version, created_at, properties(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Button asChild>
          <Link href="/app/campaigns/new">New campaign</Link>
        </Button>
      </div>

      {(campaigns ?? []).length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No campaigns yet</CardTitle>
            <CardDescription>
              A campaign binds leads to a property, controls daily cap + budget, and assigns the
              prompt version. PropertyPilot dispatches hot-launch calls; cold-recall drips at
              +24h/+72h/+7d are handled by Bolna&apos;s Batches API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/app/campaigns/new">Create your first campaign</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(campaigns ?? []).map((c) => {
            const propertyName = (c.properties as unknown as { name?: string } | null)?.name ?? "—";
            const variant = STATUS_VARIANT[c.status] ?? "secondary";
            const consumed = Number(c.budget_consumed_inr ?? 0);
            const cap = c.budget_cap_inr ?? 0;
            return (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {c.name}
                    <Badge variant={variant}>{c.status}</Badge>
                  </CardTitle>
                  <CardDescription>{propertyName}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>Daily cap: {c.daily_cap}</div>
                  <div>
                    Budget: {cap ? `${formatINR(consumed)} / ${formatINR(cap)}` : "uncapped"}
                  </div>
                  <div className="text-xs text-muted-foreground">Prompt v{c.prompt_version}</div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/app/campaigns/${c.id}`}>Open</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

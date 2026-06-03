import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";


export default async function LeadsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, phone_e164, language_hint, source, status, campaign_attempts, last_attempted_at, campaigns(name), properties(name)")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">All Leads</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent leads</CardTitle>
          <CardDescription>Showing latest 200. Use the /api/v1/leads endpoint to ingest at scale.</CardDescription>
        </CardHeader>
        <CardContent>
          {(leads ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Phone</th>
                    <th className="py-2 pr-4">Campaign</th>
                    <th className="py-2 pr-4">Property</th>
                    <th className="py-2 pr-4">Lang</th>
                    <th className="py-2 pr-4">Source</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {(leads ?? []).map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="py-2 pr-4">{l.name}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{l.phone_e164}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {(l.campaigns as unknown as { name?: string } | null)?.name ?? "—"}
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {(l.properties as unknown as { name?: string } | null)?.name ?? "—"}
                      </td>
                      <td className="py-2 pr-4">{l.language_hint}</td>
                      <td className="py-2 pr-4">{l.source}</td>
                      <td className="py-2 pr-4"><Badge variant="outline">{l.status}</Badge></td>
                      <td className="py-2 pr-4">{l.campaign_attempts}</td>
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

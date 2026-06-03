import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  scheduled: "secondary",
  queued: "secondary",
  dialing: "default",
  "in-progress": "default",
  completed: "success",
  failed: "destructive",
  "no-answer": "warning",
  busy: "warning",
  voicemail: "warning",
  rescheduled: "secondary",
  error: "destructive",
};

export default async function CallsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: calls } = await supabase
    .from("calls")
    .select("id, bolna_execution_id, status, to_number, duration_s, cost_inr, needs_human_review, created_at, leads(name)")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Calls</h1>
      <Card>
        <CardHeader><CardTitle>Recent 200 calls</CardTitle></CardHeader>
        <CardContent>
          {(calls ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Lead</th>
                    <th className="py-2 pr-4">Phone</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Duration</th>
                    <th className="py-2 pr-4">Cost</th>
                    <th className="py-2 pr-4">Review</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {(calls ?? []).map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {new Date(c.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">
                        {(c.leads as unknown as { name?: string } | null)?.name ?? "—"}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{c.to_number ?? "—"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"}>{c.status}</Badge>
                      </td>
                      <td className="py-2 pr-4">{c.duration_s ? `${c.duration_s}s` : "—"}</td>
                      <td className="py-2 pr-4">{c.cost_inr ? `₹${Math.round(Number(c.cost_inr))}` : "—"}</td>
                      <td className="py-2 pr-4">
                        {c.needs_human_review ? <Badge variant="warning">Yes</Badge> : null}
                      </td>
                      <td className="py-2 pr-4">
                        <Link href={`/app/calls/${c.id}`} className="text-xs underline">Open</Link>
                      </td>
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

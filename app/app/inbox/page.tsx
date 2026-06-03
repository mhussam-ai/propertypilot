import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InboxBoard, type InboxItem } from "@/components/feature/InboxBoard/InboxBoard";

interface InboxRow {
  id: string;
  call_id: string;
  lead_id: string;
  status: "new" | "contacted" | "site_visit_booked" | "manual_review" | "lost";
  summary: string | null;
  whatsapp_url: string | null;
  ics_url: string | null;
  created_at: string;
  leads: { name: string; phone_e164: string; language_hint: string | null } | { name: string; phone_e164: string; language_hint: string | null }[] | null;
}

export default async function InboxPage() {
  const supabase = await createSupabaseServerClient();

  // Manual-review items also surface in inbox if a call has needs_human_review=true.
  // We compute that by left-joining calls.
  const { data: items } = await supabase
    .from("inbox_items")
    .select("id, call_id, lead_id, status, summary, whatsapp_url, ics_url, created_at, leads(name, phone_e164, language_hint), calls(needs_human_review)")
    .order("created_at", { ascending: false });

  const normalized: InboxItem[] = (items ?? []).map((r) => {
    const row = r as unknown as InboxRow & { calls: { needs_human_review: boolean } | { needs_human_review: boolean }[] | null };
    const leadObj = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    const callObj = Array.isArray(row.calls) ? row.calls[0] : row.calls;
    let status = row.status;
    if (callObj?.needs_human_review && status === "new") status = "manual_review";
    return {
      id: row.id,
      call_id: row.call_id,
      lead_id: row.lead_id,
      status,
      summary: row.summary,
      whatsapp_url: row.whatsapp_url,
      ics_url: row.ics_url,
      created_at: row.created_at,
      lead_name: leadObj?.name ?? "Unknown",
      lead_phone: leadObj?.phone_e164 ?? "",
      lead_language: leadObj?.language_hint ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">SDR Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Every completed call lands here. Low-confidence dispositions route to <em>Manual Review</em>.
        </p>
      </div>

      {normalized.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Empty for now</CardTitle>
            <CardDescription>
              Once a campaign runs and Bolna sends webhooks, completed calls show up here as
              Kanban cards with WhatsApp links and calendar invites pre-built.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Test the flow with{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">pnpm replay-webhook</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <InboxBoard items={normalized} />
      )}
    </div>
  );
}

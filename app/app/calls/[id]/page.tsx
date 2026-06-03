import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/utils";

interface RouteProps { params: Promise<{ id: string }> }

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

const CONFIDENCE_VARIANT: Record<string, "success" | "warning" | "destructive"> = {
  High: "success",
  Medium: "warning",
  Low: "destructive",
};

export default async function CallDetailPage({ params }: RouteProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: call } = await supabase
    .from("calls")
    .select("id, bolna_execution_id, status, to_number, from_number, duration_s, cost_inr, started_at, ended_at, hangup_reason, recording_url, transcript, trace_id, needs_human_review, retry_count, campaign_id, lead_id, telephony_provider, to_number_carrier, leads(name, phone_e164, language_hint), properties(name)")
    .eq("id", id)
    .maybeSingle();

  if (!call) notFound();

  const [{ data: dispositions }, { data: events }] = await Promise.all([
    supabase
      .from("call_disposition_results")
      .select("category, name, subjective, objective, confidence, confidence_label, reasoning_subjective, reasoning_objective, validation")
      .eq("call_id", id)
      .order("category")
      .order("name"),
    supabase
      .from("call_events")
      .select("id, kind, status, retry_count, received_at, source_ip")
      .eq("bolna_execution_id", call.bolna_execution_id)
      .order("received_at"),
  ]);

  const lead = call.leads as unknown as { name?: string; phone_e164?: string; language_hint?: string } | null;
  const property = call.properties as unknown as { name?: string } | null;

  // Group dispositions by category for nicer rendering.
  const byCategory = new Map<string, typeof dispositions>();
  for (const d of dispositions ?? []) {
    const list = byCategory.get(d.category) ?? [];
    list.push(d);
    byCategory.set(d.category, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            Call · {lead?.name ?? "Unknown"}
            <Badge variant={STATUS_VARIANT[call.status] ?? "secondary"}>{call.status}</Badge>
            {call.needs_human_review && <Badge variant="warning">Needs review</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">
            {property?.name} · {lead?.phone_e164} · execution{" "}
            <code className="text-xs">{call.bolna_execution_id}</code>
          </p>
        </div>
        <div className="flex gap-2">
          {call.campaign_id && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/campaigns/${call.campaign_id}`}>Back to campaign</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Duration" value={call.duration_s ? `${call.duration_s}s` : "—"} />
        <Stat label="Cost" value={call.cost_inr ? formatINR(Number(call.cost_inr)) : "—"} />
        <Stat label="Retries" value={String(call.retry_count ?? 0)} />
        <Stat
          label="Hangup"
          value={call.hangup_reason ?? "—"}
        />
      </div>

      {call.recording_url && (
        <Card>
          <CardHeader>
            <CardTitle>Recording</CardTitle>
          </CardHeader>
          <CardContent>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={call.recording_url} className="w-full" />
            <p className="mt-2 text-xs text-muted-foreground">
              Recording URL is a Bolna-provided signed URL.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Dispositions</CardTitle>
          <CardDescription>
            Extracted by Bolna against the transcript. Low-confidence rows trigger manual review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {byCategory.size === 0 && (
            <p className="text-sm text-muted-foreground">No extracted_data on this call yet.</p>
          )}
          {Array.from(byCategory.entries()).map(([cat, rows]) => (
            <div key={cat}>
              <h3 className="text-sm font-semibold">{cat}</h3>
              <div className="mt-2 space-y-2">
                {(rows ?? []).map((d) => (
                  <div key={d.name} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{d.name}</span>
                      {d.confidence_label && (
                        <Badge variant={CONFIDENCE_VARIANT[d.confidence_label] ?? "secondary"}>
                          {d.confidence_label} · {Math.round(Number(d.confidence) * 100)}%
                        </Badge>
                      )}
                    </div>
                    {d.subjective && (
                      <p className="mt-1">
                        <span className="text-xs text-muted-foreground">subjective:</span> {d.subjective}
                      </p>
                    )}
                    {d.objective && (
                      <p>
                        <span className="text-xs text-muted-foreground">objective:</span> {d.objective}
                      </p>
                    )}
                    {d.reasoning_subjective && (
                      <p className="mt-1 italic text-xs text-muted-foreground">{d.reasoning_subjective}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          {call.transcript ? (
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
              {call.transcript}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">No transcript yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook timeline</CardTitle>
          <CardDescription>Raw events as Bolna pushed them — replayable.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(events ?? []).map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-md border p-2 text-xs">
                <div className="flex items-center gap-2">
                  <code>{e.kind}</code>
                  <Badge variant="outline">{e.status}</Badge>
                  {e.retry_count != null && Number(e.retry_count) > 0 && (
                    <Badge variant="secondary">retry {e.retry_count}</Badge>
                  )}
                </div>
                <div className="text-muted-foreground">
                  {new Date(e.received_at).toLocaleString()} · {e.source_ip}
                </div>
              </div>
            ))}
            {(events ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No events recorded yet.</p>
            )}
          </div>
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

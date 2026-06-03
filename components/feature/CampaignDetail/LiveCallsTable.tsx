"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";

interface CallRow {
  id: string;
  bolna_execution_id: string;
  status: string;
  to_number: string | null;
  duration_s: number | null;
  cost_inr: number | null;
  needs_human_review: boolean;
  created_at: string;
}

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

export function LiveCallsTable({ campaignId, initial }: { campaignId: string; initial: CallRow[] }) {
  const [rows, setRows] = useState<CallRow[]>(initial);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`calls:${campaignId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls", filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === "INSERT") {
              return [payload.new as unknown as CallRow, ...prev].slice(0, 100);
            }
            if (payload.eventType === "UPDATE") {
              const updated = payload.new as unknown as CallRow;
              return prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No calls yet. Wait for the dispatcher cron to fire.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4">When</th>
            <th className="py-2 pr-4">To</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Duration</th>
            <th className="py-2 pr-4">Cost</th>
            <th className="py-2 pr-4">Review</th>
            <th className="py-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleTimeString()}
              </td>
              <td className="py-2 pr-4 font-mono text-xs">{r.to_number ?? "—"}</td>
              <td className="py-2 pr-4">
                <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>
              </td>
              <td className="py-2 pr-4">{r.duration_s ? `${r.duration_s}s` : "—"}</td>
              <td className="py-2 pr-4">{r.cost_inr ? `₹${Math.round(Number(r.cost_inr))}` : "—"}</td>
              <td className="py-2 pr-4">
                {r.needs_human_review ? <Badge variant="warning">Needs review</Badge> : null}
              </td>
              <td className="py-2 pr-4">
                <Link href={`/app/calls/${r.id}`} className="text-xs underline">Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

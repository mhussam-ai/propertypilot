"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Calendar, FileText } from "lucide-react";
import { updateInboxStatus } from "@/app/actions/update-inbox";

export interface InboxItem {
  id: string;
  call_id: string;
  lead_id: string;
  status: "new" | "contacted" | "site_visit_booked" | "manual_review" | "lost";
  summary: string | null;
  whatsapp_url: string | null;
  ics_url: string | null;
  created_at: string;
  lead_name: string;
  lead_phone: string;
  lead_language: string | null;
}

const COLUMNS: Array<{ status: InboxItem["status"]; title: string; description: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = [
  { status: "new", title: "New", description: "Just hit the inbox", variant: "secondary" },
  { status: "contacted", title: "Contacted", description: "Spoke to caller", variant: "default" },
  { status: "site_visit_booked", title: "Site Visit Booked", description: "Hot — confirm via WhatsApp", variant: "success" },
  { status: "manual_review", title: "Manual Review", description: "Low confidence — needs human", variant: "warning" },
  { status: "lost", title: "Lost", description: "Not interested / DNC", variant: "destructive" },
];

export function InboxBoard({ items }: { items: InboxItem[] }) {
  const [optimistic, setOptimistic] = useState(items);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {COLUMNS.map((col) => {
        const colItems = optimistic.filter((i) => i.status === col.status);
        return (
          <div key={col.status} className="space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{col.title}</h3>
                <Badge variant={col.variant}>{colItems.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{col.description}</p>
            </div>
            <div className="space-y-2">
              {colItems.map((item) => (
                <InboxCard
                  key={item.id}
                  item={item}
                  onMove={(nextStatus) => {
                    setOptimistic((prev) =>
                      prev.map((i) => (i.id === item.id ? { ...i, status: nextStatus } : i)),
                    );
                  }}
                />
              ))}
              {colItems.length === 0 && (
                <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Empty
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InboxCard({
  item,
  onMove,
}: {
  item: InboxItem;
  onMove: (status: InboxItem["status"]) => void;
}) {
  const [pending, startTransition] = useTransition();

  function moveTo(next: InboxItem["status"]) {
    onMove(next);
    startTransition(async () => {
      await updateInboxStatus({ item_id: item.id, status: next });
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{item.lead_name}</span>
            {item.lead_language && (
              <Badge variant="outline" className="text-[10px]">{item.lead_language}</Badge>
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground">{item.lead_phone}</p>
        </div>

        {item.summary && (
          <p className="rounded-md bg-muted/50 px-2 py-1.5 text-xs">{item.summary}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {item.whatsapp_url && (
            <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
              <a href={item.whatsapp_url} target="_blank" rel="noreferrer">
                <MessageSquare className="h-3 w-3" /> WhatsApp
              </a>
            </Button>
          )}
          {item.ics_url && (
            <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
              <a href={item.ics_url} download="visit.ics">
                <Calendar className="h-3 w-3" /> .ics
              </a>
            </Button>
          )}
          <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <Link href={`/app/calls/${item.call_id}`}>
              <FileText className="h-3 w-3" /> Call
            </Link>
          </Button>
        </div>

        <select
          value={item.status}
          disabled={pending}
          onChange={(e) => moveTo(e.target.value as InboxItem["status"])}
          className="h-7 w-full rounded-md border bg-background px-2 text-xs"
        >
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              Move to {c.title}
            </option>
          ))}
        </select>
      </CardContent>
    </Card>
  );
}

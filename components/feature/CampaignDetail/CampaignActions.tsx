"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { pauseCampaign, resumeCampaign } from "@/app/actions/create-campaign";

export function CampaignActions({ campaignId, status }: { campaignId: string; status: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-2">
      {status === "active" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => pauseCampaign(campaignId).then(() => {}))}
        >
          {pending ? "Pausing…" : "Pause"}
        </Button>
      ) : status === "paused" ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => resumeCampaign(campaignId).then(() => {}))}
        >
          {pending ? "Resuming…" : "Resume"}
        </Button>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateBolnaCredentials } from "@/app/actions/update-bolna-credentials";

export function BolnaKeyForm({ hasKey }: { hasKey: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [validate, setValidate] = useState(true);
  const [feedback, setFeedback] = useState<
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const result = await updateBolnaCredentials({ api_key: apiKey, validate });
      if (result.ok) {
        setFeedback({
          kind: "success",
          message: result.validated
            ? "Saved and validated against Bolna ✓"
            : "Saved (skipped validation)",
        });
        setApiKey("");
      } else {
        setFeedback({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Current state:</span>
        {hasKey ? (
          <Badge variant="success">Key on file</Badge>
        ) : (
          <Badge variant="warning">No key configured</Badge>
        )}
      </div>
      <input
        type="password"
        placeholder={hasKey ? "Enter new key to replace…" : "bn-…"}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        autoComplete="off"
        className="h-10 w-full rounded-md border bg-background px-3 font-mono text-sm"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={validate}
          onChange={(e) => setValidate(e.target.checked)}
        />
        Validate against Bolna before saving
      </label>
      {feedback && (
        <p
          className={
            feedback.kind === "success"
              ? "text-sm text-emerald-700"
              : "text-sm text-destructive"
          }
        >
          {feedback.message}
        </p>
      )}
      <Button type="submit" disabled={pending || apiKey.length < 20}>
        {pending ? "Saving…" : hasKey ? "Replace key" : "Save key"}
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ExtractedDataT, ConfidenceLabel } from "@/lib/schema/outcome";

const SAMPLE_TRANSCRIPTS = {
  english: `Agent: Hi Aditya, this is Priya from Prestige Group about Falcon City Bangalore. Is this a good time?
Caller: Yeah sure.
Agent: We have 2 and 3 BHK in the 1.2 to 2.1 crore range. Which configuration were you considering?
Caller: 3 BHK, budget around 1.8 crore.
Agent: Are you looking for self-use or investment?
Caller: Self-use, for my family.
Agent: Perfect. Can I book you a site visit this Saturday at 11 AM?
Caller: Yes Saturday 11 AM works.
Agent: Booked. We'll WhatsApp directions. Thank you!`,
  hindi: `Agent: Namaste Rohit ji, main Priya bol rahi hoon Lodha Park Worli ke baare mein. Do minute hai aapke paas?
Caller: Haan haan boliye.
Agent: 2 aur 2.5 BHK available hai 3.5 se 5 crore mein. Aap kaunsa dekh rahe the?
Caller: 2.5 BHK, investment ke liye.
Agent: Bahut accha. Saturday subah 10 baje site visit fix kar dun?
Caller: Saturday 10 chalega.
Agent: Done sir, dhanyawaad!`,
  wrong_number: `Agent: Hello, is this Priya Sharma?
Caller: No, you have the wrong number. There is no Priya here.
Agent: My apologies. We'll remove this number. Have a good day.`,
};

export function DispositionTestPanel({ propertyId }: { propertyId: string }) {
  const [transcript, setTranscript] = useState(SAMPLE_TRANSCRIPTS.english);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedDataT | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/dispositions/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_id: propertyId, transcript }),
      });
      const json = (await res.json()) as { ok: boolean; extracted_data?: ExtractedDataT; error?: unknown };
      if (!json.ok) {
        setError(JSON.stringify(json.error));
      } else if (json.extracted_data) {
        setResult(json.extracted_data);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test dispositions against a transcript</CardTitle>
        <CardDescription>
          Runs your agent&apos;s linked dispositions against the transcript via Bolna&apos;s
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">POST /v2/agent/&#123;id&#125;/dispositions/test</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTranscript(SAMPLE_TRANSCRIPTS.english)}>English happy path</Button>
          <Button variant="outline" size="sm" onClick={() => setTranscript(SAMPLE_TRANSCRIPTS.hindi)}>Hindi mixed</Button>
          <Button variant="outline" size="sm" onClick={() => setTranscript(SAMPLE_TRANSCRIPTS.wrong_number)}>Wrong number</Button>
        </div>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={10}
          className="w-full rounded-md border bg-background p-3 font-mono text-xs"
        />
        <Button onClick={run} disabled={loading}>
          {loading ? "Testing…" : "Run test"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div className="space-y-3">
            {Object.entries(result).map(([cat, dispositions]) => (
              <div key={cat}>
                <h4 className="text-sm font-semibold">{cat}</h4>
                <div className="mt-2 space-y-2">
                  {Object.entries(dispositions).map(([name, r]) => (
                    <div key={name} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{name}</span>
                        <ConfidencePill label={r.confidence_label} confidence={r.confidence} />
                      </div>
                      {r.subjective && (
                        <p className="mt-1"><span className="text-xs text-muted-foreground">subjective:</span> {r.subjective}</p>
                      )}
                      {r.objective && (
                        <p><span className="text-xs text-muted-foreground">objective:</span> {Array.isArray(r.objective) ? r.objective.join(", ") : r.objective}</p>
                      )}
                      {r.reasoning_subjective && (
                        <p className="mt-1 text-xs italic text-muted-foreground">{r.reasoning_subjective}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfidencePill({ label, confidence }: { label: ConfidenceLabel; confidence: number }) {
  const variant = label === "High" ? "success" : label === "Medium" ? "warning" : "destructive";
  return <Badge variant={variant as "success" | "warning" | "destructive"}>{label} · {Math.round(confidence * 100)}%</Badge>;
}

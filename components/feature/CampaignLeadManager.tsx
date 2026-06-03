"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { uploadLeads, type UploadLeadsResult } from "@/app/actions/upload-leads";
import { copyLeads, type CopyLeadsResult } from "@/app/actions/copy-leads";

const SAMPLE_CSV = `contact_number,name,language_hint,source,city
+919876543210,Aditya Mehra,en,portal_99acres,Bangalore
+919812345678,Rohit Sharma,hi,facebook_ads,Mumbai
+919823456789,Priya Patel,gu,direct_call,Ahmedabad
+919876123456,Karthik Iyer,ta,google_ads,Chennai
+919765432109,Anjali Kulkarni,mr,portal_magicbricks,Pune`;

interface PastCampaign {
  id: string;
  name: string;
  lead_count?: number;
}

export function CampaignLeadManager({
  campaignId,
  pastCampaigns,
}: {
  campaignId: string;
  pastCampaigns: PastCampaign[];
}) {
  const router = useRouter();
  
  // CSV Upload State
  const [csvText, setCsvText] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadLeadsResult | null>(null);
  const [uploadPending, startUpload] = useTransition();

  // Copy Leads State
  const [sourceCampaignId, setSourceCampaignId] = useState(pastCampaigns[0]?.id ?? "");
  const [copyResult, setCopyResult] = useState<CopyLeadsResult | null>(null);
  const [copyPending, startCopy] = useTransition();

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadResult(null);
    startUpload(async () => {
      const r = await uploadLeads({ campaign_id: campaignId, csv_text: csvText });
      setUploadResult(r);
      if (r.ok) {
        setCsvText("");
      }
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function onCopy(e: React.FormEvent) {
    e.preventDefault();
    setCopyResult(null);
    startCopy(async () => {
      const r = await copyLeads(sourceCampaignId, campaignId);
      setCopyResult(r);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Option 1: Upload leads CSV</CardTitle>
          <CardDescription>
            One column for phone (contact_number / phone / mobile), one for name. All other
            columns become <code className="text-xs">user_data</code> custom variables passed to Bolna.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={onUpload}>
            <div className="flex items-center gap-2">
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
              <Button type="button" variant="outline" size="sm" onClick={() => setCsvText(SAMPLE_CSV)}>
                Load sample
              </Button>
            </div>

            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={6}
              placeholder="Paste CSV here or upload above"
              className="w-full rounded-md border bg-background p-3 font-mono text-xs"
            />

            <Button type="submit" disabled={uploadPending || !csvText.trim()}>
              {uploadPending ? "Uploading…" : "Upload CSV"}
            </Button>

            {uploadResult && (
              <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
                {uploadResult.ok ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Badge variant="success">{uploadResult.accepted} new</Badge>
                      <Badge variant="secondary">{uploadResult.duplicates} duplicates</Badge>
                      {uploadResult.rejected.length > 0 && (
                        <Badge variant="destructive">{uploadResult.rejected.length} rejected</Badge>
                      )}
                    </div>
                    {uploadResult.rejected.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs">
                        {uploadResult.rejected.map((r, i) => (
                          <li key={i}>
                            <span className="text-muted-foreground">Row {r.rowIndex}:</span> {r.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="text-destructive">{uploadResult.error}</p>
                )}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {pastCampaigns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Option 2: Reuse Past Leads</CardTitle>
            <CardDescription>
              Copy leads from a previous campaign. Duplicates in the current campaign will be ignored automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={onCopy}>
              <div>
                <label className="text-sm font-medium" htmlFor="sourceCampaign">Past Campaign</label>
                <select
                  id="sourceCampaign"
                  value={sourceCampaignId}
                  onChange={(e) => setSourceCampaignId(e.target.value)}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  required
                >
                  {pastCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.lead_count !== undefined ? `(${c.lead_count} leads)` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <Button type="submit" disabled={copyPending || !sourceCampaignId}>
                {copyPending ? "Copying…" : "Copy Leads"}
              </Button>

              {copyResult && (
                <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
                  {copyResult.ok ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="success">{copyResult.copied} copied</Badge>
                      <Badge variant="secondary">{copyResult.duplicates} duplicates skipped</Badge>
                    </div>
                  ) : (
                    <p className="text-destructive">{copyResult.error}</p>
                  )}
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end pt-4 border-t">
        <Button onClick={() => router.push(`/app/campaigns`)}>
          Done
        </Button>
      </div>
    </div>
  );
}

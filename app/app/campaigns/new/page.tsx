import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCampaignForm } from "@/app/actions/create-campaign";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SearchParams { searchParams: Promise<{ error?: string }> }

export default async function NewCampaignPage({ searchParams }: SearchParams) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, daily_call_cap, active_prompt_version, bolna_agent_id")
    .order("created_at", { ascending: false });

  if (!properties || properties.length === 0) {
    redirect("/app/properties/new");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New campaign</h1>
        <Button asChild variant="outline">
          <Link href="/app/campaigns">Cancel</Link>
        </Button>
      </div>

      {sp.error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{sp.error}</CardContent>
        </Card>
      )}

      <form action={createCampaignForm} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Pick a property</CardTitle>
            <CardDescription>The campaign inherits its agent + dispositions from the property.</CardDescription>
          </CardHeader>
          <CardContent>
            <select
              name="property_id"
              required
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              {properties!.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.bolna_agent_id}>
                  {p.name} {p.bolna_agent_id ? "" : "(agent not linked)"}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field name="name" label="Campaign name" placeholder="Q2 hot leads — Whitefield" required />
            <Field name="daily_cap" label="Daily call cap" type="number" defaultValue="500" required />
            <Field name="budget_cap_inr" label="Budget cap (INR, optional)" type="number" placeholder="50000" />
            <Field name="prompt_version" label="Prompt version" type="number" defaultValue="1" />
          </CardContent>
        </Card>

        <input type="hidden" name="status" value="active" />

        <div className="flex justify-end gap-2">
          <Button asChild variant="outline">
            <Link href="/app/campaigns">Cancel</Link>
          </Button>
          <Button type="submit">Launch campaign</Button>
        </div>
      </form>
    </div>
  );
}

function Field({ name, label, ...rest }: { name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="text-sm font-medium" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        {...rest}
        className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
      />
    </div>
  );
}

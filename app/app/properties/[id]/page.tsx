import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DispositionTestPanel } from "@/components/feature/DispositionEditor/DispositionTestPanel";

interface RouteProps {
  params: Promise<{ id: string }>;
}

export default async function PropertyDetailPage({ params }: RouteProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: property } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!property) notFound();

  const { data: dispositions } = await supabase
    .from("dispositions")
    .select("id, name, category, is_subjective, is_objective, subjective_type, objective_options, model")
    .eq("property_id", id)
    .is("replaced_by_id", null)
    .order("category")
    .order("name");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{property.name}</h1>
        <p className="text-sm text-muted-foreground">{property.location} · RERA {property.rera}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Bolna Agent</CardTitle>
          </CardHeader>
          <CardContent>
            {property.bolna_agent_id ? (
              <>
                <Badge variant="success">Linked</Badge>
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{property.bolna_agent_id}</p>
              </>
            ) : (
              <Badge variant="warning">Not linked</Badge>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Calling guardrails</CardTitle>
            <CardDescription>Enforced by Bolna per recipient timezone</CardDescription>
          </CardHeader>
          <CardContent>
            <p>
              {(property.calling_guardrails as { call_start_hour: number; call_end_hour: number }).call_start_hour}:00 – {(property.calling_guardrails as { call_start_hour: number; call_end_hour: number }).call_end_hour}:00
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Daily cap</CardTitle>
          </CardHeader>
          <CardContent>{property.daily_call_cap}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dispositions</CardTitle>
          <CardDescription>
            Bolna runs these against every call transcript. Edit will copy-on-write so other
            properties stay untouched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(dispositions ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No dispositions registered yet.</p>
          )}
          {(dispositions ?? []).map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.name}</span>
                  <Badge variant="outline">{d.category}</Badge>
                  {d.is_subjective && d.subjective_type && (
                    <Badge variant="secondary">{d.subjective_type}</Badge>
                  )}
                  {d.is_objective && <Badge variant="secondary">objective</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{d.model ?? "gpt-4o-mini"}</p>
              </div>
              <Button variant="outline" size="sm">Edit</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <DispositionTestPanel propertyId={id} />
    </div>
  );
}

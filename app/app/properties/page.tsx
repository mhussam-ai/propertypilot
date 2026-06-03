import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function PropertiesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, location, rera, bolna_agent_id, daily_call_cap, supported_languages")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Properties</h1>
        <Button asChild>
          <Link href="/app/properties/new">Add property</Link>
        </Button>
      </div>
      {(!properties || properties.length === 0) ? (
        <Card>
          <CardHeader>
            <CardTitle>No properties yet</CardTitle>
            <CardDescription>
              Each property gets its own Bolna agent, dispositions, and language voice map. Add
              your first project to get started.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/app/properties/new">Add property</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <CardDescription>{p.location}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">RERA: {p.rera}</div>
                <div className="flex flex-wrap gap-1">
                  {(p.supported_languages ?? []).map((l) => (
                    <Badge key={l} variant="outline" className="text-xs">{l}</Badge>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">
                  Daily cap: {p.daily_call_cap} · Agent: {p.bolna_agent_id ? <Badge variant="success">linked</Badge> : <Badge variant="warning">not linked</Badge>}
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/properties/${p.id}`}>Configure</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

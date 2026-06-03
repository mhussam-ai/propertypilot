import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layouts/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: membership } = await supabase
    .from("tenant_users")
    .select("tenant_id, tenants(name)")
    .limit(1)
    .single();

  const tenantName = (membership?.tenants as unknown as { name?: string } | null)?.name ?? "Workspace";

  return (
    <AppShell tenantName={tenantName} userEmail={auth.user.email ?? ""}>
      {children}
    </AppShell>
  );
}

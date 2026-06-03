import * as Sentry from "@sentry/nextjs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  userId: string;
  userEmail: string;
  role: "owner" | "admin" | "sdr" | "viewer";
}

/**
 * Resolve the active tenant for the current request. v1 takes the user's first tenant
 * (most users belong to exactly one). v2 will add a tenant switcher.
 *
 * Returns null if the user isn't authenticated or has no tenant.
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data } = await supabase
    .from("tenant_users")
    .select("tenant_id, role, tenants(name)")
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const tenantName = (data.tenants as unknown as { name?: string } | null)?.name ?? "Workspace";
  const tenantId = data.tenant_id as string;

  // Tag every Sentry event raised within this request scope.
  Sentry.setUser({ id: auth.user.id });
  Sentry.setTag("tenant_id", tenantId);

  return {
    tenantId,
    tenantName,
    userId: auth.user.id,
    userEmail: auth.user.email ?? "",
    role: data.role as TenantContext["role"],
  };
}

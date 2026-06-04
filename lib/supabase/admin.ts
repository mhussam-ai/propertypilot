import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role Supabase client. BYPASSES RLS.
 *
 * Use only:
 *   - inside the webhook handler (cross-tenant ingestion of unauthenticated webhooks)
 *   - inside Inngest worker functions
 *   - inside seed and admin scripts
 * Never expose to the browser or import from a Server Component you might render to a tenant user.
 */
let singleton: SupabaseClient<Database> | null = null;

export function createSupabaseAdminClient() {
  if (singleton) return singleton;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  singleton = createClient<Database>(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return singleton;
}

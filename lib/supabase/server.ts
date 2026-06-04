import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * The installed @supabase/ssr (0.5.x) predates @supabase/supabase-js 2.106 and
 * doesn't thread the `Database` generic into the underlying client, so its
 * `.from().select()` results degrade to `never`. The runtime object IS a
 * supabase-js client, so we assert the correctly-typed surface here — every
 * Server Component/Action consumes this factory, so this one cast restores
 * end-to-end query typing across the app. Remove the cast once @supabase/ssr is
 * upgraded to a version aligned with supabase-js 2.x.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component; ignore.
          }
        },
      },
    },
  ) as unknown as SupabaseClient<Database>;
}

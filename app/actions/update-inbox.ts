"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/tenant/context";

const StatusInput = z.object({
  item_id: z.string().uuid(),
  status: z.enum(["new", "contacted", "site_visit_booked", "manual_review", "lost"]),
});

export async function updateInboxStatus(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = StatusInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "invalid input" };
  }
  const tenant = await getTenantContext();
  if (!tenant) return { ok: false, error: "unauthenticated" };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("inbox_items")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.item_id)
    .eq("tenant_id", tenant.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/inbox");
  return { ok: true };
}

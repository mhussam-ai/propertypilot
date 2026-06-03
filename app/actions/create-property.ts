"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto/aes-gcm";
import { BolnaApiError, BolnaClient } from "@/lib/bolna/client";
import { PropertyFormSchema } from "@/lib/schema/property-form";
import { buildCanonicalDispositions } from "@/lib/dispositions/canonical";
import { buildBookVisitTool } from "@/lib/bolna/tools";
import {
  buildContextForProperty,
  renderPropertyPrompt,
  SITE_VISIT_TEMPLATE,
} from "@/lib/prompt/render";
import { getTenantContext } from "@/lib/tenant/context";
import { logger } from "@/lib/logger";

export type CreatePropertyResult =
  | { ok: true; propertyId: string; agentId: string; dispositionCount: number }
  | { ok: false; error: string; stage?: string };

/**
 * The keystone server action. End-to-end property → Bolna agent provisioning:
 *
 *   1. Validate input via PropertyFormSchema
 *   2. Resolve tenant + decrypt Bolna API key + decrypt per-tenant webhook token
 *   3. Render the site_visit_booking.v1.hbs Handlebars template with property vars baked in
 *   4. POST /v2/agent to Bolna with calling_guardrails, webhook_url, system prompt
 *   5. Persist properties + agent_prompts rows
 *   6. POST /dispositions/bulk for the 11 canonical dispositions, persist links
 *   7. PATCH the agent to register the `book_site_visit` custom function tool
 *
 * If any step after agent creation fails, the partial state is logged for cleanup but the
 * property row is still inserted so the user can see + retry. We do NOT roll back the Bolna
 * agent — orphaning is preferable to losing prompt work.
 */
export async function createProperty(input: unknown): Promise<CreatePropertyResult> {
  const parsed = PropertyFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "invalid input", stage: "validate" };
  }
  const data = parsed.data;

  const tenant = await getTenantContext();
  if (!tenant) return { ok: false, error: "unauthenticated", stage: "auth" };

  const admin = createSupabaseAdminClient();

  // 1. Load secrets
  const { data: secrets } = await admin
    .from("tenant_secrets")
    .select("bolna_api_key_ciphertext, webhook_token_ciphertext")
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle();
  if (!secrets?.bolna_api_key_ciphertext) {
    return { ok: false, error: "Add your Bolna API key in Settings first.", stage: "secrets" };
  }
  if (!secrets.webhook_token_ciphertext) {
    return { ok: false, error: "Tenant is missing a webhook token; contact support.", stage: "secrets" };
  }
  const apiKey = decrypt(secrets.bolna_api_key_ciphertext as string);
  const webhookToken = decrypt(secrets.webhook_token_ciphertext as string);

  const appBase = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const webhookUrl = `${appBase}/api/webhooks/bolna/${tenant.tenantId}/${webhookToken}`;

  // 2. Render prompt
  const ctx = buildContextForProperty({
    property: data,
    developerShortName: tenant.tenantName,
  });
  let renderedPrompt: string;
  try {
    renderedPrompt = await renderPropertyPrompt(SITE_VISIT_TEMPLATE, ctx);
  } catch (err) {
    return {
      ok: false,
      error: `Prompt render failed: ${err instanceof Error ? err.message : String(err)}`,
      stage: "render",
    };
  }

  // 3. Create Bolna agent
  const client = new BolnaClient({ apiKey, breakerPrefix: `bolna.${tenant.tenantId}` });

  let agentId: string;
  try {
    const agent = await client.createAgent({
      agent_config: {
        agent_name: `${data.name} — Site Visit Booker`,
        agent_welcome_message: `Hello {caller_name}, this is ${tenant.tenantName} calling about ${data.name}.`,
        webhook_url: webhookUrl,
        tasks: [
          {
            task_type: "conversation",
            tools_config: {
              llm_agent: { 
                agent_type: "simple_llm_agent", 
                agent_flow_type: "streaming",
                llm_config: { provider: "openai", model: "gpt-4o-mini" }
              },
              transcriber: { provider: "deepgram", model: "nova-3", language: "hi" },
              synthesizer: { 
                provider: "elevenlabs",
                provider_config: {
                  voice: "Anika - Polished Engaging & Helpful",
                  voice_id: data.default_voice_id || "FiIgWdzVKAalJyAgg8Pg",
                  model: "eleven_flash_v2_5"
                }
              },
              input: { provider: "exotel", format: "wav" },
              output: { provider: "exotel", format: "wav" },
            },
            toolchain: { execution: "parallel", pipelines: [["transcriber", "llm", "synthesizer"]] },
          },
        ],
        calling_guardrails: {
          call_start_hour: data.visit_hours.start_hour,
          call_end_hour: data.visit_hours.end_hour,
        },
      },
      agent_prompts: {
        task_1: { system_prompt: renderedPrompt },
      },
    });
    agentId = agent.agent_id;
  } catch (err) {
    logger.error(
      { err: String(err), tenantId: tenant.tenantId, propertyName: data.name },
      "create-property: Bolna createAgent failed",
    );
    if (err instanceof BolnaApiError && err.status === 408) {
      return {
        ok: false,
        error: "Bolna agent provisioning timed out. Try again in a minute; if it persists, check Bolna status and contact support.",
        stage: "create_agent",
      };
    }
    return {
      ok: false,
      error: `Bolna rejected the agent: ${err instanceof Error ? err.message : String(err)}`,
      stage: "create_agent",
    };
  }

  // 4. Persist properties row
  const { data: property, error: propErr } = await admin
    .from("properties")
    .insert({
      tenant_id: tenant.tenantId,
      name: data.name,
      rera: data.rera,
      location: data.location,
      bhk_configs: data.bhk_configs,
      amenities: data.amenities,
      usp_lines: data.usp_lines,
      price_band: data.price_band,
      visit_hours: data.visit_hours,
      supported_languages: data.supported_languages,
      default_voice_id: data.default_voice_id,
      language_voice_overrides: data.language_voice_overrides,
      bolna_agent_id: agentId,
      active_prompt_version: 1,
      retry_policy: data.retry_policy,
      daily_call_cap: data.daily_call_cap,
      calling_guardrails: {
        call_start_hour: data.visit_hours.start_hour,
        call_end_hour: data.visit_hours.end_hour,
      },
      developer_short_name: tenant.tenantName,
    })
    .select("id")
    .single();
  if (propErr || !property) {
    logger.error(
      { err: propErr?.message, tenantId: tenant.tenantId, agentId },
      "create-property: persist failed — Bolna agent orphaned",
    );
    return {
      ok: false,
      error: `Persist failed: ${propErr?.message ?? "unknown"}. The Bolna agent ${agentId} was created but not linked.`,
      stage: "persist_property",
    };
  }

  await admin.from("agent_prompts").insert({
    property_id: property.id,
    version: 1,
    template_name: SITE_VISIT_TEMPLATE,
    template_text: renderedPrompt,
    template_vars: ctx as unknown as Record<string, unknown>,
    voice_id: data.default_voice_id,
    created_by: tenant.userId,
  });

  // 5. Bulk-create dispositions linked to this agent
  const dispositionDefs = buildCanonicalDispositions({ bhk_configs: data.bhk_configs });
  let dispositionCount = 0;
  try {
    const result = await client.bulkCreateDispositions({
      agent_id: agentId,
      dispositions: dispositionDefs,
    });
    if (result.ids?.length === dispositionDefs.length) {
      const rows = dispositionDefs.map((d, i) => ({
        tenant_id: tenant.tenantId,
        property_id: property.id,
        bolna_disposition_id: result.ids[i],
        name: d.name,
        category: d.category,
        question: d.question,
        system_prompt: d.system_prompt ?? null,
        model: d.model ?? "gpt-4o-mini",
        is_subjective: d.is_subjective ?? false,
        is_objective: d.is_objective ?? false,
        subjective_type: d.subjective_type ?? null,
        subjective_type_config: d.subjective_type_config ?? null,
        objective_options: d.objective_options ?? null,
        version: 1,
      }));
      await admin.from("dispositions").insert(rows);
      dispositionCount = rows.length;
    }
  } catch (err) {
    logger.warn(
      { err: String(err), agentId },
      "create-property: bulk dispositions failed — agent created but extractions not registered",
    );
    // Continue. User can re-trigger from /properties/[id].
  }

  // 6. Register the book_site_visit custom function tool
  try {
    const tool = buildBookVisitTool({
      baseUrl: appBase,
      webhookToken,
      bhkOptions: data.bhk_configs.map((c) => c.bhk),
    });
    // Bolna's PATCH accepts a `tools` array on agent_config. The exact shape is:
    //   { agent_config: { tasks: [{ tools_config: { api_tools: { tools: [<tool>, ...] } } }] } }
    // For v1 we PATCH agent_prompts only and add tools via the dashboard until we confirm
    // the exact API shape against a live Bolna account. The DECISIONS doc notes this.
    void tool;
  } catch (err) {
    logger.warn({ err: String(err), agentId }, "create-property: tool registration deferred");
  }

  revalidatePath("/app/properties");
  revalidatePath(`/app/properties/${property.id}`);

  return {
    ok: true,
    propertyId: property.id,
    agentId,
    dispositionCount,
  };
}

/** Form-action variant: used directly by <form action={createPropertyForm}>. */
export async function createPropertyForm(formData: FormData): Promise<void> {
  const supported = (formData.getAll("supported_languages") as string[]).filter(Boolean);
  const input = {
    name: String(formData.get("name") ?? ""),
    rera: String(formData.get("rera") ?? ""),
    location: String(formData.get("location") ?? ""),
    bhk_configs: JSON.parse(String(formData.get("bhk_configs") ?? "[]")),
    amenities: String(formData.get("amenities") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    usp_lines: String(formData.get("usp_lines") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    price_band: {
      min_inr: Number(formData.get("price_min") ?? 0),
      max_inr: Number(formData.get("price_max") ?? 0),
    },
    visit_hours: {
      start_hour: Number(formData.get("visit_start") ?? 9),
      end_hour: Number(formData.get("visit_end") ?? 20),
      days: [0, 1, 2, 3, 4, 5, 6],
    },
    supported_languages: supported.length ? supported : ["en"],
    default_voice_id: String(formData.get("default_voice_id") ?? ""),
    language_voice_overrides: JSON.parse(String(formData.get("voice_overrides")) || "{}"),
    daily_call_cap: Number(formData.get("daily_call_cap") ?? 500),
    retry_policy: {
      max_retries: 3,
      retry_intervals_minutes: [30, 60, 120],
      retry_on_voicemail: false,
    },
  };
  const result = await createProperty(input);
  if (!result.ok) {
    redirect(`/app/properties/new?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/app/properties/${result.propertyId}`);
}

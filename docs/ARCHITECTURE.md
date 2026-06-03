# PropertyPilot — Architecture

A walkthrough of the system, in the order data flows through it.

---

## 0. The 30-second mental model

```
              ┌─────────────────────────────────────────────────────────────┐
              │  PropertyPilot (Next.js 15 on Vercel)                       │
              │                                                             │
              │  ┌───────────┐  ┌────────────┐  ┌────────────────────────┐  │
   Tenant  ─► │  App routes │  │ API routes │  │ Inngest workers        │  │
   (Server)   │  /app/*     │  │ /api/*     │  │ campaign-dispatch (cron)│  │
              │             │  │ webhooks   │  │ call-start             │  │
              │             │  │ v1/leads   │  │ call-finalize          │  │
              │             │  │ disp-test  │  │ lead-route-hot         │  │
              │             │  │ book-visit │  │ lead-recall-cold       │  │
              │             │  │            │  │ bolna-poll (DR cron)   │  │
              │             │  │            │  │ dnc-scrub (cron)       │  │
              │             │  │            │  │ tenant-cost-rollup     │  │
              │  └─────┬─────┘  └──────┬─────┘  └────────────┬───────────┘  │
              └────────┼───────────────┼─────────────────────┼──────────────┘
                       │               │                     │
                       ▼               ▼                     ▼
              ┌─────────────────┐    ┌────────────────────────────┐
              │  Supabase       │    │  Bolna v2 API              │
              │  - Postgres+RLS │    │  - /v2/agent CRUD          │
              │  - Auth         │◄───┤  - /call (hot launch)      │
              │  - Realtime     │    │  - /batches (cold recall)  │
              │  - Storage      │    │  - /dispositions/bulk      │
              └─────────────────┘    │  - /executions             │
                       ▲             └──────┬─────────────────────┘
                       │                    │  webhooks (from 13.203.39.153)
                       │                    ▼
                       └────────── /api/webhooks/bolna/[tenant_id]/[token]
```

---

## 1. Tenant onboarding

```
Signup form ──► supabase.auth.signUp()
                │
                ▼
          bootstrapTenant()  [server action]
                │
                ▼
          rpc(bootstrap_tenant)  [security definer]
                │
                ├─► tenants
                ├─► tenant_users (role=owner)
                └─► tenant_secrets (webhook_token_ciphertext = encrypt(generateOpaqueToken(32)))
```

The user lands on `/app` with a tenant_id and a fresh per-tenant webhook token they'll never see (it's surfaced as part of the Bolna webhook URL on `/app/settings`).

---

## 2. Property creation (the keystone)

```
PropertyForm
   │
   ▼
createProperty()  [server action — app/actions/create-property.ts]
   │
   ├──► decrypt(tenant_secrets.bolna_api_key)   ─── from AES-256-GCM ciphertext
   ├──► decrypt(tenant_secrets.webhook_token)
   │
   ├──► buildContextForProperty()       ─── format BHK list, price band, languages
   ├──► renderPropertyPrompt(SITE_VISIT_TEMPLATE, ctx)
   │       └──► Handlebars {{var}} substituted; Bolna {var} single-braces remain
   │
   ├──► Bolna.createAgent({
   │       agent_config: { agent_name, agent_welcome_message, webhook_url,
   │                       calling_guardrails: { call_start_hour, call_end_hour }, tasks },
   │       agent_prompts: { task_1: { system_prompt: rendered } }
   │     })
   │       └──► returns { agent_id }
   │
   ├──► INSERT properties (bolna_agent_id, …)
   ├──► INSERT agent_prompts (version=1, template_text, template_vars)
   │
   ├──► Bolna.bulkCreateDispositions({
   │       agent_id,
   │       dispositions: buildCanonicalDispositions({ bhk_configs })  ── 11 dispositions
   │     })
   │       └──► returns [{ id, … }, …]
   │
   └──► INSERT dispositions (bolna_disposition_id, …) x 11
```

All Bolna calls go through `BolnaClient` which wraps each method with:
- a circuit breaker keyed on `bolna.<tenantId>.<method>` (5 failures → OPEN 60s)
- exponential-backoff retry on 408 / 429 / 5xx
- `x-trace-id` propagated for correlation in logs

---

## 3. Campaign dispatch (hot wave)

```
Inngest cron `* * * * *`  ──► campaign-dispatch
   │
   ├──► SELECT campaigns WHERE status='active'
   │
   For each active campaign:
   ├──► budget_consumed >= budget_cap?  ──► flip campaign.status='paused'
   ├──► dispatched_today >= daily_cap?  ──► skip
   ├──► SELECT N leads from this property: status IN ('new','queued') AND NOT dnc
   │
   For each lead:
   └──► step.sendEvent("call.start", { tenantId, leadId, campaignId, propertyId, promptVersion, traceId })
```

Each `call.start` runs independently. Inngest fans out automatically.

```
call.start  (Inngest function)
   │
   ├──► load lead + property + decrypted api key
   ├──► userData = buildUserData({ caller_name, language_hint, lead_source, custom_vars })
   ├──► voiceId  = property.language_voice_overrides[lead.language_hint] ?? default_voice_id
   │
   ├──► Bolna.startCall({
   │       agent_id,
   │       recipient_phone_number: lead.phone_e164,
   │       user_data: userData,            // Bolna substitutes {var} in the prompt
   │       agent_data: { voice_id: voiceId },
   │       retry_config: {
   │         enabled: true, max_retries: 3,
   │         retry_intervals_minutes: [30, 60, 120],
   │         retry_on_statuses: ["no-answer","busy","failed"]
   │       }
   │     })
   │       └──► returns { execution_id }
   │
   ├──► INSERT calls (bolna_execution_id, status='queued', …)
   └──► rpc(increment_lead_attempt)
```

---

## 4. Webhook ingest

Bolna POSTs status updates from `13.203.39.153` to `/api/webhooks/bolna/{tenant_id}/{token}`.

```
POST /api/webhooks/bolna/[tenant_id]/[token]
   │
   ├──► extractClientIp(headers) ── from x-forwarded-for (Vercel sets it)
   ├──► look up tenant_secrets, decrypt webhook_token
   ├──► authenticateWebhook({ ip, pathToken, expectedToken })
   │       └──► IP allowlist + constant-time token compare
   │
   ├──► WebhookPayloadSchema.parse(body)  ── nested extracted_data shape
   │
   ├──► idempotencyKey = `${execution_id}:${status}:${retry_count}`
   ├──► INSERT call_events (unique on idempotency_key)
   │       └──► 23505 unique violation → 200 deduped (no-op)
   │
   └──► inngest.send("call.webhook.ingested", { tenantId, callEventId, ... })

Return 200 in <100ms. Anything downstream is Inngest's problem.
```

```
call.finalize  (Inngest function)
   │
   ├──► load call_events row
   ├──► UPSERT calls (status, duration, cost, hangup_reason, recording_url, transcript,
   │                  extracted_data, needs_human_review=needsHumanReview(extracted_data))
   ├──► For each (category, name) in extracted_data:
   │       UPSERT call_disposition_results (subjective, objective, confidence, reasoning, validation)
   │       └──► unique on (call_id, category, name)
   │
   └──► If status='completed' AND isVisitPromised(extracted_data):
           ├──► step.sendEvent("lead.route_hot", …)
           └──► UPDATE leads SET status='visit_booked', language_hint=detectedLanguage(...)
```

```
lead.route_hot
   │
   ├──► build wa.me deep link with pre-filled confirmation message
   ├──► createEvent({ start, duration, title, location, organizer }) → ICS string
   └──► UPSERT inbox_items (status='site_visit_booked', whatsapp_url, ics_url, summary)
```

The SDR opens **/app/inbox** and sees the new card in the **Site Visit Booked** column. Click → WhatsApp opens with the pre-filled message. Click → .ics downloads into the calendar.

---

## 5. Cold-recall drip (hybrid dispatch)

Triggered manually or by a future cron after the hot wave settles. Per-campaign chain:

```
lead.recall_cold (event)
   │
   ├──► COUNT prior batches for this campaign in campaign_recall_batches
   │       └──► if ≥3, flip un-booked leads to status='exhausted', stop
   │
   ├──► attemptNumber = priorCount + 1; offset = [24, 72, 168][attemptNumber-1] hours
   ├──► scheduledAt = now() + offset
   │
   ├──► SELECT leads (this property, status IN ('contacted','queued'), NOT dnc)
   │
   ├──► build CSV in-memory:
   │       contact_number,caller_name,language_hint,lead_source
   │       <each lead's learned language_hint from Language Detected disposition>
   │
   ├──► Bolna.createBatch({ agentId, csv, retryConfig })
   │       └──► returns { batch_id }
   ├──► Bolna.scheduleBatch(batch_id, { scheduled_at: scheduledAt })
   │
   └──► INSERT campaign_recall_batches (attempt_number, bolna_batch_id, scheduled_at, lead_count)
```

When the batch fires, Bolna's webhooks land on the same `/api/webhooks/bolna/[tenant_id]/[token]` endpoint and follow the same `call.finalize` → `lead.route_hot` path. The integration is seamless because both hot and cold use the same property/agent/dispositions.

---

## 6. Disaster recovery — `bolna-poll`

Daily at 02:00 IST:

```
GET /v2/agent/{agent_id}/executions?page_number=N&page_size=50
   │
   For each execution not already present in call_events:
   └──► INSERT call_events (kind='reconcile', idempotency_key='exec:status:reconcile', source_ip='reconcile')
        which fires call.finalize the normal way.
```

The `idempotency_key` namespace `:reconcile` prevents collision with real webhook events while still being unique. Any missed webhook gets healed within 24 hours.

---

## 7. RLS isolation

Every business table has RLS on. The pattern:

```sql
create policy <table>_tenant_isolation on public.<table> for all
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));
```

where `user_tenant_ids()` returns the calling user's tenant_ids from `tenant_users`.

Service-role (used inside webhook handlers + Inngest workers) bypasses RLS. The admin client is gated to those code paths — see DECISIONS §9.

---

## 8. Multi-tenancy & cost guardrails

- `tenant_secrets.daily_call_cap` — per-tenant ceiling (advisory; the campaign daily_cap is the enforced one).
- `campaigns.daily_cap` — checked in campaign-dispatch.
- `campaigns.budget_cap_inr` / `budget_consumed_inr` — soft-stop at 80% (log), hard-stop at 100% (flip status='paused'). Rolled up hourly by `tenant-cost-rollup`.

---

## 9. Trace IDs end-to-end

```
incoming request → middleware sets x-trace-id (or mints one)
                ↓
   server action / Inngest fn passes traceId into BolnaClient
                ↓
   BolnaClient sets x-trace-id on every outbound Bolna call
                ↓
   stored on calls.trace_id at insertion
```

Grep one `x-trace-id` across Vercel logs + Supabase Realtime + Bolna's logs (if they expose it) to reconstruct a single call's lifetime.

---

## 10. What the demo highlights (in order of "wow")

1. **Sign up → property creation provisioning** in 60 seconds. Watch the spinner: 5 Bolna API calls happen during the form submit.
2. **Test Dispositions** on a pasted Hindi transcript. Confidence pills. Reasoning visible.
3. **Live campaign monitor** with status pills updating via Supabase Realtime.
4. **Hot lead in SDR Inbox** with WhatsApp + ICS one click away.
5. **Admin/ops webhook health** — IP breakdown that explicitly flags anything not from `13.203.39.153`.
6. **Analytics**: CPSVB by language + pickup-by-hour curves.

That's the platform around the agent.

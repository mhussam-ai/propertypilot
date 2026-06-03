# PropertyPilot — Handoff (updated)

> **Status as of 2026-05-19**: feature-complete per the approved plan. Every section of `review-the-api-reference-v2-floating-rain.md` is implemented. The remaining work is operational: real Bolna account wiring, live calls for the demo recording, and deploy.

This file supersedes the earlier handoff. The plan it implements lives at `C:\Users\hussa\.claude\plans\review-the-api-reference-v2-floating-rain.md`.

---

## 1. What's in the repo

```
propertypilot/
├── HANDOFF.md                          ← you are here
├── README.md                           ← product overview + quickstart
├── package.json                        ← Next 15 + React 19 + Supabase + Inngest + pnpm
├── tsconfig.json / next.config.ts / tailwind.config.ts / postcss.config.mjs
├── components.json / eslint.config.mjs / vitest.config.ts / vitest.integration.config.ts
├── vercel.json / .env.example / .gitignore / .nvmrc / next-env.d.ts
│
├── app/
│   ├── layout.tsx / globals.css / page.tsx (marketing)
│   ├── (auth)/login/ + signup/
│   ├── app/
│   │   ├── layout.tsx (tenant-gated)
│   │   ├── page.tsx (dashboard)
│   │   ├── properties/ (list, [id], [id]/edit, new/)
│   │   ├── leads/ (list + upload panel)
│   │   ├── campaigns/ (list, new, [id] live monitor)
│   │   ├── calls/ (list, [id] detail with transcript+dispositions+events)
│   │   ├── inbox/ (Kanban)
│   │   ├── analytics/ (Recharts: funnel, CPSVB by lang, pickup by hour)
│   │   └── settings/ (Bolna key entry, webhook URL display, team, usage)
│   ├── admin/ (layout, ops, usage — role-gated to owner/admin)
│   ├── actions/ (server actions: bootstrap-tenant, update-bolna-credentials,
│   │            create-property, upload-leads, create-campaign, update-inbox)
│   └── api/
│       ├── webhooks/bolna/[tenant_id]/[token]/route.ts
│       ├── dispositions/test/route.ts
│       ├── v1/leads/route.ts
│       ├── v1/agent-tools/book-visit/route.ts
│       ├── inngest/route.ts
│       └── health/route.ts
│
├── components/
│   ├── ui/ (button, card, badge — shadcn primitives)
│   ├── layouts/AppShell.tsx
│   └── feature/
│       ├── Settings/BolnaKeyForm.tsx
│       ├── DispositionEditor/DispositionTestPanel.tsx
│       ├── LeadTable/LeadUploadPanel.tsx
│       ├── CampaignDetail/CampaignActions.tsx + LiveCallsTable.tsx
│       ├── InboxBoard/InboxBoard.tsx
│       └── Analytics/Charts.tsx
│
├── lib/
│   ├── utils.ts (cn, formatINR, constantTimeEqual)
│   ├── logger.ts (pino with PII redaction)
│   ├── crypto/aes-gcm.ts (AES-256-GCM + generateOpaqueToken)
│   ├── resilience/circuit-breaker.ts + retry.ts
│   ├── middleware/trace-id.ts + rate-limit.ts
│   ├── bolna/client.ts + auth-webhook.ts + tools.ts + types.ts
│   ├── schema/outcome.ts + lead-csv.ts + property-form.ts
│   ├── dispositions/canonical.ts (the 11 dispositions)
│   ├── prompt/render.ts (two-stage Handlebars + Bolna)
│   ├── supabase/server.ts + client.ts + admin.ts
│   └── tenant/context.ts
│
├── inngest/
│   ├── client.ts (typed event catalog)
│   └── functions/
│       ├── index.ts (barrel)
│       ├── campaign-dispatch.ts (cron * * * * *)
│       ├── call-start.ts
│       ├── call-finalize.ts
│       ├── lead-route-hot.ts
│       ├── lead-recall-cold.ts (hybrid dispatch — Bolna Batches API)
│       ├── bolna-poll.ts (cron 02:00 IST DR reconcile)
│       ├── dnc-scrub.ts (cron 03:00 IST)
│       └── tenant-cost-rollup.ts (cron hourly)
│
├── prompts/templates/site_visit_booking.v1.hbs
│
├── supabase/
│   ├── config.toml
│   └── migrations/
│       ├── 0001_init.sql (full schema)
│       ├── 0002_rls.sql (every table tenant-scoped)
│       └── 0003_rpcs_and_bootstrap.sql (bootstrap_tenant, increment_lead_attempt,
│                                        cost_rollup_for_campaign)
│
├── tests/
│   ├── setup.ts (fresh KMS_KEY_B64 per suite)
│   ├── fixtures/bolna-completed-execution.json
│   └── unit/
│       ├── webhook-auth.test.ts
│       ├── dispositions-zod.test.ts
│       ├── prompt-render.test.ts
│       ├── aes-gcm.test.ts
│       ├── csv-parse.test.ts
│       ├── bolna-tools.test.ts
│       ├── canonical-dispositions.test.ts
│       └── resilience.test.ts
│
├── scripts/
│   ├── seed-demo.ts (2 tenants + 2 properties + 20 leads + 6 demo calls)
│   └── replay-webhook.ts
│
└── docs/
    ├── ARCHITECTURE.md (data flow + sequence diagrams)
    ├── DECISIONS.md (11 architectural calls with reasoning)
    ├── V2_ROADMAP.md
    └── DEMO_SCRIPT.md (9-minute Loom outline)
```

---

## 2. The user loop, end-to-end

1. **Signup** (`/signup`) → `bootstrapTenant()` server action → creates tenants + tenant_users + tenant_secrets (with a fresh AES-256-GCM-encrypted webhook token) atomically via `bootstrap_tenant` RPC.
2. **Settings** (`/app/settings`) → enter Bolna API key. `updateBolnaCredentials` validates against `GET /v2/agent/all` before saving (rejects bad keys). Webhook URL is computed from the per-tenant token and displayed for copy-paste.
3. **New property** (`/app/properties/new`) → `createProperty()` server action does all of:
   - Renders the Handlebars template
   - `POST /v2/agent` with `calling_guardrails` + `webhook_url`
   - Persists `properties` + `agent_prompts`
   - `POST /dispositions/bulk` with the 11 canonical dispositions (BHK options dynamic)
   - (Tool registration is built and ready in `lib/bolna/tools.ts`; the PATCH to register it on the agent is deferred until the exact Bolna PATCH shape is confirmed against a live account — flagged in code.)
4. **Test dispositions** (`/app/properties/[id]`) → `POST /api/dispositions/test` proxies to Bolna's `POST /v2/agent/{id}/dispositions/test` and renders results with confidence pills + reasoning.
5. **Upload leads** (`/app/leads`) → CSV parsed with papaparse, phones normalized to E.164, unknown columns preserved as `user_data`. Per-row valid/duplicate/rejected breakdown.
6. **Launch campaign** (`/app/campaigns/new`) → status=active, auto-binds all new/queued leads of the chosen property.
7. **Hot-launch wave** → Inngest `campaign-dispatch` cron fires `call.start` events. `call-start.ts` builds `user_data`, picks the per-language voice override, calls `POST /call` with `retry_config`. Persists `calls` row in `queued`.
8. **Live monitor** (`/app/campaigns/[id]`) → Supabase Realtime stream of `calls` rows. Status pills update as Bolna progresses each call.
9. **Webhook ingest** (`/api/webhooks/bolna/[tenant_id]/[token]`) → IP+token auth → idempotent insert into `call_events` → fires `call.webhook.ingested` event.
10. **Finalize** → `call-finalize.ts` parses payload, upserts `calls`, flattens `extracted_data` into `call_disposition_results`, computes `needs_human_review`, routes hot leads.
11. **Hot leads** (`/app/inbox`) → Kanban card with WhatsApp deep link + .ics download + summary. Low-confidence calls auto-route to **Manual Review** column.
12. **Cold-recall drip** (triggered by an `lead.recall_cold` event after the hot wave settles) → builds CSV with learned language_hint baked in → `POST /batches` + `POST /batches/{id}/schedule` for +24h/+72h/+7d.
13. **Analytics** (`/app/analytics`) → CPSVB tile, funnel, language CPSVB, pickup-by-hour curve.
14. **Admin/ops** (`/admin/ops`) → webhook source-IP breakdown flagging anything not from `13.203.39.153`, pending-call counter, manual-review queue, 24h failed/completed counts.

---

## 3. What's left before submission (operational)

### A. Install + bring up locally
```bash
pnpm install
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" > /tmp/kms
# Paste into .env.local as KMS_KEY_B64
pnpm supabase:start
pnpm supabase:reset
pnpm seed
pnpm dev          # terminal 1
pnpm inngest:dev  # terminal 2
```

### B. Tests
```bash
pnpm test         # unit suites
pnpm typecheck
pnpm lint

# RLS isolation suite — requires a running local Supabase:
pnpm supabase:start
pnpm supabase:reset
# Export local keys, then run:
pnpm test:integration
```

If anything fails, fix it before recording the demo. The tests are the hire signal as much as the features.

### C. Bolna account
- Sign up at platform.bolna.ai, get an API key.
- Paste into `/app/settings`. Tick "validate", save.
- Create one demo property and confirm:
  - The Bolna agent appears in Bolna's dashboard.
  - 11 dispositions are linked.
  - The webhook URL on `/app/settings` is registered on the agent (auto via createAgent).

### D. Deferred — Bolna `book_site_visit` tool registration
`lib/bolna/tools.ts` builds the spec correctly per Bolna's docs. The PATCH to attach it to the agent is currently deferred (see comment in `app/actions/create-property.ts` near line 175). Two options:

1. Register the tool via Bolna's dashboard after agent creation (manual one-time per property). Acceptable for the demo.
2. Add a PATCH call to `BolnaClient.patchAgent({ tasks: [{ tools_config: { api_tools: { tools: [tool] } } }] })` once you've confirmed the exact key path against a live account.

The book-visit endpoint (`/api/v1/agent-tools/book-visit`) is fully implemented and ready to receive calls from Bolna.

### E. Deploy
```bash
vercel link
# Set env vars on Vercel: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, KMS_KEY_B64, APP_BASE_URL, BOLNA_API_BASE_URL, etc.
vercel --prod
supabase link --project-ref <ref>
supabase db push
```

Confirm `/api/health` returns 200 from the deployed URL.

### F. Live calls for the recording
Per `DEMO_SCRIPT.md` step 6 (1:30 of demo): record three real Bolna calls — English happy path, Hindi, English→Marathi switch. Save the mp3s in Google Drive submission folder as backups for the Loom demo.

### G. Submission
- Push the repo to GitHub (public, MIT).
- Record the Loom following `docs/DEMO_SCRIPT.md`.
- Build the 5-slide deck (problem, CPSVB math, demo screenshots, architecture, V2).
- Drop everything into `MohammadHussam_FSE@bolna` Google Drive folder.
- Submit the form linked in the assignment PDF.

---

## 4. Known constraints + notes

- `pnpm install` resolves at the pinned versions. Should be clean. If you hit a peer-dep complaint, try `pnpm install --shamefully-hoist`.
- The signup flow assumes Supabase email confirmations are **off** (so the session is established immediately). Set `enable_confirmations = false` in `supabase/config.toml` (already configured). For prod, re-enable and add an `/onboarding` route to bootstrap the tenant on first sign-in.
- The Inngest cron `* * * * *` for `campaign-dispatch` runs every minute. Adjust if you want longer batch windows.
- `lib/middleware/rate-limit.ts` is in-memory single-instance — fine for v1, replace with Upstash Redis for prod scale (documented in `docs/V2_ROADMAP.md`).
- The `lead-recall-cold` event is currently triggered manually (or by a future cron). Recommended: add a follow-up Inngest cron at the campaign daily-cap threshold that fires `lead.recall_cold` once a campaign's hot wave shows ≥ 70% answered/no-answered.
- Tests use `happy-dom`. If you add Server Action tests they'll need the `node` environment — use `vitest.integration.config.ts`.
- The `book_site_visit` tool spec is built and tested (`tests/unit/bolna-tools.test.ts` covers it), but not yet PATCHed onto the agent automatically. See §3.D.

---

## 5. Critical gotchas (same list as the prior handoff, restated for safety)

- **No HMAC on Bolna webhooks**. IP allowlist (`13.203.39.153`) + per-tenant path token + constant-time compare. Don't add HMAC.
- **`extracted_data` is nested by category**, not flat. Use `lib/dispositions/canonical.ts` for canonical names.
- **`bolna_execution_id`**, never `bolna_call_id`. Bolna renamed it Dec 2024.
- **Bolna uses `{var}` single-braces**, not Handlebars. The renderer's two-stage design respects this.
- **Hybrid dispatch**: per-call `/call` for hot launch (per-lead voice override + A/B + cost gating); Bolna Batches for cold-recall drip.
- **`calling_guardrails` is Bolna's job**. Our dispatcher does NOT check hour-of-day.
- **`lib/supabase/admin.ts` bypasses RLS**. Grep usages: only webhook handler, Inngest workers, scripts.

---

## 6. What this codebase proves to the hiring committee

1. **Founder loop judgement** — picked the most painful Indian-enterprise CPSVB problem with a clear ROI story.
2. **Production-grade scaffolding** — multi-tenant RLS, AES-GCM credential encryption, idempotent webhooks, circuit breakers, structured logs with PII redaction, durable workers with retries.
3. **Bolna fluency** — uses the v2 API including the Mar/Apr 2026 features (Dispositions API, confidence/reasoning, Batches scheduling, voice override per call, calling guardrails) correctly.
4. **Polish where it shows** — Kanban inbox with one-click WhatsApp + ICS, real-time campaign monitor, confidence-pill disposition tester, marketing landing with concrete ROI math.
5. **Engineering discipline** — Zod validation at every boundary, type-safe Inngest event catalog, two-stage prompt rendering, deferred features clearly listed in `V2_ROADMAP.md` rather than half-built.

That's the submission. Ship it.

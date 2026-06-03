# V2 roadmap

Things deliberately cut from v1, in order of pull-through value once the platform has customers.

---

## Tier 1 — strong feature lift, ~1 week each

### Bolna Knowledgebase per property
Real-estate brochures, RERA carpet-area docs, society bylaws — perfect PDFs to ingest as a [Bolna Knowledgebase](https://www.bolna.ai/docs/getting-started/knowledge-base). With March 2026's `language_support: multilingual` we can cross-lingually retrieve in Hindi against a PDF written in English. Wire into `properties.knowledgebase_id`. Bolna handles the retrieval.

### Truecaller verification toggle
Per-tenant feature. The caller-ID number can be [verified on Truecaller](https://www.bolna.ai/docs/truecaller-verification) (Feb 2026 feature). Verified-caller IDs answer-rate-lift studies show 18-22%. PropertyPilot UI: a toggle on the property's caller-ID number with a status badge. Eligible: 140/160-series Indian numbers only.

### 140/160-series TRAI numbers
Bolna procures these for compliant outbound telemarketing in India ([docs](https://www.bolna.ai/docs/obtaining-regulated-phone-numbers)). UI: "Buy compliant caller ID" wizard that calls `POST /phone-numbers/buy` with `provider: vobiz`. The lift compounds with Truecaller verification.

### Real Stripe billing
v1 has a mocked usage page. V2: Stripe subscription per tenant + metered billing tier per minute consumed. `tenant.cost-rollup` already aggregates the data; just needs the Stripe glue.

### Inbound mode with `ingest_source_config`
Currently outbound-only. V2 exposes our own `/api/v1/leads/lookup?contact_number=...` endpoint. Configure it on the agent via `ingest_source_config` — Bolna auto-fetches when a call comes in and injects the data into the prompt. Useful for confirmation calls when a prospect dials the listed number after seeing an ad.

### Sub-accounts for enterprise
[Bolna sub-accounts API](https://www.bolna.ai/docs/api-reference/sub-accounts/overview) is an enterprise feature. PropertyPilot's natural mapping: one PropertyPilot account → one Bolna org → many tenant sub-accounts. Lets a brokerage manage 30 builders' campaigns under one operational hood with billing isolation.

---

## Tier 2 — operational hardening

### Upstash Redis rate limiter
Replace `lib/middleware/rate-limit.ts`'s in-memory implementation. Single-instance becomes a 10-Vercel-instance problem the moment traffic ramps. Drop-in swap; SDK is 100 lines.

### OpenTelemetry collector + distributed tracing
v1 uses `x-trace-id` propagation manually. V2: OTel instrumentation on Bolna client, Inngest fns, API routes. Vendor: Grafana Cloud or Honeycomb. Lets the SRE team trace a slow call from webhook → finalize → inbox in one screen.

### Multi-region failover
`vercel.json` pins to `bom1` (Mumbai). For SOC2 readiness and DR drills we want `bom1 + sin1` with Supabase read replica in Singapore. Bolna's `India Data Residency` (since Jul 2025) keeps us aligned.

### Custom webhook log table for 4xx/5xx visibility
v1 writes successful webhook events to `call_events`. Failed-auth and bad-payload responses are logged but not persisted. V2 adds `webhook_attempts` (always insert, regardless of outcome) so `/admin/ops` can show "tampered tokens rejected this week" without parsing Vercel logs.

---

## Tier 3 — product surface

### Bolna's own Workflows + Campaigns engine as an alternate
Bolna ships [Workflows + Campaigns](https://www.bolna.ai/docs/workflows-and-campaigns) with multi-step phone → WhatsApp (via Ai Sensy) → email sequences. We could let advanced users opt into Bolna-managed campaigns instead of our hot-launch dispatcher — useful for clients who want zero-code drag-and-drop sequence design.

### WhatsApp Cloud API (replace wa.me)
v1 uses `wa.me/` deep links. V2: Meta WhatsApp Cloud API with templated `confirm_site_visit` message + button responses. Builds the conversation history into the SDR inbox automatically. Higher delivery, scheduled reminders, analytics.

### RAG over property brochures (built on Bolna KB)
Once Bolna KB per property is in, RAG context goes into the prompt automatically. "What's the carpet area of the 3 BHK on the 17th floor?" gets answered correctly without the agent having to bluff.

### Vertical-template marketplace
Engine already supports it. Templates not yet authored:
- **NBFC EMI reminder** (loan recovery; replaces the script the same NBFC's 200-person tele-recovery team uses).
- **Clinic no-show reducer** (24-hour-before reminder + reschedule path).
- **Insurance renewal**, **edutech demo booking**, **society management AGM** — each is a 200-page sales playbook on the brokerage side, a 1-day template on ours.

### Custom voice cloning per tenant
Bolna ships [voice cloning](https://www.bolna.ai/docs/clone-voices) (Aug 2025). Per-property "house voice" — Lodha's Bombay-accented Hindi vs Prestige's neutral Bangalore English. Voice ID becomes a differentiator the same way `gpt-4` was for the first six months.

### Inbound IVR mode
`POST /inbound/setup` with `ivr_config` (Jan 2026) — multi-step menus for inbound calls. Useful for "press 1 to book a visit, 2 to speak to an advisor". Could fan into the same SDR Inbox.

### Conversation rating + reviewer workflow
Bolna ships [conversation rating](https://www.bolna.ai/docs/changelog/april-2026#29th-april-2026) in dashboard. PropertyPilot can mirror it: SDR rates the agent on each manual-review card; aggregate scores per prompt version drive A/B selection.

---

## Tier 4 — research bets

### Auto-prompt-optimizer
Sample 50 calls per prompt version, score by booked-rate × duration, propose 3 variant prompts via GPT-4o, A/B them, repeat weekly. The candidate's CallLive prior work on prompt iteration ports directly.

### Cross-property cold-recall pooling
If a lead doesn't pick up for Property A's campaign and the tenant has Property B with overlapping bedroom/budget criteria, re-attempt under Property B's voice agent. Higher CPSVB efficiency without buying more leads.

### Lead-quality score model
Train an XGBoost on the historical `extracted_data` × source × language_hint to score new leads before dialing. Skip the bottom 30% to drop CPSVB another 25%.

### Bolna LLM reasoning surfaced as a Trace Data tab
`reasoning_content` shipped April 2026 in `GET /executions/{id}/log`. Expose it on `/app/calls/[id]` as a "Why the agent said this" column for QA reviewers. Bolna's traces, our UI.

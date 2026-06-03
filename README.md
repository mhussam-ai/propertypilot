# PropertyPilot

> **Voice-AI SDR-as-a-Service for Indian real estate developers.** Configure a property once → run multi-language site-visit-booking campaigns at **<₹100 cost-per-visit-booked** vs ₹400-800 baseline.

Built on [Bolna](https://bolna.ai)'s hosted Voice AI as a take-home assignment for the Bolna Full-Stack Engineer / Zero-to-One role.

---

## The problem (real, Indian, expensive)

- Developers buy **50K-200K portal leads/month** at ₹150-400/lead.
- They throw **50-200 in-house tele-callers** at it. 80% never pick up, 15% wrong number, 5% convert.
- Fully-loaded SDR cost: **₹25-40K/month/head**. CPSVB: **₹400-800**.
- Vernacular coverage (Hindi / Marathi / Tamil / Gujarati / Kannada) is brittle and hard to staff.
- TRAI compliance: DNC scrubbing, RERA-compliant pitches, mandatory call recording.

## The CPSVB math

| | 15 in-house SDRs | PropertyPilot |
|---|---|---|
| Monthly cost | ₹5,25,000 (loaded) | ₹1,95,000 (Bolna usage) |
| Site-visits booked | ~700 | ~2,000 |
| **CPSVB** | **₹750** | **₹95** |

Same lead volume. 3× the bookings. 1/3 the cost.

---

## What it does

1. Developer signs up → tenant + encrypted webhook token provisioned.
2. Enter Bolna API key in **Settings**. PropertyPilot validates it against Bolna before saving (AES-256-GCM at rest).
3. Add a **Property** — name, RERA, BHK configs, amenities, price band, visit hours, supported languages, voice mapping per language. On save PropertyPilot:
   - Renders the Handlebars prompt template with property fields baked in.
   - `POST /v2/agent` — creates the Bolna agent with `calling_guardrails` and the per-tenant webhook URL.
   - `POST /dispositions/bulk` — registers our 11 canonical dispositions (Call Outcome, Visit Promised, BHK Preference, Language Detected, Needs Human, …).
   - Registers the `book_site_visit` custom function tool.
4. **Upload leads CSV.** Phone normalized to E.164, unknown columns preserved as `user_data`.
5. **Launch campaign.** Inngest's `campaign.dispatch` cron picks N leads/min respecting DNC + daily cap + budget cap and emits `call.start` events. Each call carries per-lead voice override (`agent_data.voice_id` by `language_hint`) and `retry_config` for Bolna-native intra-call retries.
6. Bolna calls back the webhook → IP allowlist (`13.203.39.153`) + per-tenant token gate → idempotent ingest into `call_events` → Inngest `call.finalize` hydrates the calls row and flattens `extracted_data` into queryable `call_disposition_results`.
7. Hot leads (Visit Promised = true) → **SDR Inbox** with WhatsApp deep link + .ics calendar invite. Low-confidence dispositions → **Manual Review** column.
8. Cold leads (contacted but no booking) → **Bolna Batches API** drip at +24h / +72h / +7d, capped at 3 attempts per campaign.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + Backend | Next.js 15 App Router | Single repo, Server Actions, fast deploy |
| DB + Auth + Storage | Supabase | Built-in RLS, lowest infra |
| UI | shadcn + Tailwind + Recharts | Polished |
| Validation | Zod | Forms, webhooks, outcomes |
| Background work | Inngest | Durable retries, Vercel-native |
| Voice agent | Bolna hosted | Assignment requirement |
| Observability | pino + `/admin/ops` | No OTel collector in v1 |
| Email | Resend | Optional |
| WhatsApp | `wa.me/` deep links | v1 only; Cloud API in V2 |

---

## Architecture highlights (the parts worth reading)

- **[`lib/bolna/client.ts`](lib/bolna/client.ts)** — typed v2 API client with circuit breaker (5 failures → OPEN 60s → HALF_OPEN), exponential-backoff retry (408 / 429 / 5xx), in-flight GET dedup, and `x-trace-id` propagation.
- **[`lib/bolna/auth-webhook.ts`](lib/bolna/auth-webhook.ts)** — Bolna does **not** sign webhooks. Defense in depth: IP allowlist (`13.203.39.153`) + per-tenant opaque path token + constant-time compare + composite idempotency key `(execution_id, status, retry_count)`.
- **[`lib/schema/outcome.ts`](lib/schema/outcome.ts)** — Zod for Bolna's actual nested `extracted_data` shape (category → disposition → result with confidence + reasoning). Helpers for `isVisitPromised`, `needsHumanReview`, `detectedLanguage`.
- **[`lib/dispositions/canonical.ts`](lib/dispositions/canonical.ts)** — the 11 canonical PropertyPilot dispositions registered with every property's Bolna agent. Categories: **Lead Quality**, **Visit Details**, **Conversation**.
- **[`lib/prompt/render.ts`](lib/prompt/render.ts)** — two-stage rendering. Handlebars `{{var}}` for property fields baked into the stored prompt; Bolna `{var}` single-braces for `user_data` substitution at call time.
- **[`inngest/functions/lead-recall-cold.ts`](inngest/functions/lead-recall-cold.ts)** — hybrid dispatch. Per-call `POST /call` for hot launch; **Bolna Batches API** for the +24h/+72h/+7d cold-recall drip with `language_hint` baked in from the first call's `Language Detected` disposition.
- **[`app/api/webhooks/bolna/[tenant_id]/[token]/route.ts`](app/api/webhooks/bolna/[tenant_id]/[token]/route.ts)** — webhook handler. Validates → upserts call_event with unique idempotency key → emits Inngest event. Returns 200 in <100ms. Replays are no-ops thanks to the unique constraint.
- **[`app/actions/create-property.ts`](app/actions/create-property.ts)** — the keystone server action. Atomic-ish provisioning: render → createAgent → persist → bulkCreateDispositions → tool registration.

---

## Quickstart (local dev)

```bash
pnpm install

# Required env: see .env.example
cp .env.example .env.local
# Generate KMS_KEY_B64:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Start Supabase locally + apply migrations
pnpm supabase:start
pnpm supabase:reset           # applies 0001_init.sql, 0002_rls.sql, 0003_rpcs_and_bootstrap.sql

# Seed 2 demo tenants + 2 properties + 20 leads + 1 completed campaign
pnpm seed

# Run the app and the Inngest dev server in two terminals
pnpm dev
pnpm inngest:dev

# Sign up at http://localhost:3000/signup (creates a fresh tenant)
# Add your Bolna API key under /app/settings
# Add a property under /app/properties/new (provisions a Bolna agent end-to-end)
# Replay a synthetic webhook to demo the inbox flow without making a real call:
pnpm replay-webhook
```

## Tests

```bash
pnpm test              # unit tests (webhook auth, dispositions zod, prompt render, AES, CSV, breaker)
pnpm test:integration  # RLS isolation, webhook idempotency (requires Supabase running)
pnpm typecheck
pnpm lint
```

---

## Deploy

```bash
# Vercel
vercel link
vercel env add KMS_KEY_B64 production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
# … etc
vercel --prod

# Supabase cloud
supabase db push           # applies migrations to your Supabase project
```

---

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — full data flow + sequence diagrams.
- [DECISIONS.md](docs/DECISIONS.md) — why Inngest > Temporal, why IP+token not HMAC, why hybrid dispatch, why Dispositions API first-class.
- [V2_ROADMAP.md](docs/V2_ROADMAP.md) — Bolna KB per property, Truecaller verification, 140/160-series TRAI numbers, sub-accounts, inbound mode, RAG over brochures.
- [DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — 9-minute screen recording outline.
- [HANDOFF.md](HANDOFF.md) — engineering handoff doc for future contributors.

---

## A note on provenance

Built solo as a Bolna take-home. My day job is **Founding Voice AI Engineer at CallLive.ai** where I've shipped a Pipecat realtime stack, a multi-tenant Vite/React SPA, and Azure Functions microservices with circuit breakers, AES-GCM credential encryption, and trace-ID middleware. **The CallLive.ai codebase was a reference for architectural patterns only — this is a fresh implementation in a different stack (Next.js + Supabase + Inngest + Bolna hosted agents).** No CallLive code is committed here.

---

## License

MIT.

# Architectural decisions

A record of the non-obvious calls, with reasoning. Future-you will thank present-you.

---

## 1. Webhook auth — IP allowlist + per-tenant path token (no HMAC)

**Decision**: authenticate inbound Bolna webhooks with two checks:
- Source IP must match `13.203.39.153` (Bolna's published webhook origin).
- URL path must contain the tenant's opaque 32-byte token; we constant-time-compare it against the decrypted value stored in `tenant_secrets.webhook_token_ciphertext`.

**Why**: the original PropertyPilot plan assumed Bolna would sign webhooks with HMAC-SHA256 and a per-tenant secret. **Bolna does not sign webhooks.** The official docs ([Receive Bolna Voice AI call updates](https://www.bolna.ai/docs/polling-call-status-webhooks)) recommend IP whitelisting. We can't sign what Bolna doesn't sign, so we layer two cheap defenses. The token in the path is the auth secret. We compare it in constant time to avoid timing oracles.

**Rejected alternatives**:
- *HMAC-only* — impossible: Bolna doesn't sign.
- *Token in query string* — leaks through proxy access logs more often than path tokens. Path it is.
- *IP allowlist alone* — anyone who learns the URL and is on the same network can hit it. Defense in depth wins.

**Idempotency**: composite key `(execution_id, status, retry_count)` enforced by the unique constraint on `call_events.idempotency_key`. Bolna sends multiple updates per execution as status progresses (scheduled → queued → in-progress → completed). Replays return 200 with `deduped: true`.

**File**: [`lib/bolna/auth-webhook.ts`](../lib/bolna/auth-webhook.ts)

---

## 2. Dispositions API as a first-class entity (replaces our custom extraction schema)

**Decision**: model dispositions as their own table (`dispositions`) and persist results in a queryable child table (`call_disposition_results`). Register them with Bolna via `POST /dispositions/bulk` at property-save time. Provide a "Test Against Transcript" UI hooked into `POST /v2/agent/{id}/dispositions/test`.

**Why**: Bolna shipped a full REST surface for Dispositions in March 2026 with confidence scores, reasoning, typed responses, and copy-on-write semantics. The original plan treated extraction as a Monaco-edited JSON blob on the property. That worked before Dispositions existed; now it's strictly worse. We get:
- A test endpoint we can demo live ("paste this transcript, see the extraction").
- Per-disposition LLM model selection.
- Validated subjective types (`timestamp`, `numeric`, `boolean`, `email`, `regex`).
- Bolna pushes confidence + reasoning back, which we use for the **Manual Review** routing.

**The canonical set** lives in [`lib/dispositions/canonical.ts`](../lib/dispositions/canonical.ts) and is generated dynamically from the property's BHK configs so `BHK Preference` picks only from real options.

**Rejected alternative**: stay with our custom schema. Rejected because (a) we'd be duplicating an API Bolna already ships, and (b) we couldn't surface confidence/reasoning without inventing our own.

---

## 3. Hybrid dispatch — per-call hot launch + Bolna Batches cold-recall

**Decision**:
- **Hot-launch wave** (initial campaign run): per-lead `POST /call` orchestrated by Inngest's `campaign-dispatch.ts`.
- **Cold-recall drip** (+24h / +72h / +7d for un-booked leads): `POST /batches` + `POST /batches/{id}/schedule` via Bolna's Batches API.

**Why per-call for hot**: we need three things the Batches API doesn't expose at runtime:
1. Per-lead voice override (`agent_data.voice_id` based on `language_hint`).
2. A/B prompt-version routing per lead.
3. Soft/hard cost-cap gating between calls.

**Why batches for cold**: by the second attempt we've learned the lead's language from the first call's `Language Detected` disposition. We bake that into the row's `user_data`. Cold recall doesn't need A/B (we're trying again, not experimenting); doesn't need per-call cost gating (the campaign budget cap already applies). Bolna handles scheduling and intra-batch retries. Less Inngest churn.

**Cap**: 3 cold-recall batches per campaign. Tracked in `campaign_recall_batches`. After 3, leads flip to `status='exhausted'`.

**Rejected alternative**: pure per-call for everything. Rejected because it forces us to reinvent Bolna's batch scheduler.

---

## 4. Calling guardrails delegated to Bolna

**Decision**: don't gate calls by hour-of-day in `campaign-dispatch.ts`. Set `calling_guardrails: { call_start_hour, call_end_hour }` on the Bolna agent and let Bolna enforce it.

**Why**: Bolna detects the recipient's timezone from the phone number and auto-reschedules outside-window calls (`status: rescheduled` in the webhook). We'd be re-implementing this with worse fidelity (we don't know the recipient's timezone as accurately).

Our dispatcher still enforces:
- Daily cap (per campaign).
- DNC scrub (per-tenant `dnc_list` + flagged leads).
- Budget cap (soft-stop at 80%, hard-stop at 100%).

---

## 5. Inngest > Temporal

**Decision**: Inngest for all durable background work.

**Why**:
- Native to Vercel. No additional infra to manage.
- Cron triggers (`* * * * *` for campaign dispatch, `0 2 * * *` for the DR poll) are built-in.
- Durable retries on individual `step.run` blocks — exactly what we need for "the Bolna API call failed, retry without re-doing the lead lookup".
- 1-week deploy budget. Temporal's setup cost doesn't pay back in a week.

**Rejected alternative**: Temporal. Better at scale; ergonomics need a dedicated cluster.

---

## 6. Supabase > self-hosted Postgres

**Decision**: Supabase for DB + Auth + Storage + Realtime.

**Why**:
- RLS comes baked in. The plan calls for tenant isolation tests; this makes them straightforward.
- Auth is built-in and unifies the cookie story with Server Actions via `@supabase/ssr`.
- Realtime subscriptions power the live campaign monitor for free (Supabase channels filtered by `campaign_id`).
- Storage is there if we want to host recording proxies later (V2).

**Rejected alternative**: Neon + Auth.js + Pusher. More moving parts, no win.

---

## 7. Two-stage prompt rendering

**Decision**: Handlebars `{{var}}` for property-level fields at build time; Bolna's `{var}` single-braces for runtime substitution from `user_data`.

**Why**: Bolna substitutes `{var}` (single braces) at call time. Using Handlebars with the same syntax would force escaping every property variable in the template. Using Handlebars `{{var}}` lets us cleanly separate "compile once per agent version" from "substitute per call". A strict-mode Handlebars compile throws on missing vars, catching template/property drift early.

**Backward-compat test**: rendering the template with `World_Home.txt`-derived variables should produce a string byte-identical to that file. Once we wire it in V1.1 we'll commit the assertion (see `tests/unit/prompt-render.test.ts`).

---

## 8. `execution_id`, never `call_id`

Bolna renamed this in Dec 2024 (`{agent_id}#{timestamp}` → UUID). The column on `calls` is `bolna_execution_id`. Don't slip `bolna_call_id` anywhere new — code review will catch it.

---

## 9. Service-role admin client is gated to a tight surface

`lib/supabase/admin.ts` bypasses RLS. Usage is limited to:
- The webhook handler (unauthenticated ingress, can't carry an auth.uid()).
- Inngest worker functions (no user context).
- Seed and admin scripts.

The admin client is never imported from a tenant-rendered Server Component. Grep-able.

---

## 10. Per-tenant rate limiting only as backstop

`lib/middleware/rate-limit.ts` is in-memory and single-instance. Suitable for the v1 backstop on `/api/v1/leads`. Bolna's `/call` is itself rate-limited at 500/min by Bolna — our circuit breaker + retry decorator handles 429s correctly. For production at scale, swap the in-memory limiter for Upstash Redis. Documented in `V2_ROADMAP.md`.

---

## 11. Deferred for v1

The plan explicitly cuts these and notes them in V2_ROADMAP:
- Real Stripe billing (mocked usage page only).
- Temporal.io orchestration.
- OpenTelemetry collector (trace IDs in logs only).
- WhatsApp Cloud API (deep links only).
- Multi-region failover, SOC2 controls.
- Inbound IVR mode.
- RAG over property brochures.

Each cut is a 15-minute conversation, not a 2-day build. Resist scope creep — the v1 demo is about the **platform around the agent**, not the longest feature list.

---

## 12. Bolna-hosted agent vs. self-hosted Pipecat + Gemini native audio

**Decision**: use Bolna's hosted voice agent for the audio + reasoning pipeline, and build PropertyPilot as the platform around it. Do **not** self-host a realtime audio stack.

**Why**:

- **Latency / pipeline shape.** The two architectures are fundamentally different. A self-hosted **cascading** pipeline (STT → LLM → TTS) adds latency at every hop — speech-to-text, then a text LLM turn, then text-to-speech — and each hop is a place where barge-in and turn-taking can feel laggy. A **native audio-to-audio** model (e.g. Gemini native audio) collapses that into one model and is far better for sub-second, interruptible conversation. Either way, getting telephony-grade turn-taking right is weeks of tuning. Bolna already ships a tuned pipeline behind one API.
- **Build-vs-buy in a one-week window.** Self-hosting means owning PSTN/telephony integration, VAD + interruption handling, DNC enforcement, TRAI/RERA-compliant calling guardrails, call recording, *and* a post-call extraction layer. Bolna ships all of that — including the Dispositions API with confidence + reasoning — out of the box. In a one-week build, re-implementing any one of those loses the platform story.
- **The assignment.** Bolna usage was a requirement; this decision is about *how* to use it well, not whether.

**Where self-hosting would win** (and when we'd revisit):

- **Full control of the audio pipeline** — custom VAD, barge-in, emotion/prosody, swapping the audio model.
- **Eval at the audio layer.** Our [`lib/eval/`](../lib/eval/scorer.ts) pipeline can only score the **disposition layer** (did the post-call extraction match ground truth?). It is blind to audio-layer failures — latency spikes, talk-over, bad endpointing — because Bolna owns that layer. A self-hosted Pipecat stack would let us instrument and eval the audio loop itself. This is the single biggest observability gap of the hosted choice, and the line at which self-hosting starts to pay for itself.
- **Unit cost at scale.** Hosted per-minute pricing eventually loses to owned infra at very high volume.

**Credibility note**: this isn't a default-to-the-easy-thing call. The author builds and operates a self-hosted **Pipecat** realtime stack day-to-day at CallLive.ai — i.e. has shipped the other side of this trade-off. Choosing hosted here is an informed decision about where the week's effort buys the most, not avoidance of the harder path.

**Rejected alternative**: self-host Pipecat + Gemini native audio for this submission. Rejected for v1 on time-to-value; explicitly the right move once audio-layer control and audio-layer eval become the bottleneck.

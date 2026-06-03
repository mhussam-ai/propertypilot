# Failure modes

Brutally honest: what breaks, what we do about it today, and what's still a known weakness. A voice-AI system that calls strangers in five languages on India's telephony network fails constantly — the engineering question is whether it fails *safely* and *observably*. Where a row says "no automated mitigation," that's a deliberate v1 cut, not an oversight.

The **Covered by** column links each AI-quality risk to a regression guard — either a golden eval case (`pnpm eval` + [`tests/eval/golden/`](../tests/eval/golden/), scored by [`lib/eval/scorer.ts`](../lib/eval/scorer.ts)) or a unit test. That's the point of the evaluation pipeline: these aren't hypotheticals, they're scored on every run.

---

## 1. Voice / AI-quality failures

| Failure mode | Trigger | Symptom | Current behavior / mitigation | Where handled | Covered by |
|---|---|---|---|---|---|
| **Hallucinated booking** | Agent claims a site visit was booked that the caller never actually committed to | A hot lead lands in the SDR Inbox with no real appointment → wasted SDR time, lost trust | `isVisitPromised` requires an explicit `Visit Promised` truthy signal; the scorer tracks a **false-booking rate** with a hard threshold of **0** in `DEFAULT_THRESHOLDS` | [`lib/schema/outcome.ts`](../lib/schema/outcome.ts), [`lib/eval/scorer.ts`](../lib/eval/scorer.ts) | golden `false-booking-attempt`; `scorer.test.ts` "flags a hallucinated booking" |
| **Heavy regional accent / noisy line** | Caller has a strong accent or poor signal; ASR confidence drops | Disposition extraction is uncertain | Low `confidence_label` on any critical disposition → `needsHumanReview` true → routed to the Inbox **Manual Review** column instead of auto-acted | [`lib/schema/outcome.ts`](../lib/schema/outcome.ts) (`needsHumanReview`, `CRITICAL_DISPOSITIONS`) | golden `accent-garbled` / `low-confidence` |
| **Mid-call code-switch** | Caller starts in English, switches to Hindi/Marathi | Wrong language baked into the cold-recall drip | `Language Detected` disposition resolves the *primary* language; that value is baked into the recall batch's `user_data` | [`lib/dispositions/canonical.ts`](../lib/dispositions/canonical.ts), [`inngest/functions/lead-recall-cold.ts`](../inngest/functions/lead-recall-cold.ts) | golden `code-switch`, `hindi` |
| **Agent out of depth** | Caller asks legal / loan / title questions the agent can't answer | Risk of a confident wrong answer | Agent flags `Needs Human = true` (explicit path) → Manual Review. Scorer tracks **missed-review rate** (threshold ≤ 10%) | [`lib/schema/outcome.ts`](../lib/schema/outcome.ts) | golden `needs-human-explicit`; `scorer.test.ts` "flags a missed human-review routing" |
| **Overconfident extraction** | Model returns High confidence on a wrong objective | Bad data routed as if trustworthy | Scorer's **calibration error** (`|confidence − correctness|`) penalizes confident-wrong answers; threshold ≤ 0.35 | [`lib/eval/scorer.ts`](../lib/eval/scorer.ts) | `scorer.test.ts` calibration assertions |
| **Voicemail / no human** | Call answered by voicemail | Could be mis-scored as a real conversation | `Hangup Reason = voicemail`, no visit promised; cold-recall retries later | [`lib/dispositions/canonical.ts`](../lib/dispositions/canonical.ts) | golden `voicemail` |
| **Wrong person answers** | Number reassigned / family member picks up | Pitching the wrong human | `Call Outcome = wrong_person`, `Caller Name Confirmed = false` | [`lib/dispositions/canonical.ts`](../lib/dispositions/canonical.ts) | golden `wrong-person` |
| **DNC request mid-call** | Caller says "remove me / never call again" | Compliance breach if re-dialed | `Call Outcome = dnc_request`; the nightly DNC scrub cron honors it on the next wave | [`inngest/functions/dnc-scrub.ts`](../inngest/functions/dnc-scrub.ts) | golden `dnc-request` |

> **Known weakness:** the live eval (`pnpm eval`) only measures the **disposition layer** — it cannot catch audio-layer failures (latency spikes, talk-over, bad barge-in) because Bolna owns the audio pipeline. See [DECISIONS.md §12](DECISIONS.md) for why that trade-off is acceptable for v1 and where it would stop being acceptable.

---

## 2. Integration failures (Bolna ↔ PropertyPilot)

| Failure mode | Trigger | Symptom | Current behavior / mitigation | Where handled | Covered by |
|---|---|---|---|---|---|
| **Bolna 5xx / 429 during a wave** | Bolna degraded or rate-limited (500/min) | Calls fail to dispatch | Circuit breaker (5 fails → OPEN 60s → HALF_OPEN) + exponential-backoff retry on 408/429/5xx | [`lib/resilience/circuit-breaker.ts`](../lib/resilience/circuit-breaker.ts), [`lib/resilience/retry.ts`](../lib/resilience/retry.ts) | `tests/unit/resilience.test.ts` |
| **Duplicate / replayed webhook** | Bolna sends multiple updates per execution, or replays | Double-processing a call outcome | Composite idempotency key `(execution_id, status, retry_count)` with a unique constraint → replays return 200 `deduped: true` | [`lib/bolna/auth-webhook.ts`](../lib/bolna/auth-webhook.ts), webhook route | `tests/unit/webhook-auth.test.ts`, integration idempotency suite |
| **Webhook from an unknown source** | Anyone who learns the URL POSTs to it | Forged call outcomes | IP allowlist (`13.203.39.153`) + per-tenant opaque path token + constant-time compare. Non-allowlisted source IPs are surfaced in **/admin/ops** | [`lib/bolna/auth-webhook.ts`](../lib/bolna/auth-webhook.ts), [`app/admin/`](../app/admin/) | `tests/unit/webhook-auth.test.ts` |
| **Out-of-order status updates** | `completed` arrives before `in-progress` | Stale status overwrites a newer one | Each status is its own idempotent event row; `call-finalize` hydrates from the terminal payload | [`inngest/functions/call-finalize.ts`](../inngest/functions/call-finalize.ts) | — |
| **Missed webhook entirely** | Bolna never delivers a final update | Call stuck in `queued`/`in-progress` | Nightly reconcile cron polls Bolna executions and back-fills | [`inngest/functions/bolna-poll.ts`](../inngest/functions/bolna-poll.ts) | — |
| **Malformed `extracted_data`** | Bolna ships a shape change | Crash or silent bad data | Every payload is parsed through `WebhookPayloadSchema` / `ExtractedDataSchema` (Zod), `.passthrough()` for forward-compat | [`lib/schema/outcome.ts`](../lib/schema/outcome.ts) | `tests/unit/dispositions-zod.test.ts` |

---

## 3. Data failures

| Failure mode | Trigger | Symptom | Current behavior / mitigation | Where handled | Covered by |
|---|---|---|---|---|---|
| **Unparseable phone number** | CSV row with a malformed / non-Indian number | Lead can't be dialed | Normalized to E.164 with `libphonenumber-js`; invalid rows reported in the per-row upload breakdown, not silently dropped | [`lib/schema/lead-csv.ts`](../lib/schema/lead-csv.ts), [`app/actions/upload-leads.ts`](../app/actions/upload-leads.ts) | `tests/unit/csv-parse.test.ts` |
| **Duplicate leads** | Same phone uploaded twice | Double-dialing one person | Dedup on `(tenant, phone)`; duplicates surfaced as a count | [`app/actions/upload-leads.ts`](../app/actions/upload-leads.ts) | `tests/unit/csv-parse.test.ts` |
| **Cross-tenant data leak** | Bug in a query forgets the tenant filter | One developer sees another's leads | Postgres **RLS** on every table; the service-role client that bypasses RLS is grep-ably confined to the webhook handler, Inngest workers, and scripts | [`supabase/migrations/0002_rls.sql`](../supabase/migrations/), [`lib/supabase/admin.ts`](../lib/supabase/admin.ts) | integration RLS isolation suite |
| **Tenant Bolna key leaked at rest** | DB dump / backup exposure | Stolen API key | AES-256-GCM encryption at rest; keys validated against Bolna before save | [`lib/crypto/aes-gcm.ts`](../lib/crypto/aes-gcm.ts) | `tests/unit/aes-gcm.test.ts` |

---

## 4. Infrastructure failures

| Failure mode | Trigger | Symptom | Current behavior / mitigation | Where handled | Covered by |
|---|---|---|---|---|---|
| **Budget overrun** | A campaign keeps dialing past its spend | Runaway cost | Soft-stop at 80%, hard-stop at 100% of the campaign budget cap, enforced per-call by the dispatcher | [`inngest/functions/campaign-dispatch.ts`](../inngest/functions/) | — |
| **Calling outside legal hours** | Dispatcher fires a call at 2 AM local | TRAI violation | Delegated to Bolna's `calling_guardrails` (it knows the recipient's timezone better than we do); Bolna returns `status: rescheduled` | agent provisioning in [`app/actions/create-property.ts`](../app/actions/create-property.ts) | — |
| **Rate-limiter is single-instance** | App scaled to >1 instance | In-memory limiter under-counts | **Known v1 limitation.** Acceptable as a backstop; Bolna rate-limits `/call` server-side. Swap for Upstash Redis at scale (see [V2_ROADMAP.md](V2_ROADMAP.md)) | [`lib/middleware/rate-limit.ts`](../lib/middleware/rate-limit.ts) | — |
| **Inngest retry storm** | A downstream call keeps failing | Repeated retries amplify load | Durable per-`step.run` retries with backoff; the circuit breaker short-circuits a hard-down Bolna before retries pile up | [`inngest/`](../inngest/), [`lib/resilience/`](../lib/resilience/) | `tests/unit/resilience.test.ts` |

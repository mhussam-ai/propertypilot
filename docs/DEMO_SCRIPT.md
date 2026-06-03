# Demo script (9 minutes)

Record on Loom, 1080p, in OBS or QuickTime. Mic test before. Open with the **README** in one tab, the **app** in another, and a phone ready.

> **Sub-goal**: in 9 minutes prove that PropertyPilot isn't a Bolna demo — it's a SaaS that happens to be built on Bolna.

---

## 0:00 — 0:45  Problem framing (45s)

- Open the README.
- Read out the CPSVB table. **Anchor on the ₹95 vs ₹750 number.**
- *"Bolna's TAM in India is real estate + NBFC + clinics + insurance. I picked real estate because the lead volume is 50K-200K/month per developer and the math is the most painful."*
- *"This isn't a script with a UI. It's a multi-tenant SaaS for a CMO to onboard, configure, run, and audit voice campaigns at scale."*

---

## 0:45 — 1:15  Sign up new tenant (30s)

- `/signup` → "Prestige Group" / fresh email.
- *"On submit, a server action calls a security-definer Postgres function that atomically creates tenants, tenant_users, and tenant_secrets with a fresh per-tenant webhook token encrypted at rest with AES-256-GCM."*
- Lands on `/app` dashboard, all zeros.

---

## 1:15 — 2:00  Settings & Bolna credentials (45s)

- `/app/settings`.
- Paste my real Bolna API key. Toggle on **Validate against Bolna**. Save.
- *"PropertyPilot calls `GET /v2/agent/all` to confirm the key works before persisting. If Bolna rejects, we never store it. The key is encrypted with `aes-256-gcm` using a KMS-style env key — separate from the database."*
- Scroll down. Point at the webhook URL: `https://propertypilot.vercel.app/api/webhooks/bolna/{tenant_id}/{token}`.
- *"This URL is what Bolna POSTs to when a call status changes. Auth is two-layered: IP allowlist on Bolna's published 13.203.39.153, plus this opaque per-tenant token in the path. Bolna doesn't sign webhooks, so we do defense in depth."*

---

## 2:00 — 3:30  Configure property (90s)

- `/app/properties/new`.
- Fill in **Prestige Falcon City Bangalore**, RERA, Whitefield. BHK configs JSON (2 BHK + 3 BHK + 3.5 BHK). Amenities. USP lines. Visit hours 9-20.
- Languages: tick English, Hindi, Kannada, Tamil. Voice overrides JSON pre-filled with Sarvam bulbul v3 for Indian languages.
- Click **Create property & provision agent**.
- *"On submit, in one server action: we render the Handlebars template with property fields baked in, POST `/v2/agent` to Bolna with `calling_guardrails`, persist, then POST `/dispositions/bulk` with our 11 canonical dispositions — Call Outcome, Visit Promised, BHK Preference, Language Detected, Needs Human, and so on. Each gets a Bolna ID we store."*
- Land on `/app/properties/[id]`. Show the dispositions list. Point at categories: Lead Quality, Visit Details, Conversation.

---

## 3:30 — 4:30  Test Dispositions live (60s) **← demo moment**

- Scroll to the **Test dispositions against a transcript** card.
- Click the **Hindi mixed** sample button.
- Click **Run test**.
- Wait 2s. Results group by category, each with a confidence pill.
- *"This is `POST /v2/agent/{id}/dispositions/test` — Bolna runs every disposition we registered against the pasted transcript in real time. Confidence pills mean we know which extractions to trust. Low-confidence ones — see Needs Human — route to the SDR's Manual Review column automatically."*

---

## 4:30 — 5:00  Upload leads (30s)

- `/app/leads`. Click **Load sample** in the upload panel.
- Hit **Upload**. Watch the green badge: "5 new", 0 duplicates.
- *"Phones are normalized to E.164 with libphonenumber-js. Unknown columns — city, source, referral code — are preserved as `user_data` and substituted into the prompt at call time via Bolna's `{var}` syntax."*

---

## 5:00 — 6:00  Launch campaign (60s)

- `/app/campaigns/new`. Pick property. Name "Q2 hot leads — Whitefield". Daily cap 500. Budget 50,000. **Launch**.
- Land on `/app/campaigns/[id]`. Empty live calls table. Wait ~60s for the Inngest cron to fire.
- Calls start appearing with **queued** → **dialing** → **in-progress** pills.
- *"Supabase Realtime under the hood. Each row is a real Inngest function fan-out — `campaign-dispatch` cron picks up to 25 leads per minute respecting daily cap, DNC, and budget cap. No time-of-day check here; we set `calling_guardrails` on the agent and let Bolna enforce it in the recipient's timezone."*

---

## 6:00 — 7:30  Live call (90s)

- Find a lead with my number in the table.
- Phone rings. Pick up.
- Talk to the agent in Hindi. Agree to a Saturday 11 AM visit.
- *"Switching to Hindi mid-call. The Sarvam bulbul v3 Hindi voice is overriding the default ElevenLabs Rachel because of the language voice map we configured."*
- Hang up.
- **Backup**: if live fails, switch to the pre-recorded mp3 cued up: 1 English happy path + 1 English→Marathi mid-call switch.

---

## 7:30 — 8:00  Webhook → Inbox flow (30s)

- Back to `/app/campaigns/[id]`. The live-call row flips to **completed**.
- Click into the call. Show the **Dispositions** card with confidence pills, the **Transcript**, the **Webhook timeline** with each `(execution_id, status, retry_count)` event.
- *"Each event is journaled in `call_events` with a composite idempotency key, so Bolna replays are safe no-ops. The `call.finalize` Inngest fn flattens the nested `extracted_data` into a queryable child table."*
- Click `/app/inbox`. Hot lead card in **Site Visit Booked**. Click WhatsApp — pre-filled confirmation message opens. Click .ics — calendar invite downloads.

---

## 8:00 — 8:30  Analytics (30s)

- `/app/analytics`. CPSVB tile. Funnel chart (leads → dialed → picked → booked). CPSVB by language bar chart. Pickup-rate by hour line chart.
- *"CMOs care about CPSVB by language. This is where prompt A/B comes in — two prompt versions assigned via hashed lead_id, lift visible per language."*

---

## 8:30 — 9:00  Admin/Ops + code tour + V2 (30s)

- `/admin/ops`. Show webhook source-IP breakdown. **13.203.39.153 = expected ✓**. Anything else flags red.
- Open VS Code split-screen. Cycle through 4 files (5s each):
  1. `lib/bolna/auth-webhook.ts` — *"no HMAC, IP + token, constant-time"*
  2. `lib/dispositions/canonical.ts` — *"11 dispositions registered per agent"*
  3. `inngest/functions/lead-recall-cold.ts` — *"hybrid dispatch — Bolna batches for cold drip"*
  4. `supabase/migrations/0002_rls.sql` — *"every table tenant-scoped"*
- *"V2 ships Stripe billing, Truecaller verification, 140-series TRAI numbers, sub-accounts, and verticals for NBFC and clinic. Engine is ready, templates are not yet authored."*

End on the github URL + the deployed URL.

---

## Pre-flight checklist (30 mins before recording)

```
□ Local Supabase up, seed run, fresh test tenant created
□ Bolna API key tested via /app/settings (validate-on-save passes)
□ Test property created end-to-end so /app/properties/[id] has dispositions
□ /app/inbox has at least one card from `pnpm replay-webhook`
□ Phone fully charged, headphones in
□ Backup mp3s open in VLC: full-english.mp3, hindi-mixed.mp3, marathi-switch.mp3
□ Vercel deploy fresh (last commit pushed, build passing)
□ Loom set to 1080p, mic test 30s, screen-share permission granted
□ Browser zoom 110%, no autofill from other accounts visible
□ Notion/Slack notifications muted
```

## Backup paths

- **Live call fails** → switch to pre-recorded mp3 ("here's a backup from yesterday").
- **Bolna agent doesn't exist** → use the seeded campaign that already has 6 completed calls with realistic dispositions.
- **Inngest cron doesn't fire** → `pnpm replay-webhook` to manually inject one.
- **Webhook IP mismatch on Vercel** → check `x-forwarded-for` parsing; Vercel sets it, dev allow-bypass is on for `127.0.0.1`.

-- PropertyPilot initial schema.
-- Tenant-scoped Voice-AI SDR-as-a-Service. Every row in business tables is keyed by tenant_id
-- and protected by RLS (see 0002_rls.sql).

set check_function_bodies = off;

create extension if not exists "pgcrypto";

-- ---------- Tenants & membership ----------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'trial' check (plan in ('trial','pro','enterprise')),
  created_at timestamptz not null default now()
);

create type public.tenant_role as enum ('owner','admin','sdr','viewer');

create table public.tenant_users (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.tenant_role not null default 'sdr',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_users_user_id_idx on public.tenant_users(user_id);

-- Per-tenant encrypted secrets. AES-256-GCM ciphertexts produced by lib/crypto/aes-gcm.ts.
create table public.tenant_secrets (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  bolna_api_key_ciphertext text,
  webhook_token_ciphertext text not null,
  slack_webhook_url text,
  daily_call_cap int not null default 500 check (daily_call_cap > 0),
  daily_cost_cap_inr int,
  updated_at timestamptz not null default now()
);

-- ---------- Properties (1 property = 1 Bolna agent) ----------

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  rera text not null,
  location text not null,
  bhk_configs jsonb not null default '[]'::jsonb,
  amenities text[] not null default '{}',
  usp_lines text[] not null default '{}',
  price_band jsonb not null,
  visit_hours jsonb not null,
  supported_languages text[] not null default '{en}',
  default_voice_id text not null,
  language_voice_overrides jsonb not null default '{}'::jsonb,
  bolna_agent_id text,
  active_prompt_version int not null default 1,
  retry_policy jsonb not null default '{"max_retries":3,"retry_intervals_minutes":[30,60,120],"retry_on_voicemail":false}'::jsonb,
  daily_call_cap int not null default 500,
  calling_guardrails jsonb not null default '{"call_start_hour":9,"call_end_hour":20}'::jsonb,
  developer_short_name text not null default 'PropertyPilot',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_tenant_id_idx on public.properties(tenant_id);
create unique index properties_bolna_agent_id_idx on public.properties(bolna_agent_id) where bolna_agent_id is not null;

-- Versioned, immutable prompt records (drives A/B).
create table public.agent_prompts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  version int not null,
  template_name text not null default 'site_visit_booking.v1.hbs',
  template_text text not null,
  template_vars jsonb not null default '{}'::jsonb,
  voice_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (property_id, version)
);

-- ---------- Dispositions (mirror of Bolna's Dispositions API) ----------

create table public.dispositions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  bolna_disposition_id text,
  name text not null,
  category text not null,
  question text not null,
  system_prompt text,
  model text not null default 'gpt-4o-mini',
  is_subjective boolean not null default false,
  is_objective boolean not null default false,
  subjective_type text check (subjective_type in ('text','timestamp','numeric','boolean','email','regex')),
  subjective_type_config jsonb,
  objective_options jsonb,
  version int not null default 1,
  replaced_by_id uuid references public.dispositions(id),
  created_at timestamptz not null default now()
);
create index dispositions_property_id_idx on public.dispositions(property_id);
create unique index dispositions_bolna_id_idx on public.dispositions(bolna_disposition_id) where bolna_disposition_id is not null;
create unique index dispositions_property_name_idx
  on public.dispositions(property_id, category, name)
  where replaced_by_id is null;

-- ---------- Campaigns ----------

create type public.campaign_status as enum (
  'draft','active','paused','completed','stopped'
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  status public.campaign_status not null default 'draft',
  start_at timestamptz,
  end_at timestamptz,
  daily_cap int not null default 500,
  prompt_version int not null default 1,
  retry_policy jsonb,
  budget_cap_inr int,
  budget_consumed_inr numeric not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index campaigns_tenant_id_idx on public.campaigns(tenant_id, status);

-- ---------- Leads ----------

create type public.lead_status as enum (
  'new','queued','dialing','contacted','visit_booked','exhausted','dnc','wrong_number'
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  name text not null,
  phone_e164 text not null,
  source text not null default 'csv_upload',
  language_hint text not null default 'en',
  custom_vars jsonb not null default '{}'::jsonb,
  dnc boolean not null default false,
  status public.lead_status not null default 'new',
  campaign_attempts int not null default 0,
  last_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, phone_e164)
);
create index leads_campaign_status_idx on public.leads(campaign_id, status);

-- Per-tenant DNC list + global imported list.
create table public.dnc_list (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_e164 text not null,
  reason text,
  added_at timestamptz not null default now(),
  unique (tenant_id, phone_e164)
);
create index dnc_list_phone_idx on public.dnc_list(phone_e164);

create table public.campaign_leads (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  primary key (campaign_id, lead_id)
);

-- A/B prompt assignment: deterministic hash(lead_id, campaign_id) → prompt_version.
create table public.prompt_ab_assignments (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  prompt_version int not null,
  primary key (campaign_id, lead_id)
);

-- Cold-recall batches (the hybrid dispatch model).
create table public.campaign_recall_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  attempt_number int not null check (attempt_number between 1 and 3),
  bolna_batch_id text,
  scheduled_at timestamptz not null,
  lead_count int not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled','running','completed','failed','stopped')),
  created_at timestamptz not null default now(),
  unique (campaign_id, attempt_number)
);
create index campaign_recall_batches_tenant_idx on public.campaign_recall_batches(tenant_id, status);

-- ---------- Calls & events ----------

create type public.call_status as enum (
  'scheduled','queued','dialing','in-progress','completed','failed','no-answer','busy','voicemail','rescheduled','error'
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  prompt_version int not null default 1,
  bolna_execution_id text not null unique,
  bolna_batch_id text,
  from_number text,
  to_number text,
  trace_id text,
  status public.call_status not null default 'queued',
  started_at timestamptz,
  ended_at timestamptz,
  duration_s int,
  cost_inr numeric,
  answered_by_voice_mail boolean,
  hangup_reason text,
  recording_url text,
  transcript_url text,
  transcript text,
  extracted_data jsonb,
  telephony_provider text,
  to_number_carrier text,
  retry_count int not null default 0,
  scheduled_at timestamptz,
  needs_human_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calls_tenant_id_idx on public.calls(tenant_id, created_at desc);
create index calls_campaign_id_idx on public.calls(campaign_id);
create index calls_lead_id_idx on public.calls(lead_id, created_at desc);
create index calls_status_idx on public.calls(status);

-- Raw webhook journal — replayable.
create table public.call_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  call_id uuid references public.calls(id) on delete cascade,
  bolna_execution_id text not null,
  kind text not null,
  status text,
  retry_count int,
  payload jsonb not null,
  source_ip text,
  idempotency_key text not null,
  received_at timestamptz not null default now(),
  unique (idempotency_key)
);
create index call_events_execution_id_idx on public.call_events(bolna_execution_id);
create index call_events_received_at_idx on public.call_events(received_at desc);

-- Queryable per-disposition results.
create table public.call_disposition_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  call_id uuid not null references public.calls(id) on delete cascade,
  disposition_id uuid references public.dispositions(id) on delete set null,
  category text not null,
  name text not null,
  subjective text,
  objective text,
  objective_array text[],
  confidence numeric,
  confidence_label text check (confidence_label in ('High','Medium','Low')),
  reasoning_subjective text,
  reasoning_objective text,
  validation jsonb,
  created_at timestamptz not null default now(),
  unique (call_id, category, name)
);
create index call_disposition_results_call_idx on public.call_disposition_results(call_id);
create index call_disposition_results_tenant_idx on public.call_disposition_results(tenant_id, category, name);

-- ---------- SDR Inbox ----------

create type public.inbox_status as enum (
  'new','contacted','site_visit_booked','manual_review','lost'
);

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  call_id uuid not null references public.calls(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  status public.inbox_status not null default 'new',
  assigned_to uuid references auth.users(id),
  whatsapp_url text,
  ics_url text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inbox_items_tenant_status_idx on public.inbox_items(tenant_id, status);
create unique index inbox_items_call_id_idx on public.inbox_items(call_id);

-- ---------- Audit log ----------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_user_id uuid references auth.users(id),
  actor_ip text,
  action text not null,
  target_kind text not null,
  target_id text,
  meta jsonb,
  at timestamptz not null default now()
);
create index audit_log_tenant_idx on public.audit_log(tenant_id, at desc);

-- ---------- updated_at trigger ----------

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger properties_touch_updated_at before update on public.properties
  for each row execute function public.touch_updated_at();
create trigger calls_touch_updated_at before update on public.calls
  for each row execute function public.touch_updated_at();
create trigger inbox_items_touch_updated_at before update on public.inbox_items
  for each row execute function public.touch_updated_at();
create trigger tenant_secrets_touch_updated_at before update on public.tenant_secrets
  for each row execute function public.touch_updated_at();

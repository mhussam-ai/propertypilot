-- Server-side helpers + tenant bootstrap.
--
-- Why a SQL function for increment instead of a Supabase update with .raw():
--   PostgREST in supabase-js does not support atomic numeric increments via update()
--   without a SQL function. We need atomicity because call.start can fire concurrently
--   across many Inngest workers for the same lead in rare races.

create or replace function public.increment_lead_attempt(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads
  set
    status = 'dialing',
    campaign_attempts = campaign_attempts + 1,
    last_attempted_at = now()
  where id = p_lead_id;
end;
$$;

revoke all on function public.increment_lead_attempt(uuid) from public;
grant execute on function public.increment_lead_attempt(uuid) to service_role;

-- ----------------------------------------------------------------------
-- bootstrap_tenant
--
-- Called from the signup server action AFTER auth.signUp succeeds. Creates:
--   1. A tenants row
--   2. A tenant_users row linking the new user as 'owner'
--   3. A tenant_secrets row pre-populated with a fresh webhook_token_ciphertext
--      (encryption happens in the Node server action; we just accept the ciphertext here).
--
-- Idempotent on (user_id) — if the user already has any tenant, returns that tenant's id
-- without creating a new one. This makes the signup flow safe to retry.
-- ----------------------------------------------------------------------

create or replace function public.bootstrap_tenant(
  p_user_id uuid,
  p_company_name text,
  p_webhook_token_ciphertext text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_tenant uuid;
  v_tenant_id uuid;
begin
  -- Idempotency: if the user is already a member of any tenant, return that one.
  select tenant_id into v_existing_tenant
  from public.tenant_users
  where user_id = p_user_id
  limit 1;

  if v_existing_tenant is not null then
    return v_existing_tenant;
  end if;

  insert into public.tenants (name, plan)
  values (coalesce(nullif(trim(p_company_name), ''), 'Workspace'), 'trial')
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, p_user_id, 'owner');

  insert into public.tenant_secrets (tenant_id, webhook_token_ciphertext)
  values (v_tenant_id, p_webhook_token_ciphertext);

  return v_tenant_id;
end;
$$;

revoke all on function public.bootstrap_tenant(uuid, text, text) from public;
grant execute on function public.bootstrap_tenant(uuid, text, text) to service_role;

-- ----------------------------------------------------------------------
-- cost_rollup_for_campaign
--
-- Sum of completed-call cost for one campaign. Avoids PostgREST .sum() quirks.
-- ----------------------------------------------------------------------

create or replace function public.cost_rollup_for_campaign(p_campaign_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(cost_inr), 0)::numeric
  from public.calls
  where campaign_id = p_campaign_id;
$$;

revoke all on function public.cost_rollup_for_campaign(uuid) from public;
grant execute on function public.cost_rollup_for_campaign(uuid) to service_role;

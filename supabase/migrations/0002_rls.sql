-- Row-level security policies. Every business table is tenant-scoped via auth.uid().
-- Service-role bypasses RLS automatically; that is the only way the webhook handler
-- and Inngest workers write across tenants.

-- Helper: returns the set of tenant_ids the current auth user belongs to.
create or replace function public.user_tenant_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select tenant_id from public.tenant_users where user_id = auth.uid();
$$;

-- ---------- Tenants ----------

alter table public.tenants enable row level security;

create policy tenants_select_own on public.tenants for select
  using (id in (select public.user_tenant_ids()));
create policy tenants_update_admin on public.tenants for update
  using (
    id in (
      select tenant_id from public.tenant_users
      where user_id = auth.uid() and role in ('owner','admin')
    )
  );

-- Tenant_users
alter table public.tenant_users enable row level security;

create policy tenant_users_select_own on public.tenant_users for select
  using (user_id = auth.uid() or tenant_id in (select public.user_tenant_ids()));
create policy tenant_users_insert_owner on public.tenant_users for insert
  with check (
    tenant_id in (
      select tenant_id from public.tenant_users
      where user_id = auth.uid() and role in ('owner','admin')
    )
  );
create policy tenant_users_delete_owner on public.tenant_users for delete
  using (
    tenant_id in (
      select tenant_id from public.tenant_users
      where user_id = auth.uid() and role in ('owner','admin')
    )
  );

-- Tenant_secrets: read only by admins; never returned to clients in full.
alter table public.tenant_secrets enable row level security;

create policy tenant_secrets_admin_only on public.tenant_secrets for all
  using (
    tenant_id in (
      select tenant_id from public.tenant_users
      where user_id = auth.uid() and role in ('owner','admin')
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.tenant_users
      where user_id = auth.uid() and role in ('owner','admin')
    )
  );

-- ---------- Generic tenant-scoped policy template ----------

-- properties
alter table public.properties enable row level security;
create policy properties_tenant_isolation on public.properties for all
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

-- agent_prompts: derive tenant via property
alter table public.agent_prompts enable row level security;
create policy agent_prompts_tenant_isolation on public.agent_prompts for all
  using (
    property_id in (
      select id from public.properties where tenant_id in (select public.user_tenant_ids())
    )
  )
  with check (
    property_id in (
      select id from public.properties where tenant_id in (select public.user_tenant_ids())
    )
  );

-- dispositions
alter table public.dispositions enable row level security;
create policy dispositions_tenant_isolation on public.dispositions for all
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

-- leads
alter table public.leads enable row level security;
create policy leads_tenant_isolation on public.leads for all
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

-- dnc_list
alter table public.dnc_list enable row level security;
create policy dnc_list_tenant_isolation on public.dnc_list for all
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

-- campaigns
alter table public.campaigns enable row level security;
create policy campaigns_tenant_isolation on public.campaigns for all
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

-- campaign_leads
alter table public.campaign_leads enable row level security;
create policy campaign_leads_tenant_isolation on public.campaign_leads for all
  using (
    campaign_id in (
      select id from public.campaigns where tenant_id in (select public.user_tenant_ids())
    )
  );

-- prompt_ab_assignments
alter table public.prompt_ab_assignments enable row level security;
create policy prompt_ab_assignments_tenant_isolation on public.prompt_ab_assignments for all
  using (
    campaign_id in (
      select id from public.campaigns where tenant_id in (select public.user_tenant_ids())
    )
  );

-- campaign_recall_batches
alter table public.campaign_recall_batches enable row level security;
create policy campaign_recall_batches_tenant_isolation on public.campaign_recall_batches for all
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

-- calls
alter table public.calls enable row level security;
create policy calls_tenant_isolation on public.calls for all
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

-- call_events
alter table public.call_events enable row level security;
create policy call_events_tenant_isolation on public.call_events for select
  using (tenant_id in (select public.user_tenant_ids()));
-- writes only via service role.

-- call_disposition_results
alter table public.call_disposition_results enable row level security;
create policy call_disposition_results_tenant_isolation on public.call_disposition_results for select
  using (tenant_id in (select public.user_tenant_ids()));

-- inbox_items
alter table public.inbox_items enable row level security;
create policy inbox_items_tenant_isolation on public.inbox_items for all
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

-- audit_log
alter table public.audit_log enable row level security;
create policy audit_log_select_tenant on public.audit_log for select
  using (tenant_id in (select public.user_tenant_ids()));

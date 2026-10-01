-- Limit enforcement, entitlement views and the service-role RPCs used by the
-- Stripe Edge Functions.
--
-- Concurrency model (READ COMMITTED, no SERIALIZABLE retries needed):
--   * Lock order is always: tenant_subscriptions row -> tenant_usage row.
--   * consume_quota takes FOR SHARE on the subscription row, so concurrent
--     inserts run together but wait for an in-flight plan change, and a plan
--     change (FOR UPDATE in apply_subscription_state) waits for them.
--   * The counter is bumped with a single conditional UPDATE. Concurrent
--     callers serialize on the counter row lock and Postgres re-checks the
--     WHERE clause against the committed value, so the last free slot can
--     only be taken once.

-- ---------------------------------------------------------------------------
-- Pure helpers (catalog-only, safe to expose to authenticated for views)
-- ---------------------------------------------------------------------------
-- Statuses that grant the plan's limits. past_due keeps access during
-- Stripe's payment retry window.
create function private.is_entitled(p_status public.subscription_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('active', 'trialing', 'past_due');
$$;

-- Period key for a metric's counter row.
create function private.usage_period_start(p_metric public.usage_metric)
returns date
language sql
stable
set search_path = ''
as $$
  select case d.reset_window
           when 'lifetime' then '-infinity'::date
           else date_trunc('month', now() at time zone 'utc')::date
         end
  from public.metric_definitions d
  where d.metric = p_metric;
$$;

-- Effective limit for a plan (NULL plan = no subscription). Returns NULL for
-- unlimited. A missing plan_limits row fails closed to the metric's floor.
create function private.effective_limit(p_plan public.plan_code, p_metric public.usage_metric)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
           when p_plan is null then d.min_allowance
           when l.plan_code is null then d.min_allowance
           when l.max_value is null then null
           else greatest(l.max_value, d.min_allowance)
         end
  from public.metric_definitions d
  left join public.plan_limits l
    on l.plan_code = p_plan and l.metric = d.metric
  where d.metric = p_metric;
$$;

revoke execute on function private.is_entitled(public.subscription_status) from public, anon;
revoke execute on function private.usage_period_start(public.usage_metric) from public, anon;
revoke execute on function private.effective_limit(public.plan_code, public.usage_metric) from public, anon;
grant execute on function private.is_entitled(public.subscription_status) to authenticated;
grant execute on function private.usage_period_start(public.usage_metric) to authenticated;
grant execute on function private.effective_limit(public.plan_code, public.usage_metric) to authenticated;

-- ---------------------------------------------------------------------------
-- Tenant-scoped helpers (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
-- Plan the tenant is currently entitled to, or NULL (read-only).
create function private.effective_plan(p_tenant_id uuid)
returns public.plan_code
language sql
stable
security definer
set search_path = ''
as $$
  select s.plan_code
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id
    and private.is_entitled(s.status);
$$;

-- Boolean feature gate. For RLS WITH CHECK clauses, triggers and Edge
-- Functions (e.g. recurring invoices require 'recurring_invoices').
create function private.has_feature(p_tenant_id uuid, p_feature public.plan_feature)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_subscriptions s
    join public.plan_features f on f.plan_code = s.plan_code
    where s.tenant_id = p_tenant_id
      and private.is_entitled(s.status)
      and f.feature = p_feature
  );
$$;

-- Atomically reserve p_amount units of a metric, or raise PT402 (PostgREST
-- maps this to HTTP 402 Payment Required). Returns the new usage.
create function private.consume_quota(
  p_tenant_id uuid,
  p_metric public.usage_metric,
  p_amount integer default 1
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plan_code;
  v_status public.subscription_status;
  v_limit integer;
  v_period date;
  v_used integer;
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'consume_quota: amount must be >= 1 (got %)', p_amount;
  end if;

  -- 1. Lock the subscription row (shared) so the plan can't change under us.
  select s.plan_code, s.status
    into v_plan, v_status
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id
  for share;

  if not found or not private.is_entitled(v_status) then
    v_plan := null;
  end if;

  v_limit := private.effective_limit(v_plan, p_metric);
  v_period := private.usage_period_start(p_metric);

  -- 2. Make sure the counter row exists.
  insert into public.tenant_usage (tenant_id, metric, period_start)
  values (p_tenant_id, p_metric, v_period)
  on conflict (tenant_id, metric, period_start) do nothing;

  -- 3. Conditional increment: row lock + re-check = no over-allocation.
  update public.tenant_usage u
     set used = u.used + p_amount,
         updated_at = now()
   where u.tenant_id = p_tenant_id
     and u.metric = p_metric
     and u.period_start = v_period
     and (v_limit is null or u.used + p_amount <= v_limit)
  returning u.used into v_used;

  if not found then
    raise sqlstate 'PT402' using
      message = 'Plan limit reached',
      detail = format('%s limit of %s reached', p_metric, v_limit),
      hint = case when v_plan is null then 'Subscribe to a plan' else 'Upgrade your plan' end;
  end if;

  return v_used;
end;
$$;

-- Give units back. Only for lifetime metrics (monthly counts never shrink,
-- so deleting an issued invoice can't be used to reset the quota).
create function private.release_quota(
  p_tenant_id uuid,
  p_metric public.usage_metric,
  p_amount integer default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'release_quota: amount must be >= 1 (got %)', p_amount;
  end if;

  if (select d.reset_window from public.metric_definitions d where d.metric = p_metric) <> 'lifetime' then
    raise exception 'release_quota: % is not a lifetime metric', p_metric;
  end if;

  update public.tenant_usage u
     set used = greatest(u.used - p_amount, 0),
         updated_at = now()
   where u.tenant_id = p_tenant_id
     and u.metric = p_metric
     and u.period_start = '-infinity'::date;
end;
$$;

-- Recount lifetime metrics from source tables to repair any drift.
-- Extend with active_clients once public.clients exists.
create function private.reconcile_usage(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Same lock order as consume_quota.
  perform 1 from public.tenant_subscriptions s where s.tenant_id = p_tenant_id for share;

  insert into public.tenant_usage (tenant_id, metric, period_start)
  values (p_tenant_id, 'team_seats', '-infinity')
  on conflict (tenant_id, metric, period_start) do nothing;

  -- Lock the counter first so no seat can be added between count and write.
  perform 1
  from public.tenant_usage u
  where u.tenant_id = p_tenant_id
    and u.metric = 'team_seats'
    and u.period_start = '-infinity'
  for update;

  select count(*) into v_count
  from public.tenant_members m
  where m.tenant_id = p_tenant_id;

  update public.tenant_usage u
     set used = v_count,
         updated_at = now()
   where u.tenant_id = p_tenant_id
     and u.metric = 'team_seats'
     and u.period_start = '-infinity';
end;
$$;

revoke execute on function private.effective_plan(uuid) from public, anon, authenticated;
revoke execute on function private.consume_quota(uuid, public.usage_metric, integer) from public, anon, authenticated;
revoke execute on function private.release_quota(uuid, public.usage_metric, integer) from public, anon, authenticated;
revoke execute on function private.reconcile_usage(uuid) from public, anon, authenticated;
revoke execute on function private.has_feature(uuid, public.plan_feature) from public, anon;
-- Future RLS WITH CHECK clauses call has_feature as the authenticated role.
grant execute on function private.has_feature(uuid, public.plan_feature) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers on tenant_members: seat quota + role gating
-- ---------------------------------------------------------------------------
create function private.tenant_members_seat_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.consume_quota(new.tenant_id, 'team_seats', 1);
    return new;
  elsif tg_op = 'DELETE' then
    perform private.release_quota(old.tenant_id, 'team_seats', 1);
    return old;
  elsif tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    perform private.consume_quota(new.tenant_id, 'team_seats', 1);
    perform private.release_quota(old.tenant_id, 'team_seats', 1);
  end if;
  return new;
end;
$$;

create trigger tenant_members_seat_quota
  after insert or delete or update of tenant_id on public.tenant_members
  for each row execute function private.tenant_members_seat_quota();

-- admin/approver roles are part of the Agency "roles/permissions" feature.
-- Existing rows are left alone on downgrade (keep data, block new).
create function private.tenant_members_role_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role in ('admin', 'approver')
     and (tg_op = 'INSERT' or new.role is distinct from old.role)
     and not private.has_feature(new.tenant_id, 'roles_permissions') then
    raise sqlstate 'PT402' using
      message = 'Plan feature not available',
      detail = format('role %s requires roles_permissions', new.role),
      hint = 'Upgrade your plan';
  end if;
  return new;
end;
$$;

create trigger tenant_members_role_gate
  before insert or update of role on public.tenant_members
  for each row execute function private.tenant_members_role_gate();

revoke execute on function private.tenant_members_seat_quota() from public, anon, authenticated;
revoke execute on function private.tenant_members_role_gate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read models for the UI (security_invoker: tenant RLS applies)
-- ---------------------------------------------------------------------------
create view public.tenant_entitlements
with (security_invoker = true)
as
select
  t.id as tenant_id,
  d.metric,
  d.reset_window,
  s.plan_code as effective_plan,
  private.effective_limit(s.plan_code, d.metric) as effective_limit,  -- NULL = unlimited
  coalesce(u.used, 0) as used,
  case
    when private.effective_limit(s.plan_code, d.metric) is null then null
    else greatest(private.effective_limit(s.plan_code, d.metric) - coalesce(u.used, 0), 0)
  end as remaining
from public.tenants t
cross join public.metric_definitions d
left join public.tenant_subscriptions s
  on s.tenant_id = t.id
 and private.is_entitled(s.status)
left join public.tenant_usage u
  on u.tenant_id = t.id
 and u.metric = d.metric
 and u.period_start = private.usage_period_start(d.metric);

create view public.tenant_features
with (security_invoker = true)
as
select s.tenant_id, f.feature
from public.tenant_subscriptions s
join public.plan_features f on f.plan_code = s.plan_code
where private.is_entitled(s.status);

revoke all on public.tenant_entitlements, public.tenant_features from anon;
revoke insert, update, delete, truncate on public.tenant_entitlements, public.tenant_features from authenticated;
grant select on public.tenant_entitlements, public.tenant_features to authenticated;

-- ---------------------------------------------------------------------------
-- Service-role RPCs (called by Edge Functions with the secret key)
-- ---------------------------------------------------------------------------
-- Upsert the Stripe price catalog. p_prices is a JSON array of
-- {plan_code, stripe_price_id, stripe_product_id, unit_amount, currency}.
-- Each listed price becomes the current price of its plan.
create function public.sync_plan_prices(p_prices jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_existing public.plan_code;
begin
  if jsonb_typeof(p_prices) <> 'array' or jsonb_array_length(p_prices) = 0 then
    raise exception 'sync_plan_prices: expected a non-empty JSON array';
  end if;

  for v_row in
    select *
    from jsonb_to_recordset(p_prices) as x(
      plan_code public.plan_code,
      stripe_price_id text,
      stripe_product_id text,
      unit_amount integer,
      currency text
    )
  loop
    -- A Stripe price must never be re-pointed to a different plan: existing
    -- subscribers on that price would silently change tier.
    select p.plan_code into v_existing
    from public.plan_prices p
    where p.stripe_price_id = v_row.stripe_price_id;

    if found and v_existing <> v_row.plan_code then
      raise exception 'sync_plan_prices: % already maps to %, refusing to remap to %',
        v_row.stripe_price_id, v_existing, v_row.plan_code;
    end if;

    update public.plan_prices p
       set is_current = false
     where p.plan_code = v_row.plan_code
       and p.is_current
       and p.stripe_price_id <> v_row.stripe_price_id;

    insert into public.plan_prices (
      stripe_price_id, plan_code, stripe_product_id, unit_amount, currency, is_current, synced_at
    ) values (
      v_row.stripe_price_id, v_row.plan_code, v_row.stripe_product_id,
      v_row.unit_amount, lower(v_row.currency), true, now()
    )
    on conflict (stripe_price_id) do update
      set stripe_product_id = excluded.stripe_product_id,
          unit_amount = excluded.unit_amount,
          currency = excluded.currency,
          is_current = true,
          synced_at = now();
  end loop;
end;
$$;

-- Apply the latest Stripe subscription state for one webhook event.
-- Single transaction: idempotency record + tenant/plan resolution + upsert.
-- Raising rolls back the idempotency record so Stripe's retry reprocesses it.
-- Returns 'applied' | 'duplicate' | 'stale' | 'ignored_other_subscription'.
create function public.apply_subscription_state(
  p_event_id text,
  p_event_type text,
  p_event_created timestamptz,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_status public.subscription_status,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_plan public.plan_code;
  v_current public.tenant_subscriptions%rowtype;
begin
  insert into public.stripe_webhook_events (event_id, type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing;

  if not found then
    return 'duplicate';
  end if;

  -- Tenant comes from our own customer mapping, never from client metadata.
  select t.id into v_tenant_id
  from public.tenants t
  where t.stripe_customer_id = p_customer_id;

  if not found then
    raise exception 'apply_subscription_state: unknown Stripe customer %', p_customer_id;
  end if;

  select p.plan_code into v_plan
  from public.plan_prices p
  where p.stripe_price_id = p_price_id;

  if not found then
    raise exception 'apply_subscription_state: unmapped Stripe price % (run sync-plan-prices)', p_price_id;
  end if;

  -- Exclusive lock: waits for in-flight consume_quota calls, blocks new ones.
  select * into v_current
  from public.tenant_subscriptions s
  where s.tenant_id = v_tenant_id
  for update;

  if found then
    if v_current.stripe_subscription_id = p_subscription_id
       and p_event_created < v_current.last_event_at then
      return 'stale';
    end if;

    -- Don't let a dead secondary subscription overwrite a live one.
    if v_current.stripe_subscription_id <> p_subscription_id
       and private.is_entitled(v_current.status)
       and not private.is_entitled(p_status) then
      return 'ignored_other_subscription';
    end if;
  end if;

  insert into public.tenant_subscriptions (
    tenant_id, stripe_subscription_id, stripe_price_id, plan_code, status,
    current_period_end, cancel_at_period_end, last_event_at, updated_at
  ) values (
    v_tenant_id, p_subscription_id, p_price_id, v_plan, p_status,
    p_current_period_end, coalesce(p_cancel_at_period_end, false), p_event_created, now()
  )
  on conflict (tenant_id) do update
    set stripe_subscription_id = excluded.stripe_subscription_id,
        stripe_price_id = excluded.stripe_price_id,
        plan_code = excluded.plan_code,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        last_event_at = excluded.last_event_at,  -- older same-sub events returned 'stale' above
        updated_at = now();

  return 'applied';
end;
$$;

revoke execute on function public.sync_plan_prices(jsonb) from public, anon, authenticated;
revoke execute on function public.apply_subscription_state(
  text, text, timestamptz, text, text, text, public.subscription_status, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.sync_plan_prices(jsonb) to service_role;
grant execute on function public.apply_subscription_state(
  text, text, timestamptz, text, text, text, public.subscription_status, timestamptz, boolean
) to service_role;

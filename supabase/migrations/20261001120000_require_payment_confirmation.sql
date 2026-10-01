-- No plan access without a confirmed payment.
--
-- Before: status active/trialing/past_due granted the plan. But `trialing`
-- involves no payment, and a subscription can be `active` before its invoice
-- is paid (e.g. collection_method = send_invoice).
--
-- After: access requires BOTH
--   * payment_confirmed_at IS NOT NULL - set only when the webhook receives an
--     `invoice.paid` event and re-fetches the invoice from Stripe with
--     status = 'paid', and
--   * status in ('active', 'past_due') - past_due is Stripe's retry window for
--     a renewal after an earlier payment was already confirmed.
-- payment_confirmed_at belongs to one Stripe subscription; it resets when the
-- tenant's row switches to a different subscription.

alter table public.tenant_subscriptions
  add column payment_confirmed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Single source of truth for "does this subscription grant its plan?"
-- ---------------------------------------------------------------------------
create function private.has_paid_access(
  p_status public.subscription_status,
  p_payment_confirmed_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_payment_confirmed_at is not null and p_status in ('active', 'past_due'),
    false
  );
$$;

revoke execute on function private.has_paid_access(public.subscription_status, timestamptz) from public, anon;
grant execute on function private.has_paid_access(public.subscription_status, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-point every entitlement check at has_paid_access
-- ---------------------------------------------------------------------------
create or replace function private.effective_plan(p_tenant_id uuid)
returns public.plan_code
language sql
stable
security definer
set search_path = ''
as $$
  select s.plan_code
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id
    and private.has_paid_access(s.status, s.payment_confirmed_at);
$$;

create or replace function private.has_feature(p_tenant_id uuid, p_feature public.plan_feature)
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
      and private.has_paid_access(s.status, s.payment_confirmed_at)
      and f.feature = p_feature
  );
$$;

create or replace function private.consume_quota(
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
  v_payment_confirmed_at timestamptz;
  v_limit integer;
  v_period date;
  v_used integer;
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'consume_quota: amount must be >= 1 (got %)', p_amount;
  end if;

  -- 1. Lock the subscription row (shared) so the plan can't change under us.
  select s.plan_code, s.status, s.payment_confirmed_at
    into v_plan, v_status, v_payment_confirmed_at
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id
  for share;

  if not found or not private.has_paid_access(v_status, v_payment_confirmed_at) then
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

create or replace view public.tenant_entitlements
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
 and private.has_paid_access(s.status, s.payment_confirmed_at)
left join public.tenant_usage u
  on u.tenant_id = t.id
 and u.metric = d.metric
 and u.period_start = private.usage_period_start(d.metric);

create or replace view public.tenant_features
with (security_invoker = true)
as
select s.tenant_id, f.feature
from public.tenant_subscriptions s
join public.plan_features f on f.plan_code = s.plan_code
where private.has_paid_access(s.status, s.payment_confirmed_at);

-- ---------------------------------------------------------------------------
-- Webhook RPC: new parameter p_payment_confirmed_at
-- ---------------------------------------------------------------------------
drop function public.apply_subscription_state(
  text, text, timestamptz, text, text, text, public.subscription_status, timestamptz, boolean
);

-- Apply the latest Stripe subscription state for one webhook event.
-- Single transaction: idempotency record + tenant/plan resolution + upsert.
-- Raising rolls back the idempotency record so Stripe's retry reprocesses it.
--
-- p_payment_confirmed_at is non-NULL only for a verified `invoice.paid` event.
--
-- Returns:
--   'applied'                          state written
--   'duplicate'                        event already processed - no-op
--   'stale'                            older snapshot of the same subscription
--   'payment_confirmed'                stale snapshot, but its payment
--                                      confirmation was recorded
--   'ignored_other_subscription'       an unpaid/dead subscription tried to
--                                      replace a paid one
--   'applied_replaced_live_subscription'
--                                      a second PAID subscription replaced a
--                                      paid one: the tenant is paying twice,
--                                      the caller must alert for a refund
create function public.apply_subscription_state(
  p_event_id text,
  p_event_type text,
  p_event_created timestamptz,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_status public.subscription_status,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_payment_confirmed_at timestamptz default null
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
  v_confirmed_at timestamptz := p_payment_confirmed_at;
  v_result text := 'applied';
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

  if found and v_current.stripe_subscription_id = p_subscription_id then
    if p_event_created < v_current.last_event_at then
      -- Older snapshot: don't apply it, but a confirmed payment is a fact
      -- that must not be lost to event ordering.
      if p_payment_confirmed_at is not null and v_current.payment_confirmed_at is null then
        update public.tenant_subscriptions s
           set payment_confirmed_at = p_payment_confirmed_at,
               updated_at = now()
         where s.tenant_id = v_tenant_id;
        return 'payment_confirmed';
      end if;
      return 'stale';
    end if;
    -- Once confirmed, a subscription stays confirmed.
    v_confirmed_at := coalesce(v_current.payment_confirmed_at, p_payment_confirmed_at);

  elsif found then
    -- A different subscription for the same tenant.
    if private.has_paid_access(v_current.status, v_current.payment_confirmed_at) then
      if not private.has_paid_access(p_status, p_payment_confirmed_at) then
        return 'ignored_other_subscription';
      end if;
      v_result := 'applied_replaced_live_subscription';
    end if;
  end if;

  insert into public.tenant_subscriptions (
    tenant_id, stripe_subscription_id, stripe_price_id, plan_code, status,
    current_period_end, cancel_at_period_end, payment_confirmed_at, last_event_at, updated_at
  ) values (
    v_tenant_id, p_subscription_id, p_price_id, v_plan, p_status,
    p_current_period_end, coalesce(p_cancel_at_period_end, false), v_confirmed_at, p_event_created, now()
  )
  on conflict (tenant_id) do update
    set stripe_subscription_id = excluded.stripe_subscription_id,
        stripe_price_id = excluded.stripe_price_id,
        plan_code = excluded.plan_code,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        payment_confirmed_at = excluded.payment_confirmed_at,
        last_event_at = excluded.last_event_at,  -- older same-sub events returned above
        updated_at = now();

  return v_result;
end;
$$;

revoke execute on function public.apply_subscription_state(
  text, text, timestamptz, text, text, text, public.subscription_status, timestamptz, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_subscription_state(
  text, text, timestamptz, text, text, text, public.subscription_status, timestamptz, boolean, timestamptz
) to service_role;

-- Nothing references the old status-only check any more.
drop function private.is_entitled(public.subscription_status);

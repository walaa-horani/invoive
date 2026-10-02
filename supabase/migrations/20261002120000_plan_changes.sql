-- Plan upgrades and downgrades for existing subscribers.
--
-- Changes are made by the change-plan Edge Function in Stripe and mirrored
-- here like every other subscription change:
--   * Upgrade = immediate, prorated difference charged at once with
--     payment_behavior=pending_if_incomplete. Until that invoice is paid Stripe
--     keeps the old price and reports the change as subscription.pending_update
--     (mirrored as pending_*; it never grants anything).
--   * Downgrade = at the end of the paid period, via a Subscription Schedule
--     (mirrored as scheduled_*). No credit, no refund, nothing charged
--     mid-cycle.
--
-- Immediate enforcement:
--   * Upgrades: the Edge Function applies Stripe's response before replying,
--     so the next insert sees the new limits.
--   * Fair plan lock: row-level FOR SHARE (consume_quota) can starve FOR
--     UPDATE (apply_subscription_state) - new share lockers skip ahead of a
--     waiting updater, and under steady traffic a plan change waited until
--     the traffic stopped. A per-tenant advisory lock is taken first (shared
--     by quota checks, exclusive by plan changes); the lock manager queues
--     those fairly, so a plan change waits only for checks already running.
--   * Downgrades: private.entitled_plan switches to the scheduled plan the
--     moment scheduled_change_at passes - the same instant Stripe moves to the
--     next phase - without waiting for the renewal webhook.
--
-- Plan-change lease: one billing mutation per tenant at a time (change-plan
-- and create-checkout-session), so two requests can't interleave Stripe calls.

-- ---------------------------------------------------------------------------
-- Mirrored pending / scheduled changes
-- ---------------------------------------------------------------------------
alter table public.tenant_subscriptions
  -- Upgrade waiting for its proration invoice to be paid (expires in ~23 h).
  add column pending_price_id text,
  add column pending_plan_code public.plan_code,
  add column pending_update_expires_at timestamptz,
  -- Downgrade scheduled for the end of the period.
  add column stripe_schedule_id text check (stripe_schedule_id ~ '^sub_sched_'),
  add column scheduled_price_id text,
  add column scheduled_plan_code public.plan_code,
  add column scheduled_change_at timestamptz,
  add constraint tenant_subscriptions_pending_price_plan_fkey
    foreign key (pending_price_id, pending_plan_code)
    references public.plan_prices (stripe_price_id, plan_code),
  add constraint tenant_subscriptions_scheduled_price_plan_fkey
    foreign key (scheduled_price_id, scheduled_plan_code)
    references public.plan_prices (stripe_price_id, plan_code),
  add constraint tenant_subscriptions_pending_all_or_none
    check (num_nulls(pending_price_id, pending_plan_code, pending_update_expires_at) in (0, 3)),
  add constraint tenant_subscriptions_scheduled_all_or_none
    check (num_nulls(scheduled_price_id, scheduled_plan_code, scheduled_change_at) in (0, 3)),
  add constraint tenant_subscriptions_scheduled_needs_schedule
    check (scheduled_price_id is null or stripe_schedule_id is not null);

-- ---------------------------------------------------------------------------
-- Fair per-tenant plan lock (transaction-scoped advisory lock)
-- ---------------------------------------------------------------------------
-- Lock order everywhere: plan lock -> tenant_subscriptions row -> tenant_usage row.
create function private.lock_tenant_plan(p_tenant_id uuid, p_exclusive boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_key bigint := hashtextextended('ledgerflow.tenant_plan:' || p_tenant_id::text, 0);
begin
  if p_exclusive then
    perform pg_advisory_xact_lock(v_key);
  else
    perform pg_advisory_xact_lock_shared(v_key);
  end if;
end;
$$;

revoke execute on function private.lock_tenant_plan(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Single plan resolver
-- ---------------------------------------------------------------------------
-- The plan whose limits and features apply right now, or NULL (read-only).
-- Once a scheduled change is due, a lower plan applies immediately; a higher
-- one still waits for Stripe's snapshot (no plan before it is invoiced).
create function private.entitled_plan(
  p_status public.subscription_status,
  p_payment_confirmed_at timestamptz,
  p_plan_code public.plan_code,
  p_scheduled_plan_code public.plan_code,
  p_scheduled_change_at timestamptz
)
returns public.plan_code
language sql
stable
set search_path = ''
as $$
  select case
    when not private.has_paid_access(p_status, p_payment_confirmed_at) then null
    when p_scheduled_change_at is not null
         and p_scheduled_change_at <= now()
         and (select s.rank from public.plans s where s.code = p_scheduled_plan_code)
           < (select c.rank from public.plans c where c.code = p_plan_code)
      then p_scheduled_plan_code
    else p_plan_code
  end;
$$;

revoke execute on function private.entitled_plan(
  public.subscription_status, timestamptz, public.plan_code, public.plan_code, timestamptz
) from public, anon;
-- The security_invoker views below call it as the authenticated role.
grant execute on function private.entitled_plan(
  public.subscription_status, timestamptz, public.plan_code, public.plan_code, timestamptz
) to authenticated;

create or replace function private.effective_plan(p_tenant_id uuid)
returns public.plan_code
language sql
stable
security definer
set search_path = ''
as $$
  select private.entitled_plan(s.status, s.payment_confirmed_at, s.plan_code, s.scheduled_plan_code, s.scheduled_change_at)
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id;
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
    join public.plan_features f
      on f.plan_code = private.entitled_plan(
           s.status, s.payment_confirmed_at, s.plan_code, s.scheduled_plan_code, s.scheduled_change_at)
    where s.tenant_id = p_tenant_id
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
  v_limit integer;
  v_period date;
  v_used integer;
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'consume_quota: amount must be >= 1 (got %)', p_amount;
  end if;

  -- 1. Shared plan lock + subscription row lock: the plan can't change under
  --    us, and a waiting plan change is not starved by later checks.
  perform private.lock_tenant_plan(p_tenant_id, false);

  select private.entitled_plan(s.status, s.payment_confirmed_at, s.plan_code, s.scheduled_plan_code, s.scheduled_change_at)
    into v_plan
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id
  for share;

  if not found then
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

-- Same lock order as consume_quota.
create or replace function private.reconcile_usage(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.lock_tenant_plan(p_tenant_id, false);
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

create or replace view public.tenant_entitlements
with (security_invoker = true)
as
select
  t.id as tenant_id,
  d.metric,
  d.reset_window,
  e.plan_code as effective_plan,
  private.effective_limit(e.plan_code, d.metric) as effective_limit,  -- NULL = unlimited
  coalesce(u.used, 0) as used,
  case
    when private.effective_limit(e.plan_code, d.metric) is null then null
    else greatest(private.effective_limit(e.plan_code, d.metric) - coalesce(u.used, 0), 0)
  end as remaining
from public.tenants t
cross join public.metric_definitions d
left join lateral (
  select private.entitled_plan(s.status, s.payment_confirmed_at, s.plan_code, s.scheduled_plan_code, s.scheduled_change_at) as plan_code
  from public.tenant_subscriptions s
  where s.tenant_id = t.id
) e on true
left join public.tenant_usage u
  on u.tenant_id = t.id
 and u.metric = d.metric
 and u.period_start = private.usage_period_start(d.metric);

create or replace view public.tenant_features
with (security_invoker = true)
as
select s.tenant_id, f.feature
from public.tenant_subscriptions s
join public.plan_features f
  on f.plan_code = private.entitled_plan(
       s.status, s.payment_confirmed_at, s.plan_code, s.scheduled_plan_code, s.scheduled_change_at);

-- ---------------------------------------------------------------------------
-- Plan-change lease (service role only)
-- ---------------------------------------------------------------------------
create table private.plan_change_leases (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  holder uuid not null,
  expires_at timestamptz not null
);

alter table private.plan_change_leases enable row level security;
revoke all on private.plan_change_leases from public, anon, authenticated;

-- true = the caller holds the lease until expires_at. A crashed holder's lease
-- simply expires; re-acquiring with the same holder extends it.
create function public.acquire_plan_change_lease(
  p_tenant_id uuid,
  p_holder uuid,
  p_ttl_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_holder is null then
    raise exception 'acquire_plan_change_lease: tenant and holder are required';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 1 and 900 then
    raise exception 'acquire_plan_change_lease: ttl must be 1..900 seconds (got %)', p_ttl_seconds;
  end if;

  insert into private.plan_change_leases as l (tenant_id, holder, expires_at)
  values (p_tenant_id, p_holder, clock_timestamp() + make_interval(secs => p_ttl_seconds))
  on conflict (tenant_id) do update
    set holder = excluded.holder,
        expires_at = excluded.expires_at
    where l.expires_at <= clock_timestamp()
       or l.holder = excluded.holder;

  return found;
end;
$$;

create function public.release_plan_change_lease(p_tenant_id uuid, p_holder uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with released as (
    delete from private.plan_change_leases l
    where l.tenant_id = p_tenant_id
      and l.holder = p_holder
    returning 1
  )
  select exists (select 1 from released);
$$;

revoke execute on function public.acquire_plan_change_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_plan_change_lease(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_plan_change_lease(uuid, uuid, integer) to service_role;
grant execute on function public.release_plan_change_lease(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Webhook / reconciliation RPC: + pending update and schedule
-- ---------------------------------------------------------------------------
drop function public.apply_subscription_state(
  text, text, bigint, text, text, text, public.subscription_status, timestamptz, timestamptz,
  boolean, timestamptz, timestamptz, timestamptz, text, public.stripe_invoice_status, timestamptz, timestamptz
);

-- Apply one Stripe subscription snapshot. Single transaction: idempotency
-- record + tenant/plan resolution + upsert. Raising rolls back the idempotency
-- record so Stripe's retry reprocesses the event.
--
-- p_event_id             Stripe event id; NULL for reconciliation runs and
--                        for change-plan's own write-through.
-- p_sync_seq             public.stripe_sync_ticket() taken before the fetch.
-- p_payment_confirmed_at non-NULL only for a verified paid invoice.
-- p_pending_*            subscription.pending_update (upgrade awaiting payment).
-- p_schedule_id,
-- p_scheduled_*          next phase of the attached subscription schedule.
--
-- Returns:
--   'applied'                             snapshot written
--   'duplicate'                           event already processed - no-op
--   'stale'                               a newer snapshot is already stored
--   'payment_confirmed'                   stale snapshot, but its payment
--                                         confirmation was recorded
--   'ignored_other_subscription'          a less alive subscription of the
--                                         same customer - row unchanged
--   'ignored_duplicate_live_subscription' another PAID subscription exists
--                                         alongside the stored paid one
--   'applied_replaced_live_subscription'  a PAID subscription replaced a paid
--                                         one
-- The last two mean the customer is paying twice: the caller must alert.
create function public.apply_subscription_state(
  p_event_id text,
  p_event_type text,
  p_sync_seq bigint,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_status public.subscription_status,
  p_current_period_start timestamptz default null,
  p_current_period_end timestamptz default null,
  p_cancel_at_period_end boolean default false,
  p_cancel_at timestamptz default null,
  p_canceled_at timestamptz default null,
  p_ended_at timestamptz default null,
  p_latest_invoice_id text default null,
  p_latest_invoice_status public.stripe_invoice_status default null,
  p_next_payment_attempt timestamptz default null,
  p_payment_confirmed_at timestamptz default null,
  p_pending_price_id text default null,
  p_pending_update_expires_at timestamptz default null,
  p_schedule_id text default null,
  p_scheduled_price_id text default null,
  p_scheduled_change_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_plan public.plan_code;
  v_pending_plan public.plan_code;
  v_scheduled_plan public.plan_code;
  v_current public.tenant_subscriptions%rowtype;
  v_confirmed_at timestamptz := p_payment_confirmed_at;
  v_current_rank smallint;
  v_new_rank smallint;
  v_result text := 'applied';
begin
  if p_sync_seq is null or p_sync_seq < 1 then
    raise exception 'apply_subscription_state: p_sync_seq is required (take public.stripe_sync_ticket() before fetching)';
  end if;

  if p_event_id is not null then
    insert into public.stripe_webhook_events (event_id, type)
    values (p_event_id, p_event_type)
    on conflict (event_id) do nothing;

    if not found then
      return 'duplicate';
    end if;
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

  if p_pending_price_id is not null then
    select p.plan_code into v_pending_plan
    from public.plan_prices p
    where p.stripe_price_id = p_pending_price_id;

    if not found then
      raise exception 'apply_subscription_state: unmapped pending Stripe price % (run sync-plan-prices)', p_pending_price_id;
    end if;
  end if;

  if p_scheduled_price_id is not null then
    select p.plan_code into v_scheduled_plan
    from public.plan_prices p
    where p.stripe_price_id = p_scheduled_price_id;

    if not found then
      raise exception 'apply_subscription_state: unmapped scheduled Stripe price % (run sync-plan-prices)', p_scheduled_price_id;
    end if;
  end if;

  -- Exclusive plan lock (fair: queued ahead of later quota checks), then the
  -- row: waits for in-flight consume_quota calls, blocks new ones, and
  -- serializes concurrent webhook deliveries for this tenant.
  perform private.lock_tenant_plan(v_tenant_id, true);

  select * into v_current
  from public.tenant_subscriptions s
  where s.tenant_id = v_tenant_id
  for update;

  if found and v_current.stripe_subscription_id = p_subscription_id then
    if p_sync_seq < v_current.last_sync_seq then
      -- Older snapshot: don't apply it, but a confirmed payment is a fact
      -- that must not be lost to delivery order.
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
    -- Another subscription of the same customer: keep the most alive one,
    -- then the newest snapshot.
    v_current_rank := private.subscription_rank(v_current.status, v_current.payment_confirmed_at);
    v_new_rank := private.subscription_rank(p_status, p_payment_confirmed_at);

    if v_new_rank < v_current_rank
       or (v_new_rank = v_current_rank and p_sync_seq <= v_current.last_sync_seq) then
      if v_new_rank = 3 and v_current_rank = 3 then
        return 'ignored_duplicate_live_subscription';
      end if;
      return 'ignored_other_subscription';
    end if;

    if v_new_rank = 3 and v_current_rank = 3 then
      v_result := 'applied_replaced_live_subscription';
    end if;
  end if;

  insert into public.tenant_subscriptions (
    tenant_id, stripe_subscription_id, stripe_price_id, plan_code, status,
    current_period_start, current_period_end, cancel_at_period_end, cancel_at,
    canceled_at, ended_at, latest_invoice_id, latest_invoice_status,
    next_payment_attempt, payment_confirmed_at,
    pending_price_id, pending_plan_code, pending_update_expires_at,
    stripe_schedule_id, scheduled_price_id, scheduled_plan_code, scheduled_change_at,
    last_sync_seq, updated_at
  ) values (
    v_tenant_id, p_subscription_id, p_price_id, v_plan, p_status,
    p_current_period_start, p_current_period_end, coalesce(p_cancel_at_period_end, false), p_cancel_at,
    p_canceled_at, p_ended_at, p_latest_invoice_id, p_latest_invoice_status,
    p_next_payment_attempt, v_confirmed_at,
    p_pending_price_id, v_pending_plan, p_pending_update_expires_at,
    p_schedule_id, p_scheduled_price_id, v_scheduled_plan, p_scheduled_change_at,
    p_sync_seq, now()
  )
  on conflict (tenant_id) do update
    set stripe_subscription_id = excluded.stripe_subscription_id,
        stripe_price_id = excluded.stripe_price_id,
        plan_code = excluded.plan_code,
        status = excluded.status,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        cancel_at = excluded.cancel_at,
        canceled_at = excluded.canceled_at,
        ended_at = excluded.ended_at,
        latest_invoice_id = excluded.latest_invoice_id,
        latest_invoice_status = excluded.latest_invoice_status,
        next_payment_attempt = excluded.next_payment_attempt,
        payment_confirmed_at = excluded.payment_confirmed_at,
        pending_price_id = excluded.pending_price_id,
        pending_plan_code = excluded.pending_plan_code,
        pending_update_expires_at = excluded.pending_update_expires_at,
        stripe_schedule_id = excluded.stripe_schedule_id,
        scheduled_price_id = excluded.scheduled_price_id,
        scheduled_plan_code = excluded.scheduled_plan_code,
        scheduled_change_at = excluded.scheduled_change_at,
        last_sync_seq = excluded.last_sync_seq,
        updated_at = now();

  return v_result;
end;
$$;

revoke execute on function public.apply_subscription_state(
  text, text, bigint, text, text, text, public.subscription_status, timestamptz, timestamptz,
  boolean, timestamptz, timestamptz, timestamptz, text, public.stripe_invoice_status, timestamptz, timestamptz,
  text, timestamptz, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_subscription_state(
  text, text, bigint, text, text, text, public.subscription_status, timestamptz, timestamptz,
  boolean, timestamptz, timestamptz, timestamptz, text, public.stripe_invoice_status, timestamptz, timestamptz,
  text, timestamptz, text, text, timestamptz
) to service_role;

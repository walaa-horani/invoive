-- Mirror the Stripe subscription exactly, whatever Revenue Recovery does.
--
-- Revenue Recovery settings (Dashboard > Billing > Revenue recovery > Retries)
-- decide how Stripe moves a subscription between statuses:
--   * "Subscription is active when its most recent invoice is settled"
--   * "If all retries for a payment fail: cancel the subscription"
--   * "If all retries for a payment fail: leave the invoice past-due"
-- Stripe applies those rules and reports the result as subscription.status.
-- This database never re-implements them: it stores Stripe's status verbatim
-- and derives access from it in exactly one place (private.has_paid_access),
-- so changing a Dashboard setting later needs no code change.
--
-- Changes:
-- 1. Ordering by sync ticket instead of event.created. The webhook takes a
--    ticket from a sequence BEFORE re-fetching the subscription, so a higher
--    ticket always carries a snapshot at least as new. event.created has
--    1-second resolution, and two events in the same second could let an
--    older snapshot overwrite a newer one.
-- 2. Dunning / lifecycle fields mirrored for the billing UI: latest invoice
--    and its status, the next retry, cancel and end dates.
-- 3. Several subscriptions on one customer: the row keeps the most "alive"
--    one (paid > pending > dead), then the newest snapshot. Two paid ones at
--    once are always reported, whichever wins.
-- 4. A reconciliation job (reconcile-subscriptions Edge Function) can apply
--    snapshots without a webhook event, to repair missed or failed deliveries.

create type public.stripe_invoice_status as enum ('draft', 'open', 'paid', 'uncollectible', 'void');

create sequence private.stripe_sync_seq as bigint;

alter table public.tenant_subscriptions
  add column current_period_start timestamptz,
  add column cancel_at timestamptz,
  add column canceled_at timestamptz,
  add column ended_at timestamptz,
  add column latest_invoice_id text check (latest_invoice_id ~ '^in_'),
  add column latest_invoice_status public.stripe_invoice_status,
  -- Set while Stripe is retrying a failed payment (status past_due).
  add column next_payment_attempt timestamptz,
  -- Ticket of the newest snapshot applied; lower tickets are skipped.
  add column last_sync_seq bigint not null default 0;

alter table public.tenant_subscriptions drop column last_event_at;

-- ---------------------------------------------------------------------------
-- Sync ticket: taken before reading from Stripe.
-- ---------------------------------------------------------------------------
create function public.stripe_sync_ticket()
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  select nextval('private.stripe_sync_seq');
$$;

revoke execute on function public.stripe_sync_ticket() from public, anon, authenticated;
grant execute on function public.stripe_sync_ticket() to service_role;

-- 3 = grants the plan, 2 = may still become paid, 1 = finished for good.
create function private.subscription_rank(
  p_status public.subscription_status,
  p_payment_confirmed_at timestamptz
)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when private.has_paid_access(p_status, p_payment_confirmed_at) then 3
    when p_status in ('canceled', 'incomplete_expired') then 1
    else 2
  end::smallint;
$$;

revoke execute on function private.subscription_rank(public.subscription_status, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Webhook / reconciliation RPC
-- ---------------------------------------------------------------------------
drop function public.apply_subscription_state(
  text, text, timestamptz, text, text, text, public.subscription_status, timestamptz, boolean, timestamptz
);

-- Apply one Stripe subscription snapshot. Single transaction: idempotency
-- record + tenant/plan resolution + upsert. Raising rolls back the idempotency
-- record so Stripe's retry reprocesses the event.
--
-- p_event_id            Stripe event id; NULL for reconciliation runs.
-- p_sync_seq            public.stripe_sync_ticket() taken before the fetch.
-- p_payment_confirmed_at non-NULL only for a verified paid invoice.
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

  -- Exclusive lock: waits for in-flight consume_quota calls, blocks new ones,
  -- and serializes concurrent webhook deliveries for this tenant.
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
    next_payment_attempt, payment_confirmed_at, last_sync_seq, updated_at
  ) values (
    v_tenant_id, p_subscription_id, p_price_id, v_plan, p_status,
    p_current_period_start, p_current_period_end, coalesce(p_cancel_at_period_end, false), p_cancel_at,
    p_canceled_at, p_ended_at, p_latest_invoice_id, p_latest_invoice_status,
    p_next_payment_attempt, v_confirmed_at, p_sync_seq, now()
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
        last_sync_seq = excluded.last_sync_seq,
        updated_at = now();

  return v_result;
end;
$$;

revoke execute on function public.apply_subscription_state(
  text, text, bigint, text, text, text, public.subscription_status, timestamptz, timestamptz,
  boolean, timestamptz, timestamptz, timestamptz, text, public.stripe_invoice_status, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_subscription_state(
  text, text, bigint, text, text, text, public.subscription_status, timestamptz, timestamptz,
  boolean, timestamptz, timestamptz, timestamptz, text, public.stripe_invoice_status, timestamptz, timestamptz
) to service_role;

-- Billing schema: plan catalog (limits + features), Stripe price mapping,
-- tenant subscriptions and per-tenant usage counters.
--
-- Stripe is the source of truth for subscription state. Rows in
-- tenant_subscriptions are only written by the stripe-webhook Edge Function
-- (via public.apply_subscription_state). Stripe Price IDs are never hardcoded:
-- they live in Supabase secrets and are copied into plan_prices by the
-- sync-plan-prices Edge Function.

-- ---------------------------------------------------------------------------
-- Private schema: internal helpers. Not exposed through PostgREST.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- RLS policies evaluated as `authenticated` call a few private helpers.
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.plan_code as enum ('starter', 'growth', 'agency');

create type public.usage_metric as enum (
  'active_clients',   -- clients with status = 'active' and not soft-deleted
  'invoices_issued',  -- invoices moved from draft to issued, per calendar month
  'team_seats'        -- tenant members (+ pending invites once invites exist)
);

create type public.limit_window as enum ('lifetime', 'calendar_month');

create type public.plan_feature as enum (
  'online_payments',
  'premium_templates',
  'payment_reminders',
  'recurring_invoices',
  'basic_reports',
  'advanced_reports',
  'data_export',
  'white_label',
  'custom_domain',
  'roles_permissions'
);

-- Mirrors Stripe's Subscription.status values exactly.
create type public.subscription_status as enum (
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);

create type public.member_role as enum ('owner', 'admin', 'member', 'approver');

-- ---------------------------------------------------------------------------
-- Plan catalog (global, read-only for clients)
-- ---------------------------------------------------------------------------
create table public.plans (
  code public.plan_code primary key,
  name text not null,
  rank smallint not null unique check (rank > 0)  -- higher rank = higher tier
);

-- How each metric is counted. min_allowance is a floor applied on top of any
-- plan limit (including "no plan"), e.g. a tenant always has its owner seat.
create table public.metric_definitions (
  metric public.usage_metric primary key,
  reset_window public.limit_window not null,
  min_allowance integer not null default 0 check (min_allowance >= 0)
);

-- max_value NULL = unlimited. Every (plan, metric) pair must have a row;
-- enforcement fails closed (limit 0) if one is missing.
create table public.plan_limits (
  plan_code public.plan_code not null references public.plans (code),
  metric public.usage_metric not null references public.metric_definitions (metric),
  max_value integer check (max_value >= 0),
  primary key (plan_code, metric)
);

-- Row present = feature enabled for that plan.
create table public.plan_features (
  plan_code public.plan_code not null references public.plans (code),
  feature public.plan_feature not null,
  primary key (plan_code, feature)
);

-- Stripe Price -> plan mapping. Several prices may map to one plan: Stripe
-- prices are immutable, so a price change creates a new Price while existing
-- subscribers stay on the old one. Exactly one price per plan is "current"
-- (the one sold to new customers).
create table public.plan_prices (
  stripe_price_id text primary key check (stripe_price_id ~ '^price_'),
  plan_code public.plan_code not null references public.plans (code),
  stripe_product_id text not null check (stripe_product_id ~ '^prod_'),
  unit_amount integer not null check (unit_amount >= 0),  -- minor units (cents)
  currency text not null check (currency ~ '^[a-z]{3}$'),
  is_current boolean not null default false,
  synced_at timestamptz not null default now(),
  -- Target of the composite FK from tenant_subscriptions.
  unique (stripe_price_id, plan_code)
);

create unique index plan_prices_one_current_per_plan
  on public.plan_prices (plan_code)
  where is_current;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  -- Set server-side when the Stripe Customer is created; used to resolve the
  -- tenant for incoming webhooks.
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_'),
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- RLS lookups go user -> tenants.
create index tenant_members_user_id_tenant_id_idx
  on public.tenant_members (user_id, tenant_id);

-- At most one owner per tenant.
create unique index tenant_members_one_owner
  on public.tenant_members (tenant_id)
  where role = 'owner';

-- ---------------------------------------------------------------------------
-- Subscription mirror (one per tenant; no row = no plan = read-only)
-- ---------------------------------------------------------------------------
create table public.tenant_subscriptions (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_'),
  stripe_price_id text not null,
  plan_code public.plan_code not null,
  status public.subscription_status not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- `created` of the newest Stripe event applied; older events are skipped.
  last_event_at timestamptz not null,
  updated_at timestamptz not null default now(),
  -- plan_code can never disagree with the price it was derived from.
  constraint tenant_subscriptions_price_plan_fkey
    foreign key (stripe_price_id, plan_code)
    references public.plan_prices (stripe_price_id, plan_code)
);

-- ---------------------------------------------------------------------------
-- Usage counters
-- ---------------------------------------------------------------------------
-- lifetime metrics use period_start = '-infinity'; calendar_month metrics use
-- the first day of the month (UTC). Past months are kept as history.
create table public.tenant_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  metric public.usage_metric not null,
  period_start date not null,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, metric, period_start)
);

-- ---------------------------------------------------------------------------
-- Webhook idempotency ledger
-- ---------------------------------------------------------------------------
create table public.stripe_webhook_events (
  event_id text primary key check (event_id ~ '^evt_'),
  type text not null,
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Seed: plan catalog
-- ---------------------------------------------------------------------------
insert into public.plans (code, name, rank) values
  ('starter', 'Starter', 1),
  ('growth',  'Growth',  2),
  ('agency',  'Agency',  3);

insert into public.metric_definitions (metric, reset_window, min_allowance) values
  ('active_clients',  'lifetime',       0),
  ('invoices_issued', 'calendar_month', 0),
  ('team_seats',      'lifetime',       1);  -- owner seat always allowed

insert into public.plan_limits (plan_code, metric, max_value) values
  ('starter', 'active_clients',  5),
  ('starter', 'invoices_issued', 20),
  ('starter', 'team_seats',      1),
  ('growth',  'active_clients',  null),
  ('growth',  'invoices_issued', null),
  ('growth',  'team_seats',      3),
  ('agency',  'active_clients',  null),
  ('agency',  'invoices_issued', null),
  ('agency',  'team_seats',      null);

insert into public.plan_features (plan_code, feature) values
  ('starter', 'online_payments'),

  ('growth',  'online_payments'),
  ('growth',  'premium_templates'),
  ('growth',  'payment_reminders'),
  ('growth',  'recurring_invoices'),
  ('growth',  'basic_reports'),

  ('agency',  'online_payments'),
  ('agency',  'premium_templates'),
  ('agency',  'payment_reminders'),
  ('agency',  'recurring_invoices'),
  ('agency',  'basic_reports'),
  ('agency',  'advanced_reports'),
  ('agency',  'data_export'),
  ('agency',  'white_label'),
  ('agency',  'custom_domain'),
  ('agency',  'roles_permissions');

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Tenants the current user belongs to. Uses auth.uid() only, never JWT
-- metadata. Referenced as `tenant_id in (select ...)` so it runs once per
-- statement rather than once per row.
create function private.current_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.tenant_members m
  where m.user_id = (select auth.uid());
$$;

revoke execute on function private.current_user_tenant_ids() from public, anon;
grant execute on function private.current_user_tenant_ids() to authenticated;

alter table public.plans enable row level security;
alter table public.metric_definitions enable row level security;
alter table public.plan_limits enable row level security;
alter table public.plan_features enable row level security;
alter table public.plan_prices enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.tenant_usage enable row level security;
alter table public.stripe_webhook_events enable row level security;

-- Catalog: readable by everyone (pricing page), writable by nobody via the API.
create policy "Catalog is public" on public.plans
  for select to anon, authenticated using (true);
create policy "Catalog is public" on public.metric_definitions
  for select to anon, authenticated using (true);
create policy "Catalog is public" on public.plan_limits
  for select to anon, authenticated using (true);
create policy "Catalog is public" on public.plan_features
  for select to anon, authenticated using (true);
create policy "Catalog is public" on public.plan_prices
  for select to anon, authenticated using (true);

-- Tenant data: members read their own tenants only. No write policies:
-- writes go through SECURITY DEFINER functions / the service role.
create policy "Members read own tenant" on public.tenants
  for select to authenticated
  using (id in (select private.current_user_tenant_ids()));

create policy "Members read own tenant members" on public.tenant_members
  for select to authenticated
  using (tenant_id in (select private.current_user_tenant_ids()));

create policy "Members read own subscription" on public.tenant_subscriptions
  for select to authenticated
  using (tenant_id in (select private.current_user_tenant_ids()));

create policy "Members read own usage" on public.tenant_usage
  for select to authenticated
  using (tenant_id in (select private.current_user_tenant_ids()));

-- stripe_webhook_events: RLS on, no policies -> service role only.

-- Defense in depth on top of RLS: API roles can't write billing tables at all.
revoke insert, update, delete, truncate on
  public.plans,
  public.metric_definitions,
  public.plan_limits,
  public.plan_features,
  public.plan_prices,
  public.tenants,
  public.tenant_members,
  public.tenant_subscriptions,
  public.tenant_usage
from anon, authenticated;

revoke all on public.stripe_webhook_events from anon, authenticated;
revoke all on public.tenants, public.tenant_members, public.tenant_subscriptions, public.tenant_usage from anon;

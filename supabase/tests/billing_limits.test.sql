begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
select ('00000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@test.local'
from generate_series(1, 20) n;

create temp table u as
select n, ('00000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid as id
from generate_series(1, 20) n;

insert into public.tenants (id, name, stripe_customer_id) values
  ('00000000-0000-0000-0000-00000000000a', 'A starter', 'cus_A'),
  ('00000000-0000-0000-0000-00000000000b', 'B growth',  'cus_B'),
  ('00000000-0000-0000-0000-00000000000c', 'C agency',  'cus_C'),
  ('00000000-0000-0000-0000-00000000000d', 'D no plan', 'cus_D'),
  ('00000000-0000-0000-0000-00000000000e', 'E growth',  'cus_E');

select lives_ok($$
  select public.sync_plan_prices('[
    {"plan_code":"starter","stripe_price_id":"price_test_starter","stripe_product_id":"prod_s","unit_amount":599,"currency":"USD"},
    {"plan_code":"growth","stripe_price_id":"price_test_growth","stripe_product_id":"prod_g","unit_amount":1499,"currency":"usd"},
    {"plan_code":"agency","stripe_price_id":"price_test_agency","stripe_product_id":"prod_a","unit_amount":1999,"currency":"usd"}
  ]'::jsonb)
$$, 'sync_plan_prices seeds the catalog');

select is((select count(*)::int from public.plan_prices where is_current), 3, 'one current price per plan');

select throws_ok($$
  select public.sync_plan_prices('[{"plan_code":"agency","stripe_price_id":"price_test_starter","stripe_product_id":"prod_s","unit_amount":599,"currency":"usd"}]'::jsonb)
$$, 'P0001', null, 'a price can never be remapped to another plan');

-- New current price for growth: old one kept (grandfathered) but not current.
select public.sync_plan_prices('[{"plan_code":"growth","stripe_price_id":"price_test_growth_v2","stripe_product_id":"prod_g","unit_amount":1699,"currency":"usd"}]'::jsonb);
select is(
  (select array_agg(stripe_price_id order by stripe_price_id) from public.plan_prices where plan_code = 'growth' and is_current),
  array['price_test_growth_v2'],
  'price rotation keeps exactly one current price'
);

-- Subscriptions via the webhook RPC
select is(public.apply_subscription_state('evt_A1', 'customer.subscription.created', '2026-09-01T00:00:00Z', 'cus_A', 'sub_A', 'price_test_starter', 'active', '2026-10-01T00:00:00Z', false), 'applied', 'A subscribes to starter');
select is(public.apply_subscription_state('evt_B1', 'customer.subscription.created', '2026-09-01T00:00:00Z', 'cus_B', 'sub_B', 'price_test_growth',  'active', '2026-10-01T00:00:00Z', false), 'applied', 'B on grandfathered growth price');
select is(public.apply_subscription_state('evt_C1', 'customer.subscription.created', '2026-09-01T00:00:00Z', 'cus_C', 'sub_C', 'price_test_agency',  'trialing', '2026-10-01T00:00:00Z', false), 'applied', 'C trialing agency');
select is(public.apply_subscription_state('evt_E1', 'customer.subscription.created', '2026-09-01T00:00:00Z', 'cus_E', 'sub_E', 'price_test_growth_v2', 'active', '2026-10-01T00:00:00Z', false), 'applied', 'E on growth');

-- ---------------------------------------------------------------------------
-- Webhook idempotency / ordering
-- ---------------------------------------------------------------------------
select is(public.apply_subscription_state('evt_A1', 'customer.subscription.created', '2026-09-01T00:00:00Z', 'cus_A', 'sub_A', 'price_test_agency', 'active', null, false), 'duplicate', 'replayed event is a no-op');
select is((select plan_code::text from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-00000000000a'), 'starter', 'duplicate did not change plan');

select is(public.apply_subscription_state('evt_A0', 'customer.subscription.updated', '2026-08-01T00:00:00Z', 'cus_A', 'sub_A', 'price_test_agency', 'active', null, false), 'stale', 'older event is skipped');

select is(public.apply_subscription_state('evt_A_other', 'customer.subscription.deleted', '2026-09-02T00:00:00Z', 'cus_A', 'sub_A_dup', 'price_test_starter', 'canceled', null, false), 'ignored_other_subscription', 'dead secondary subscription does not clobber live one');

select throws_ok($$
  select public.apply_subscription_state('evt_bad_price', 'customer.subscription.updated', '2026-09-03T00:00:00Z', 'cus_A', 'sub_A', 'price_unknown', 'active', null, false)
$$, 'P0001', null, 'unmapped price raises (Stripe will retry)');
select is((select count(*)::int from public.stripe_webhook_events where event_id = 'evt_bad_price'), 0, 'failed event is not recorded as processed');

select throws_ok($$
  select public.apply_subscription_state('evt_bad_cus', 'customer.subscription.updated', '2026-09-03T00:00:00Z', 'cus_nobody', 'sub_X', 'price_test_starter', 'active', null, false)
$$, 'P0001', null, 'unknown customer raises');

select throws_ok($$
  update public.tenant_subscriptions set plan_code = 'agency' where tenant_id = '00000000-0000-0000-0000-00000000000a'
$$, '23503', null, 'plan_code cannot disagree with stripe_price_id');

-- ---------------------------------------------------------------------------
-- Seat limits
-- ---------------------------------------------------------------------------
select lives_ok($$ insert into public.tenant_members (tenant_id, user_id, role) values ('00000000-0000-0000-0000-00000000000a', (select id from u where n = 1), 'owner') $$, 'starter: owner seat');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-00000000000a', (select id from u where n = 2)) $$, 'PT402', null, 'starter: 2nd seat blocked');

select lives_ok($$ insert into public.tenant_members (tenant_id, user_id, role) values ('00000000-0000-0000-0000-00000000000d', (select id from u where n = 3), 'owner') $$, 'no plan: owner seat still allowed');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-00000000000d', (select id from u where n = 4)) $$, 'PT402', null, 'no plan: 2nd seat blocked');

select lives_ok($$
  insert into public.tenant_members (tenant_id, user_id, role) values
    ('00000000-0000-0000-0000-00000000000b', (select id from u where n = 5), 'owner'),
    ('00000000-0000-0000-0000-00000000000b', (select id from u where n = 6), 'member'),
    ('00000000-0000-0000-0000-00000000000b', (select id from u where n = 7), 'member')
$$, 'growth: 3 seats');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-00000000000b', (select id from u where n = 8)) $$, 'PT402', null, 'growth: 4th seat blocked');

select lives_ok($$
  insert into public.tenant_members (tenant_id, user_id, role)
  select '00000000-0000-0000-0000-00000000000c', id, case when n = 9 then 'owner' else 'admin' end::public.member_role
  from u where n between 9 and 15
$$, 'agency (trialing): unlimited seats, admin role allowed');

-- Role gating
select lives_ok($$ insert into public.tenant_members (tenant_id, user_id, role) values ('00000000-0000-0000-0000-00000000000e', (select id from u where n = 16), 'owner') $$, 'growth: owner');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id, role) values ('00000000-0000-0000-0000-00000000000e', (select id from u where n = 17), 'approver') $$, 'PT402', null, 'growth: approver role needs roles_permissions');

-- ---------------------------------------------------------------------------
-- Client / invoice quotas (called directly until those tables exist)
-- ---------------------------------------------------------------------------
select is(private.consume_quota('00000000-0000-0000-0000-00000000000a', 'active_clients', 5), 5, 'starter: 5 clients');
select throws_ok($$ select private.consume_quota('00000000-0000-0000-0000-00000000000a', 'active_clients') $$, 'PT402', null, 'starter: 6th client blocked');
select lives_ok($$ select private.release_quota('00000000-0000-0000-0000-00000000000a', 'active_clients') $$, 'archive a client');
select is(private.consume_quota('00000000-0000-0000-0000-00000000000a', 'active_clients'), 5, 'freed slot can be reused');

select is(private.consume_quota('00000000-0000-0000-0000-00000000000a', 'invoices_issued', 20), 20, 'starter: 20 invoices this month');
select throws_ok($$ select private.consume_quota('00000000-0000-0000-0000-00000000000a', 'invoices_issued') $$, 'PT402', null, 'starter: 21st invoice blocked');
select throws_ok($$ select private.release_quota('00000000-0000-0000-0000-00000000000a', 'invoices_issued') $$, 'P0001', null, 'monthly quota cannot be released');
select is(
  (select period_start from public.tenant_usage where tenant_id = '00000000-0000-0000-0000-00000000000a' and metric = 'invoices_issued'),
  date_trunc('month', now() at time zone 'utc')::date,
  'invoice counter keyed by UTC calendar month'
);

select is(private.consume_quota('00000000-0000-0000-0000-00000000000b', 'invoices_issued', 500), 500, 'growth: unlimited invoices');
select throws_ok($$ select private.consume_quota('00000000-0000-0000-0000-00000000000d', 'active_clients') $$, 'PT402', null, 'no plan: read-only');

-- ---------------------------------------------------------------------------
-- Downgrade: keep data, block new
-- ---------------------------------------------------------------------------
select is(public.apply_subscription_state('evt_B2', 'customer.subscription.updated', '2026-09-10T00:00:00Z', 'cus_B', 'sub_B', 'price_test_starter', 'active', '2026-10-01T00:00:00Z', false), 'applied', 'B downgrades to starter');
select is((select count(*)::int from public.tenant_members where tenant_id = '00000000-0000-0000-0000-00000000000b'), 3, 'downgrade keeps existing members');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-00000000000b', (select id from u where n = 8)) $$, 'PT402', null, 'over-limit tenant cannot add seats');
delete from public.tenant_members where tenant_id = '00000000-0000-0000-0000-00000000000b' and user_id = (select id from u where n = 7);
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-00000000000b', (select id from u where n = 8)) $$, 'PT402', null, 'still over limit after one removal');
select is(
  (select row(effective_plan::text, effective_limit, used, remaining)::text from public.tenant_entitlements where tenant_id = '00000000-0000-0000-0000-00000000000b' and metric = 'team_seats'),
  '(starter,1,2,0)',
  'entitlements view reflects downgrade'
);
select is(
  (select effective_limit from public.tenant_entitlements where tenant_id = '00000000-0000-0000-0000-00000000000b' and metric = 'invoices_issued'),
  20,
  'monthly usage carries over; new limit applies immediately'
);

-- ---------------------------------------------------------------------------
-- Features
-- ---------------------------------------------------------------------------
select ok(private.has_feature('00000000-0000-0000-0000-00000000000e', 'recurring_invoices'), 'growth has recurring invoices');
select ok(not private.has_feature('00000000-0000-0000-0000-00000000000e', 'data_export'), 'growth lacks data export');
select ok(private.has_feature('00000000-0000-0000-0000-00000000000c', 'white_label'), 'agency (trialing) has white label');

select is(public.apply_subscription_state('evt_C2', 'customer.subscription.deleted', '2026-09-20T00:00:00Z', 'cus_C', 'sub_C', 'price_test_agency', 'canceled', null, false), 'applied', 'C cancels');
select ok(not private.has_feature('00000000-0000-0000-0000-00000000000c', 'online_payments'), 'canceled tenant loses features');
select throws_ok($$ select private.consume_quota('00000000-0000-0000-0000-00000000000c', 'active_clients') $$, 'PT402', null, 'canceled tenant is read-only');

-- ---------------------------------------------------------------------------
-- Reconcile
-- ---------------------------------------------------------------------------
update public.tenant_usage set used = 99 where tenant_id = '00000000-0000-0000-0000-00000000000c' and metric = 'team_seats';
select private.reconcile_usage('00000000-0000-0000-0000-00000000000c');
select is((select used from public.tenant_usage where tenant_id = '00000000-0000-0000-0000-00000000000c' and metric = 'team_seats'), 7, 'reconcile repairs seat drift');

-- ---------------------------------------------------------------------------
-- RLS + privileges (as tenant A's owner)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select id from u where n = 1), 'role', 'authenticated')::text, true);
-- Older auth.uid() builds read only the legacy per-claim setting.
select set_config('request.jwt.claim.sub', (select id from u where n = 1)::text, true);
set local role authenticated;

select is((select array_agg(id) from public.tenants), array['00000000-0000-0000-0000-00000000000a'::uuid], 'sees only own tenant');
select is((select count(*)::int from public.tenant_subscriptions), 1, 'sees only own subscription');
select is((select count(*)::int from public.tenant_usage where tenant_id <> '00000000-0000-0000-0000-00000000000a'), 0, 'no foreign usage rows');
select is((select count(*)::int from public.tenant_members where tenant_id <> '00000000-0000-0000-0000-00000000000a'), 0, 'no foreign members');
select is((select count(*)::int from public.tenant_entitlements), 3, 'entitlements: own tenant x 3 metrics');
select is((select count(*)::int from public.tenant_features), 1, 'features: starter has online_payments only');
select is((select count(*)::int from public.plans), 3, 'catalog readable');

select throws_ok($$ insert into public.tenant_usage (tenant_id, metric, period_start) values ('00000000-0000-0000-0000-00000000000a', 'active_clients', '2000-01-01') $$, '42501', null, 'cannot write usage');
select throws_ok($$ update public.tenant_subscriptions set status = 'active' $$, '42501', null, 'cannot write subscription');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0001-000000000018') $$, '42501', null, 'cannot add members directly');
select throws_ok($$ select private.consume_quota('00000000-0000-0000-0000-00000000000a', 'active_clients') $$, '42501', null, 'cannot call consume_quota');
select throws_ok($$ select private.release_quota('00000000-0000-0000-0000-00000000000a', 'active_clients') $$, '42501', null, 'cannot call release_quota');
select throws_ok($$ select public.apply_subscription_state('evt_hack', 'x', now(), 'cus_A', 'sub_A', 'price_test_agency', 'active', null, false) $$, '42501', null, 'cannot call apply_subscription_state');
select throws_ok($$ select public.sync_plan_prices('[]'::jsonb) $$, '42501', null, 'cannot call sync_plan_prices');
select throws_ok($$ select * from public.stripe_webhook_events $$, '42501', null, 'cannot read webhook ledger');

reset role;
set local role anon;
select throws_ok($$ select * from public.tenants $$, '42501', null, 'anon cannot read tenants');
select throws_ok($$ select * from public.tenant_entitlements $$, '42501', null, 'anon cannot read entitlements');
select is((select count(*)::int from public.plan_limits), 9, 'anon can read plan limits (pricing page)');
reset role;

select * from finish();
rollback;

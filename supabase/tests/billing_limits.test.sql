begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
select ('00000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@test.local'
from generate_series(1, 30) n;

create temp table u as
select n, ('00000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid as id
from generate_series(1, 30) n;

insert into public.tenants (id, name, stripe_customer_id) values
  ('00000000-0000-0000-0000-00000000000a', 'A starter', 'cus_A'),
  ('00000000-0000-0000-0000-00000000000b', 'B growth',  'cus_B'),
  ('00000000-0000-0000-0000-00000000000c', 'C agency',  'cus_C'),
  ('00000000-0000-0000-0000-00000000000d', 'D no plan', 'cus_D'),
  ('00000000-0000-0000-0000-00000000000e', 'E growth',  'cus_E'),
  ('00000000-0000-0000-0000-00000000000f', 'F unpaid',  'cus_F'),
  ('00000000-0000-0000-0000-000000000010', 'G trial',   'cus_G'),
  ('00000000-0000-0000-0000-000000000011', 'H dunning', 'cus_H'),
  ('00000000-0000-0000-0000-000000000012', 'I changes', 'cus_I');

-- Webhook-style call: ticket (p_seq) taken before the Stripe fetch.
create function pg_temp.sync(
  p_event text, p_seq bigint, p_cus text, p_sub text, p_price text,
  p_status public.subscription_status, p_paid_at timestamptz default null,
  p_type text default 'customer.subscription.updated'
) returns text language sql as $f$
  select public.apply_subscription_state(
    p_event_id => p_event, p_event_type => p_type, p_sync_seq => p_seq,
    p_customer_id => p_cus, p_subscription_id => p_sub, p_price_id => p_price,
    p_status => p_status, p_payment_confirmed_at => p_paid_at)
$f$;

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

-- Subscriptions via the webhook RPC (invoice.paid = verified payment)
select is(pg_temp.sync('evt_A1', 100, 'cus_A', 'sub_A', 'price_test_starter',   'active', '2026-09-01', 'invoice.paid'), 'applied', 'A pays for starter');
select is(pg_temp.sync('evt_B1', 101, 'cus_B', 'sub_B', 'price_test_growth',    'active', '2026-09-01', 'invoice.paid'), 'applied', 'B pays for grandfathered growth price');
select is(pg_temp.sync('evt_C1', 102, 'cus_C', 'sub_C', 'price_test_agency',    'active', '2026-09-01', 'invoice.paid'), 'applied', 'C pays for agency');
select is(pg_temp.sync('evt_E1', 103, 'cus_E', 'sub_E', 'price_test_growth_v2', 'active', '2026-09-01', 'invoice.paid'), 'applied', 'E pays for growth');

-- ---------------------------------------------------------------------------
-- Payment gate: no plan access without a confirmed payment
-- ---------------------------------------------------------------------------
select is(pg_temp.sync('evt_F1', 200, 'cus_F', 'sub_F', 'price_test_agency', 'incomplete', null, 'customer.subscription.created'), 'applied', 'F: checkout started, payment pending');
select is(pg_temp.sync('evt_F2', 202, 'cus_F', 'sub_F', 'price_test_agency', 'active'), 'applied', 'F: status active, invoice.paid not received yet');
select ok(not private.has_feature('00000000-0000-0000-0000-00000000000f', 'white_label'), 'active but unpaid: no features');
select throws_ok($$ select private.consume_quota('00000000-0000-0000-0000-00000000000f', 'active_clients') $$, 'PT402', null, 'active but unpaid: read-only');
select is((select effective_plan::text from public.tenant_entitlements where tenant_id = '00000000-0000-0000-0000-00000000000f' and metric = 'team_seats'), null, 'active but unpaid: no effective plan');

-- invoice.paid committed after a newer snapshot: the stale snapshot is
-- skipped but the payment is still recorded.
select is(pg_temp.sync('evt_F3', 201, 'cus_F', 'sub_F', 'price_test_agency', 'active', '2026-09-05', 'invoice.paid'), 'payment_confirmed', 'late invoice.paid still confirms payment');
select ok(private.has_feature('00000000-0000-0000-0000-00000000000f', 'white_label'), 'paid: agency features unlocked');
select is(pg_temp.sync('evt_F3', 201, 'cus_F', 'sub_F', 'price_test_agency', 'active', '2026-09-05', 'invoice.paid'), 'duplicate', 'redelivered invoice.paid is a no-op');
select is((select count(*)::int from public.stripe_webhook_events where event_id = 'evt_F3'), 1, 'event recorded exactly once');

select is(pg_temp.sync('evt_F4', 210, 'cus_F', 'sub_F', 'price_test_agency', 'active'), 'applied', 'later subscription.updated without payment info');
select isnt((select payment_confirmed_at from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-00000000000f'), null, 'confirmation survives later updates');

select is(pg_temp.sync('evt_F5', 220, 'cus_F', 'sub_F', 'price_test_agency', 'past_due'), 'applied', 'renewal payment failing');
select ok(private.has_feature('00000000-0000-0000-0000-00000000000f', 'white_label'), 'past_due after a confirmed payment keeps access (retry window)');
select is(pg_temp.sync('evt_F6', 230, 'cus_F', 'sub_F', 'price_test_agency', 'unpaid'), 'applied', 'retries exhausted (mark-unpaid setting)');
select ok(not private.has_feature('00000000-0000-0000-0000-00000000000f', 'white_label'), 'unpaid: access removed');

-- New subscription for the same tenant starts unconfirmed.
select is(pg_temp.sync('evt_F7', 240, 'cus_F', 'sub_F2', 'price_test_starter', 'active', null, 'customer.subscription.created'), 'applied', 'F starts a new subscription');
select is((select payment_confirmed_at from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-00000000000f'), null, 'confirmation does not carry over to a new subscription');

-- Trials never grant access, even if a confirmation were recorded.
select is(pg_temp.sync('evt_G1', 100, 'cus_G', 'sub_G', 'price_test_agency', 'trialing', '2026-09-01', 'invoice.paid'), 'applied', 'G trialing');
select ok(not private.has_feature('00000000-0000-0000-0000-000000000010', 'online_payments'), 'trialing: no access');

-- Two paid subscriptions at once are reported whichever one wins.
select is(pg_temp.sync('evt_E_dup', 300, 'cus_E', 'sub_E_dup', 'price_test_growth_v2', 'active', '2026-09-02', 'invoice.paid'), 'applied_replaced_live_subscription', 'double paid subscription is flagged');
select is(pg_temp.sync('evt_E_back', 301, 'cus_E', 'sub_E', 'price_test_growth_v2', 'active', '2026-09-01', 'invoice.paid'), 'applied_replaced_live_subscription', 'restore E to its original subscription');
select is(pg_temp.sync('evt_E_dup2', 250, 'cus_E', 'sub_E_dup', 'price_test_growth_v2', 'active', '2026-09-02', 'invoice.paid'), 'ignored_duplicate_live_subscription', 'older paid duplicate is flagged but not applied');
select is((select stripe_subscription_id from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-00000000000e'), 'sub_E', 'E keeps its original subscription');

-- ---------------------------------------------------------------------------
-- Revenue Recovery mirror: past_due while retrying, then canceled
-- (Dashboard: cancel the subscription, leave the invoice past-due)
-- ---------------------------------------------------------------------------
select is(pg_temp.sync('evt_H1', 600, 'cus_H', 'sub_H2', 'price_test_growth_v2', 'incomplete', null, 'customer.subscription.created'), 'applied', 'H: new subscription pending');
select is(pg_temp.sync('evt_H0', 601, 'cus_H', 'sub_H1', 'price_test_growth_v2', 'canceled', null, 'customer.subscription.deleted'), 'ignored_other_subscription', 'an old canceled subscription never replaces a pending one');
select is(pg_temp.sync('evt_H2', 610, 'cus_H', 'sub_H2', 'price_test_growth_v2', 'active', '2026-09-10', 'invoice.paid'), 'applied', 'H pays');
select is(public.apply_subscription_state(
  p_event_id => 'evt_H3', p_event_type => 'invoice.payment_failed', p_sync_seq => 620,
  p_customer_id => 'cus_H', p_subscription_id => 'sub_H2', p_price_id => 'price_test_growth_v2',
  p_status => 'past_due', p_current_period_start => '2026-10-10', p_current_period_end => '2026-11-10',
  p_latest_invoice_id => 'in_H_renewal', p_latest_invoice_status => 'open',
  p_next_payment_attempt => '2026-10-13'), 'applied', 'H renewal fails, Stripe schedules a retry');
select is(
  (select row(status, latest_invoice_id, latest_invoice_status, next_payment_attempt, current_period_end)::text
   from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-000000000011'),
  (select row('past_due'::public.subscription_status, 'in_H_renewal', 'open'::public.stripe_invoice_status, '2026-10-13'::timestamptz, '2026-11-10'::timestamptz)::text),
  'dunning state mirrored');
select ok(private.has_feature('00000000-0000-0000-0000-000000000011', 'recurring_invoices'), 'past_due: access kept during retries');
-- Same-second events: a snapshot fetched earlier but committed later is stale.
select is(pg_temp.sync('evt_H4', 615, 'cus_H', 'sub_H2', 'price_test_growth_v2', 'active'), 'stale', 'earlier-ticket snapshot cannot overwrite a newer one');
select is(public.apply_subscription_state(
  p_event_id => 'evt_H5', p_event_type => 'customer.subscription.deleted', p_sync_seq => 630,
  p_customer_id => 'cus_H', p_subscription_id => 'sub_H2', p_price_id => 'price_test_growth_v2',
  p_status => 'canceled', p_canceled_at => '2026-10-24', p_ended_at => '2026-10-24',
  p_latest_invoice_id => 'in_H_renewal', p_latest_invoice_status => 'open'), 'applied', 'all retries failed: Stripe cancels');
select ok(not private.has_feature('00000000-0000-0000-0000-000000000011', 'recurring_invoices'), 'canceled after failed retries: access removed');
select is((select latest_invoice_status::text from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-000000000011'), 'open', 'invoice left past-due');
select is(pg_temp.sync('evt_H6', 640, 'cus_H', 'sub_H2', 'price_test_growth_v2', 'canceled', '2026-10-30', 'invoice.paid'), 'applied', 'customer pays the old invoice later');
select ok(not private.has_feature('00000000-0000-0000-0000-000000000011', 'recurring_invoices'), 'paying a canceled subscription does not restore access');

-- ---------------------------------------------------------------------------
-- Webhook idempotency / ordering
-- ---------------------------------------------------------------------------
select is(pg_temp.sync('evt_A1', 900, 'cus_A', 'sub_A', 'price_test_agency', 'active', null, 'customer.subscription.created'), 'duplicate', 'replayed event is a no-op');
select is((select plan_code::text from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-00000000000a'), 'starter', 'duplicate did not change plan');

select is(pg_temp.sync('evt_A0', 50, 'cus_A', 'sub_A', 'price_test_agency', 'active'), 'stale', 'older snapshot is skipped');

select is(pg_temp.sync('evt_A_other', 400, 'cus_A', 'sub_A_dup', 'price_test_starter', 'canceled', null, 'customer.subscription.deleted'), 'ignored_other_subscription', 'dead secondary subscription does not clobber live one');

-- Reconciliation: no event id, no ledger row.
select is(pg_temp.sync(null, 410, 'cus_A', 'sub_A', 'price_test_starter', 'active', null, 'reconcile'), 'applied', 'reconciliation snapshot applies');
select is((select count(*)::int from public.stripe_webhook_events where type = 'reconcile'), 0, 'reconciliation is not recorded as an event');

select throws_ok($$ select pg_temp.sync('evt_no_seq', null, 'cus_A', 'sub_A', 'price_test_starter', 'active') $$, 'P0001', null, 'a sync ticket is required');
select ok(public.stripe_sync_ticket() > 0, 'tickets are issued');

select throws_ok($$
  select pg_temp.sync('evt_bad_price', 420, 'cus_A', 'sub_A', 'price_unknown', 'active')
$$, 'P0001', null, 'unmapped price raises (Stripe will retry)');
select is((select count(*)::int from public.stripe_webhook_events where event_id = 'evt_bad_price'), 0, 'failed event is not recorded as processed');

select throws_ok($$
  select pg_temp.sync('evt_bad_cus', 420, 'cus_nobody', 'sub_X', 'price_test_starter', 'active')
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
select is(pg_temp.sync('evt_B2', 700, 'cus_B', 'sub_B', 'price_test_starter', 'active'), 'applied', 'B downgrades to starter');
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

select is(pg_temp.sync('evt_C2', 710, 'cus_C', 'sub_C', 'price_test_agency', 'canceled', null, 'customer.subscription.deleted'), 'applied', 'C cancels');
select ok(not private.has_feature('00000000-0000-0000-0000-00000000000c', 'online_payments'), 'canceled tenant loses features');
select throws_ok($$ select private.consume_quota('00000000-0000-0000-0000-00000000000c', 'active_clients') $$, 'PT402', null, 'canceled tenant is read-only');

-- ---------------------------------------------------------------------------
-- Reconcile
-- ---------------------------------------------------------------------------
update public.tenant_usage set used = 99 where tenant_id = '00000000-0000-0000-0000-00000000000c' and metric = 'team_seats';
select private.reconcile_usage('00000000-0000-0000-0000-00000000000c');
select is((select used from public.tenant_usage where tenant_id = '00000000-0000-0000-0000-00000000000c' and metric = 'team_seats'), 7, 'reconcile repairs seat drift');

-- ---------------------------------------------------------------------------
-- Plan changes: immediate upgrade, pending upgrade, scheduled downgrade
-- ---------------------------------------------------------------------------
select is(pg_temp.sync('evt_I1', 1000, 'cus_I', 'sub_I', 'price_test_starter', 'active', '2026-09-01', 'invoice.paid'), 'applied', 'I pays for starter');
select lives_ok($$ insert into public.tenant_members (tenant_id, user_id, role) values ('00000000-0000-0000-0000-000000000012', (select id from u where n = 21), 'owner') $$, 'I starter: owner seat');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-000000000012', (select id from u where n = 22)) $$, 'PT402', null, 'I starter: 2nd seat blocked');

-- change-plan writes Stripe's response through before replying.
select is(pg_temp.sync(null, 1001, 'cus_I', 'sub_I', 'price_test_growth_v2', 'active', null, 'change_plan'), 'applied', 'upgrade to growth applied');
select lives_ok($$
  insert into public.tenant_members (tenant_id, user_id) values
    ('00000000-0000-0000-0000-000000000012', (select id from u where n = 22)),
    ('00000000-0000-0000-0000-000000000012', (select id from u where n = 23))
$$, 'upgrade: growth seats usable in the very next statement');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-000000000012', (select id from u where n = 24)) $$, 'PT402', null, 'growth: 4th seat blocked');
select isnt((select payment_confirmed_at from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-000000000012'), null, 'upgrade keeps the payment confirmation');

-- Upgrade to agency whose invoice is not paid yet (pending_if_incomplete).
select is(public.apply_subscription_state(
  p_event_id => null, p_event_type => 'change_plan', p_sync_seq => 1002,
  p_customer_id => 'cus_I', p_subscription_id => 'sub_I', p_price_id => 'price_test_growth_v2', p_status => 'active',
  p_pending_price_id => 'price_test_agency', p_pending_update_expires_at => now() + interval '23 hours'), 'applied', 'pending upgrade mirrored');
select is((select pending_plan_code::text from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-000000000012'), 'agency', 'pending plan resolved from its price');
select is((select effective_plan::text from public.tenant_entitlements where tenant_id = '00000000-0000-0000-0000-000000000012' and metric = 'team_seats'), 'growth', 'unpaid upgrade grants nothing');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-000000000012', (select id from u where n = 24)) $$, 'PT402', null, 'unpaid upgrade: still growth seat limit');
select ok(not private.has_feature('00000000-0000-0000-0000-000000000012', 'white_label'), 'unpaid upgrade: no agency features');

-- Downgrade scheduled for the period end.
select is(public.apply_subscription_state(
  p_event_id => 'evt_I_sched', p_event_type => 'subscription_schedule.updated', p_sync_seq => 1003,
  p_customer_id => 'cus_I', p_subscription_id => 'sub_I', p_price_id => 'price_test_growth_v2', p_status => 'active',
  p_schedule_id => 'sub_sched_I', p_scheduled_price_id => 'price_test_starter', p_scheduled_change_at => now() + interval '10 days'),
  'applied', 'scheduled downgrade mirrored');
select is((select row(pending_price_id, scheduled_plan_code)::text from public.tenant_subscriptions where tenant_id = '00000000-0000-0000-0000-000000000012'),
  '(,starter)', 'pending upgrade cleared, downgrade scheduled');
select is((select effective_plan::text from public.tenant_entitlements where tenant_id = '00000000-0000-0000-0000-000000000012' and metric = 'team_seats'), 'growth', 'paid-for plan kept until the period ends');
select ok(private.has_feature('00000000-0000-0000-0000-000000000012', 'recurring_invoices'), 'growth features kept until the period ends');

-- Period end passes before the renewal webhook arrives.
select is(public.apply_subscription_state(
  p_event_id => null, p_event_type => 'reconcile', p_sync_seq => 1004,
  p_customer_id => 'cus_I', p_subscription_id => 'sub_I', p_price_id => 'price_test_growth_v2', p_status => 'active',
  p_schedule_id => 'sub_sched_I', p_scheduled_price_id => 'price_test_starter', p_scheduled_change_at => now() - interval '1 second'),
  'applied', 'scheduled downgrade now due');
select is((select effective_plan::text from public.tenant_entitlements where tenant_id = '00000000-0000-0000-0000-000000000012' and metric = 'team_seats'), 'starter', 'due downgrade applies immediately');
select is(private.effective_plan('00000000-0000-0000-0000-000000000012')::text, 'starter', 'effective_plan agrees');
select ok(not private.has_feature('00000000-0000-0000-0000-000000000012', 'recurring_invoices'), 'due downgrade removes growth features');
select is((select count(*)::int from public.tenant_features where tenant_id = '00000000-0000-0000-0000-000000000012'), 1, 'features view: starter only');
select throws_ok($$ insert into public.tenant_members (tenant_id, user_id) values ('00000000-0000-0000-0000-000000000012', (select id from u where n = 24)) $$, 'PT402', null, 'due downgrade: new seats blocked');
select is((select count(*)::int from public.tenant_members where tenant_id = '00000000-0000-0000-0000-000000000012'), 3, 'due downgrade keeps existing members');

-- A scheduled UPGRADE never applies before Stripe's own snapshot.
select is(public.apply_subscription_state(
  p_event_id => null, p_event_type => 'reconcile', p_sync_seq => 1005,
  p_customer_id => 'cus_I', p_subscription_id => 'sub_I', p_price_id => 'price_test_starter', p_status => 'active',
  p_schedule_id => 'sub_sched_I2', p_scheduled_price_id => 'price_test_agency', p_scheduled_change_at => now() - interval '1 second'),
  'applied', 'stripe moved to starter; an upgrade is scheduled');
select is(private.effective_plan('00000000-0000-0000-0000-000000000012')::text, 'starter', 'due scheduled upgrade waits for Stripe');

select throws_ok($$
  select public.apply_subscription_state(p_event_id => null, p_event_type => 'reconcile', p_sync_seq => 1006,
    p_customer_id => 'cus_I', p_subscription_id => 'sub_I', p_price_id => 'price_test_starter', p_status => 'active',
    p_pending_price_id => 'price_unknown', p_pending_update_expires_at => now())
$$, 'P0001', null, 'unmapped pending price raises');
select throws_ok($$
  select public.apply_subscription_state(p_event_id => null, p_event_type => 'reconcile', p_sync_seq => 1006,
    p_customer_id => 'cus_I', p_subscription_id => 'sub_I', p_price_id => 'price_test_starter', p_status => 'active',
    p_schedule_id => 'sub_sched_I', p_scheduled_price_id => 'price_unknown', p_scheduled_change_at => now())
$$, 'P0001', null, 'unmapped scheduled price raises');
select throws_ok($$ update public.tenant_subscriptions set scheduled_change_at = null where tenant_id = '00000000-0000-0000-0000-000000000012' $$, '23514', null, 'scheduled fields are all-or-none');
select throws_ok($$ update public.tenant_subscriptions set stripe_schedule_id = null where tenant_id = '00000000-0000-0000-0000-000000000012' $$, '23514', null, 'a scheduled change needs its schedule');

-- Plan-change lease
select ok(public.acquire_plan_change_lease('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1'), 'lease acquired');
select ok(not public.acquire_plan_change_lease('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a2'), 'second holder is refused');
select ok(public.acquire_plan_change_lease('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1'), 'holder can extend its lease');
select ok(not public.release_plan_change_lease('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a2'), 'only the holder can release');
update private.plan_change_leases set expires_at = clock_timestamp() - interval '1 second' where tenant_id = '00000000-0000-0000-0000-000000000012';
select ok(public.acquire_plan_change_lease('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a2'), 'expired lease can be taken over');
select ok(public.release_plan_change_lease('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a2'), 'holder releases');
select ok(public.acquire_plan_change_lease('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1'), 'released lease is free again');
select throws_ok($$ select public.acquire_plan_change_lease('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a1', 0) $$, 'P0001', null, 'lease ttl is bounded');

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
select throws_ok($$ select public.apply_subscription_state('evt_hack', 'x', 1, 'cus_A', 'sub_A', 'price_test_agency', 'active') $$, '42501', null, 'cannot call apply_subscription_state');
select throws_ok($$ select public.stripe_sync_ticket() $$, '42501', null, 'cannot take sync tickets');
select throws_ok($$ select public.acquire_plan_change_lease('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1') $$, '42501', null, 'cannot take plan-change leases');
select throws_ok($$ select public.release_plan_change_lease('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1') $$, '42501', null, 'cannot release plan-change leases');
select throws_ok($$ select * from private.plan_change_leases $$, '42501', null, 'cannot read plan-change leases');
select throws_ok($$ select public.sync_plan_prices('[]'::jsonb) $$, '42501', null, 'cannot call sync_plan_prices');
select throws_ok($$ select * from public.stripe_webhook_events $$, '42501', null, 'cannot read webhook ledger');

-- Self-service workspace creation (still as tenant A's owner)
select ok(public.create_tenant('  Fresh Workspace  ') is not null, 'create_tenant returns the new id');
select is((select name from public.tenants where name like '%Fresh%'), 'Fresh Workspace', 'name is trimmed; creator can read the new workspace');
select is((select role::text from public.tenant_members m join public.tenants t on t.id = m.tenant_id where t.name = 'Fresh Workspace'), 'owner', 'creator is the owner');
select is((select effective_plan::text from public.tenant_entitlements e join public.tenants t on t.id = e.tenant_id where t.name = 'Fresh Workspace' and e.metric = 'team_seats'), null, 'new workspace has no plan (read-only)');
select throws_ok($$ select public.create_tenant('   ') $$, '22023', null, 'blank workspace name rejected');
select lives_ok($$ select public.create_tenant('WS 3'); select public.create_tenant('WS 4'); select public.create_tenant('WS 5') $$, 'up to 5 owned workspaces');
select throws_ok($$ select public.create_tenant('WS 6') $$, 'P0001', null, 'a 6th owned workspace is refused');

reset role;
set local role anon;
select throws_ok($$ select * from public.tenants $$, '42501', null, 'anon cannot read tenants');
select throws_ok($$ select * from public.tenant_entitlements $$, '42501', null, 'anon cannot read entitlements');
select throws_ok($$ select public.create_tenant('Anon WS') $$, '42501', null, 'anon cannot create workspaces');
select is((select count(*)::int from public.plan_limits), 9, 'anon can read plan limits (pricing page)');
reset role;

select * from finish();
rollback;

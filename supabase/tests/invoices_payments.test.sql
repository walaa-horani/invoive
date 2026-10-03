begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures: tenant P (starter, connected Stripe account) and tenant Q
-- (growth, its own account). u1 = P owner, u2 = P approver, u3 = Q owner.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
select ('00000000-0000-0000-0002-' || lpad(n::text, 12, '0'))::uuid, 'p' || n || '@test.local'
from generate_series(1, 3) n;

create temp table u as
select n, ('00000000-0000-0000-0002-' || lpad(n::text, 12, '0'))::uuid as id
from generate_series(1, 3) n;
grant select on u to authenticated, service_role;

select public.sync_plan_prices('[
  {"plan_code":"starter","stripe_price_id":"price_t_starter","stripe_product_id":"prod_s","unit_amount":599,"currency":"usd"},
  {"plan_code":"growth","stripe_price_id":"price_t_growth","stripe_product_id":"prod_g","unit_amount":1499,"currency":"usd"},
  {"plan_code":"agency","stripe_price_id":"price_t_agency","stripe_product_id":"prod_a","unit_amount":1999,"currency":"usd"}
]'::jsonb);

insert into public.tenants (id, name, stripe_customer_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'P studio', 'cus_P'),
  ('00000000-0000-0000-0000-0000000000a2', 'Q agency', 'cus_Q');

select public.apply_subscription_state(
  p_event_id => 'evt_P', p_event_type => 'invoice.paid', p_sync_seq => 1,
  p_customer_id => 'cus_P', p_subscription_id => 'sub_P', p_price_id => 'price_t_starter',
  p_status => 'active', p_payment_confirmed_at => now());
select public.apply_subscription_state(
  p_event_id => 'evt_Q', p_event_type => 'invoice.paid', p_sync_seq => 2,
  p_customer_id => 'cus_Q', p_subscription_id => 'sub_Q', p_price_id => 'price_t_agency',
  p_status => 'active', p_payment_confirmed_at => now());

insert into public.tenant_members (tenant_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', (select id from u where n = 1), 'owner'),
  ('00000000-0000-0000-0000-0000000000a2', (select id from u where n = 3), 'owner');

insert into public.clients (id, tenant_id, name, email) values
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Pat Client', 'pat@client.test'),
  ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0000-0000000000a2', 'Quinn Client', 'quinn@client.test');

create function pg_temp.as_user(p_n integer) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', (select id from u where n = p_n), 'role', 'authenticated')::text, true);
  select set_config('request.jwt.claim.sub', (select id from u where n = p_n)::text, true);
$f$;

create temp table t (k text primary key, v text);
grant all on t to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Drafts and line items, as P's owner
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
set local role authenticated;

select lives_ok($$
  with x as (
    insert into public.invoices (tenant_id, client_id, due_date)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0003-000000000001', current_date + 14)
    returning id)
  insert into t select 'api_draft', id::text from x
$$, 'owner creates a draft');
select throws_ok($$
  insert into public.invoices (id, tenant_id, client_id)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0003-000000000001')
$$, '42501', null, 'ids are generated, not chosen');
reset role;
-- Fixed id for the rest of the suite (ids aren't insertable through the API).
insert into public.invoices (id, tenant_id, client_id, due_date)
values ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0003-000000000001', current_date + 14);
set local role authenticated;

select throws_ok($$
  insert into public.invoices (tenant_id, client_id)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0003-000000000002')
$$, '23503', null, 'a draft cannot point at another workspace''s client');

select throws_ok($$
  insert into public.invoices (tenant_id, client_id)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0003-000000000002')
$$, '42501', null, 'cannot create invoices in another workspace');

select throws_ok($$
  insert into public.invoices (tenant_id, client_id, status)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0003-000000000001', 'paid')
$$, '42501', null, 'status is not insertable');

select lives_ok($$
  insert into public.invoice_items (tenant_id, invoice_id, position, description, quantity, unit_amount, tax_rate_bps) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0004-000000000001', 0, 'Design work', 2.5, 4000, 1000),
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0004-000000000001', 1, 'Hosting', 1, 2000, 0)
$$, 'owner adds line items');

select results_eq(
  $$ select subtotal, tax_total, total from public.invoices where id = '00000000-0000-0000-0004-000000000001' $$,
  $$ values (12000::bigint, 1000::bigint, 13000::bigint) $$,
  'totals are computed from the lines');

select throws_ok($$ update public.invoices set total = 1 $$, '42501', null, 'total is not writable');
select throws_ok($$ update public.invoices set status = 'paid' $$, '42501', null, 'status is not writable');
select throws_ok($$ update public.invoices set amount_paid = 13000 $$, '42501', null, 'amount_paid is not writable');
select throws_ok($$ update public.invoices set tenant_id = '00000000-0000-0000-0000-0000000000a2' $$, '42501', null, 'tenant_id is not writable');

select throws_ok($$
  insert into public.invoice_items (tenant_id, invoice_id, description, unit_amount)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0004-000000000001', 'Cross', 100)
$$, '42501', null, 'cannot add lines under another workspace id');

select throws_ok($$ select * from public.invoice_payment_attempts $$, '42501', null, 'checkout_url is not readable');
select lives_ok($$ select id, status, amount from public.invoice_payment_attempts $$, 'payment attempts are readable by column');
select throws_ok($$ select public.begin_invoice_payment('x') $$, '42501', null, 'users cannot start payments directly');
select throws_ok($$ select public.apply_invoice_payment(1, null, null, 'acct_x', 'cs_x', 'complete', 'paid', 1, 'usd') $$, '42501', null, 'users cannot apply payments');

-- Issue
select lives_ok($$
  insert into t select 'p1', public.issue_invoice('00000000-0000-0000-0004-000000000001')::text
$$, 'owner issues the invoice');
select is((select (v::jsonb)->>'number' from t where k = 'p1'), 'INV-0001', 'first number is INV-0001');
select matches((select (v::jsonb)->>'token' from t where k = 'p1'), '^[A-Za-z0-9_-]{43}$', 'pay token is 43 base64url chars');
select is((select used from public.tenant_usage where tenant_id = '00000000-0000-0000-0000-0000000000a1' and metric = 'invoices_issued'), 1, 'issuing counts toward invoices_issued');

select throws_ok($$ select public.issue_invoice('00000000-0000-0000-0004-000000000001') $$, '55000', null, 'cannot issue twice');
select throws_ok($$
  update public.invoice_items set unit_amount = 1 where invoice_id = '00000000-0000-0000-0004-000000000001'
$$, '55000', null, 'lines are frozen once issued');
update public.invoices set notes = 'changed' where id = '00000000-0000-0000-0004-000000000001';
select is((select notes from public.invoices where id = '00000000-0000-0000-0004-000000000001'), null, 'issued invoices cannot be edited');
delete from public.invoices where id = '00000000-0000-0000-0004-000000000001';
select is((select count(*)::int from public.invoices where id = '00000000-0000-0000-0004-000000000001'), 1, 'issued invoices cannot be deleted');
select lives_ok($$ delete from public.invoices where id = (select v::uuid from t where k = 'api_draft') $$, 'drafts can be deleted by the owner');
reset role;

-- ---------------------------------------------------------------------------
-- Other workspaces and roles
-- ---------------------------------------------------------------------------
select pg_temp.as_user(3);
set local role authenticated;
select is((select count(*)::int from public.invoices), 0, 'Q owner sees none of P''s invoices');
select is((select count(*)::int from public.invoice_items), 0, 'Q owner sees none of P''s lines');
select throws_ok($$ select public.issue_invoice('00000000-0000-0000-0004-000000000001') $$, 'P0002', null, 'Q owner cannot issue P''s invoice');
select throws_ok($$ select public.rotate_pay_link('00000000-0000-0000-0004-000000000001') $$, 'P0002', null, 'Q owner cannot rotate P''s link');
select throws_ok($$ select public.void_invoice('00000000-0000-0000-0004-000000000001') $$, 'P0002', null, 'Q owner cannot void P''s invoice');
select throws_ok($$ select public.record_manual_payment('00000000-0000-0000-0004-000000000001') $$, 'P0002', null, 'Q owner cannot mark P''s invoice paid');
reset role;

-- The approver reads but cannot act.
reset role;
insert into public.tenant_members (tenant_id, user_id, role)
select '00000000-0000-0000-0000-0000000000a2', id, 'approver' from u where n = 2;
select pg_temp.as_user(2);
set local role authenticated;
select is((select count(*)::int from public.invoices), 0, 'Q approver sees no P invoices');
select throws_ok($$
  insert into public.invoices (tenant_id, client_id) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0003-000000000002')
$$, '42501', null, 'approver cannot create invoices');
reset role;

-- ---------------------------------------------------------------------------
-- Public pay page (anon)
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select count(*) from public.invoices $$, '42501', null, 'anon cannot read invoices');
select throws_ok($$ select count(*) from public.invoice_payment_attempts $$, '42501', null, 'anon cannot read payments');
select throws_ok($$ select count(*) from public.tenant_payment_accounts $$, '42501', null, 'anon cannot read accounts');
select is(public.get_pay_invoice('not-a-token'), null, 'malformed token opens nothing');
select is(public.get_pay_invoice(repeat('A', 43)), null, 'unknown token opens nothing');
select is((public.get_pay_invoice((select (v::jsonb)->>'token' from t where k = 'p1')))->>'number', 'INV-0001', 'the token opens its invoice');
select is((public.get_pay_invoice((select (v::jsonb)->>'token' from t where k = 'p1')))->>'amount_due', '13000', 'amount due shown');
select is((public.get_pay_invoice((select (v::jsonb)->>'token' from t where k = 'p1')))->>'unavailable_reason', 'payments_unavailable', 'no connected account yet');
select ok(not (public.get_pay_invoice((select (v::jsonb)->>'token' from t where k = 'p1'))) ? 'client_email', 'pay view hides the client email');
select ok(not (public.get_pay_invoice((select (v::jsonb)->>'token' from t where k = 'p1'))) ? 'tenant_id', 'pay view hides ids');
reset role;

-- ---------------------------------------------------------------------------
-- Connect accounts (service role)
-- ---------------------------------------------------------------------------
set local role service_role;
select is(public.register_connect_account('00000000-0000-0000-0000-0000000000a1', 'acct_P'), 'acct_P', 'P registers acct_P');
select is(public.register_connect_account('00000000-0000-0000-0000-0000000000a1', 'acct_P2'), 'acct_P', 'a registered account is never replaced');
select throws_ok($$ select public.register_connect_account('00000000-0000-0000-0000-0000000000a2', 'acct_P') $$, '23505', null, 'one Stripe account cannot serve two workspaces');
select is(public.register_connect_account('00000000-0000-0000-0000-0000000000a2', 'acct_Q'), 'acct_Q', 'Q registers acct_Q');

select throws_ok(
  format('select public.begin_invoice_payment(%L)', (select (v::jsonb)->>'token' from t where k = 'p1')),
  'PT409', null, 'cannot pay while the account is pending');

select is(public.apply_connect_account(10, 'acct_P', 'active', true, false, 'USD'), 'applied', 'acct_P becomes enabled');
select is(public.apply_connect_account(9, 'acct_P', 'pending', false, true, 'usd'), 'stale', 'older account snapshot is ignored');
select is(public.apply_connect_account(11, 'acct_unknown', 'active', true, false, 'usd'), 'orphan', 'unknown account is ignored');
select is(public.apply_connect_account(12, 'acct_Q', 'active', true, false, 'usd'), 'applied', 'acct_Q enabled');
select is((select status::text from public.tenant_payment_accounts where tenant_id = '00000000-0000-0000-0000-0000000000a1'), 'enabled', 'P account enabled');

-- ---------------------------------------------------------------------------
-- Starting a payment
-- ---------------------------------------------------------------------------
select throws_ok($$ select public.begin_invoice_payment('bogus') $$, 'PT404', null, 'invalid token');

insert into t select 'b1', public.begin_invoice_payment((select (v::jsonb)->>'token' from t where k = 'p1'))::text;
select is((select (v::jsonb)->>'amount' from t where k = 'b1'), '13000', 'amount comes from the invoice');
select is((select (v::jsonb)->>'stripe_account_id' from t where k = 'b1'), 'acct_P', 'account comes from the invoice''s workspace');
select is((select (v::jsonb)->>'application_fee_amount' from t where k = 'b1'), '130', 'starter fee is 1%');

select ok(public.attach_checkout_session(((select v from t where k = 'b1')::jsonb->>'attempt_id')::uuid,
  'cs_P1', 'https://checkout.stripe.test/P1', now() + interval '30 minutes'), 'session attached');

select is((public.begin_invoice_payment((select (v::jsonb)->>'token' from t where k = 'p1')))->>'reused', 'true', 'an open session is reused');

-- A newer attempt supersedes one whose session is about to expire.
update public.invoice_payment_attempts set expires_at = now() + interval '1 minute' where checkout_session_id = 'cs_P1';
insert into t select 'b2', public.begin_invoice_payment((select (v::jsonb)->>'token' from t where k = 'p1'))::text;
select is((select (v::jsonb)->'superseded'->0->>'checkout_session_id' from t where k = 'b2'), 'cs_P1', 'old session handed back to be expired');
select is((select status::text from public.invoice_payment_attempts where checkout_session_id = 'cs_P1'), 'expired', 'old attempt closed');
select ok(public.attach_checkout_session(((select v from t where k = 'b2')::jsonb->>'attempt_id')::uuid,
  'cs_P2', 'https://checkout.stripe.test/P2', now() + interval '30 minutes'), 'second session attached');
select is(public.attach_checkout_session(((select v from t where k = 'b1')::jsonb->>'attempt_id')::uuid,
  'cs_late', 'https://x', now()), null, 'cannot attach to a closed attempt');

-- ---------------------------------------------------------------------------
-- Webhook results
-- ---------------------------------------------------------------------------
select is(public.apply_invoice_payment(100, 'evt_x1', 'checkout.session.completed', 'acct_Q', 'cs_P2', 'complete', 'paid', 13000, 'usd', 'pi_P2'),
  'orphan', 'the same session id on another account changes nothing');
select is(public.apply_invoice_payment(101, 'evt_x2', 'checkout.session.completed', 'acct_P', 'cs_forged', 'complete', 'paid', 13000, 'usd', 'pi_forged'),
  'orphan', 'a session we did not create changes nothing');
select is((select status::text from public.invoices where id = '00000000-0000-0000-0004-000000000001'), 'issued', 'invoice still unpaid after orphans');

select is(public.apply_invoice_payment(102, 'evt_p1', 'checkout.session.completed', 'acct_P', 'cs_P2', 'complete', 'paid', 12999, 'usd', 'pi_P2'),
  'applied', 'mismatched amount applied');
select is((select status::text from public.invoice_payment_attempts where checkout_session_id = 'cs_P2'), 'needs_review', 'mismatched amount needs review');
select is((select status::text from public.invoices where id = '00000000-0000-0000-0004-000000000001'), 'issued', 'mismatched amount does not pay the invoice');

select is(public.apply_invoice_payment(103, 'evt_p2', 'checkout.session.completed', 'acct_P', 'cs_P2', 'complete', 'paid', 13000, 'usd', 'pi_P2', 'succeeded', 0, null, now()),
  'applied', 'correct snapshot applied');
select is((select status::text from public.invoices where id = '00000000-0000-0000-0004-000000000001'), 'paid', 'invoice paid');
select is((select amount_paid from public.invoices where id = '00000000-0000-0000-0004-000000000001'), 13000::bigint, 'amount_paid recorded');
select is(public.apply_invoice_payment(104, 'evt_p2', 'checkout.session.completed', 'acct_P', 'cs_P2', 'complete', 'paid', 13000, 'usd', 'pi_P2'),
  'duplicate', 'redelivered event is a no-op');
select is(public.apply_invoice_payment(50, 'evt_p3', 'checkout.session.expired', 'acct_P', 'cs_P2', 'expired', 'unpaid', 13000, 'usd'),
  'stale', 'an older snapshot cannot undo the payment');
select throws_ok(
  format('select public.begin_invoice_payment(%L)', (select (v::jsonb)->>'token' from t where k = 'p1')),
  'PT409', null, 'a paid invoice cannot be paid again');

-- Refund in the tenant's Dashboard
select is(public.apply_invoice_payment(105, 'evt_p4', 'charge.refunded', 'acct_P', 'cs_P2', 'complete', 'paid', 13000, 'usd', 'pi_P2', 'succeeded', 3000),
  'applied', 'partial refund applied');
select results_eq($$ select status::text, amount_paid from public.invoices where id = '00000000-0000-0000-0004-000000000001' $$,
  $$ values ('issued', 10000::bigint) $$, 'partial refund reopens the invoice for the balance');
select is(public.apply_invoice_payment(106, 'evt_p5', 'charge.refunded', 'acct_P', 'cs_P2', 'complete', 'paid', 13000, 'usd', 'pi_P2', 'succeeded', 13000),
  'applied', 'full refund applied');
select is((select status::text from public.invoice_payment_attempts where checkout_session_id = 'cs_P2'), 'refunded', 'attempt refunded');
select is((select amount_paid from public.invoices where id = '00000000-0000-0000-0004-000000000001'), 0::bigint, 'nothing paid after full refund');
reset role;

-- ---------------------------------------------------------------------------
-- Rotation, manual payment, void, quota
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
set local role authenticated;
insert into t select 'p1b', public.rotate_pay_link('00000000-0000-0000-0004-000000000001');
reset role;
select is(public.get_pay_invoice((select (v::jsonb)->>'token' from t where k = 'p1')), null, 'rotated token no longer works');
select is((public.get_pay_invoice((select v from t where k = 'p1b')))->>'number', 'INV-0001', 'new token works');

select pg_temp.as_user(1);
set local role authenticated;
select lives_ok($$ select public.record_manual_payment('00000000-0000-0000-0004-000000000001') $$, 'owner records a bank transfer');
select is((select status::text from public.invoices where id = '00000000-0000-0000-0004-000000000001'), 'paid', 'manual payment pays the invoice');
select throws_ok($$ select public.void_invoice('00000000-0000-0000-0004-000000000001') $$, '55000', null, 'paid invoices cannot be voided');

-- Second invoice: void kills the link.
reset role;
insert into public.invoices (id, tenant_id, client_id) values
  ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0003-000000000001');
set local role authenticated;
insert into public.invoice_items (tenant_id, invoice_id, description, unit_amount) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0004-000000000002', 'Retainer', 50000);
insert into t select 'p2', public.issue_invoice('00000000-0000-0000-0004-000000000002')::text;
select is((select (v::jsonb)->>'number' from t where k = 'p2'), 'INV-0002', 'numbers are sequential per workspace');
select lives_ok($$ select public.void_invoice('00000000-0000-0000-0004-000000000002') $$, 'owner voids an unpaid invoice');
reset role;
select is(public.get_pay_invoice((select (v::jsonb)->>'token' from t where k = 'p2')), null, 'void kills the pay link');

-- Empty drafts cannot be issued; drafts can be deleted.
select pg_temp.as_user(1);
set local role authenticated;
reset role;
insert into public.invoices (id, tenant_id, client_id) values
  ('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0003-000000000001');
set local role authenticated;
select throws_ok($$ select public.issue_invoice('00000000-0000-0000-0004-000000000003') $$, '22023', null, 'an empty draft cannot be issued');
select lives_ok($$ delete from public.invoices where id = '00000000-0000-0000-0004-000000000003' $$, 'drafts can be deleted');
reset role;

-- Starter allows 20 invoices a month: 2 used, use up the rest.
update public.tenant_usage set used = 20
 where tenant_id = '00000000-0000-0000-0000-0000000000a1' and metric = 'invoices_issued';
select pg_temp.as_user(1);
set local role authenticated;
reset role;
insert into public.invoices (id, tenant_id, client_id) values
  ('00000000-0000-0000-0004-000000000004', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0003-000000000001');
set local role authenticated;
insert into public.invoice_items (tenant_id, invoice_id, description, unit_amount) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0004-000000000004', 'Extra', 1000);
select throws_ok($$ select public.issue_invoice('00000000-0000-0000-0004-000000000004') $$, 'PT402', null, '21st invoice of the month hits the Starter limit');
select is((select status::text from public.invoices where id = '00000000-0000-0000-0004-000000000004'), 'draft', 'refused issue leaves a draft');
reset role;

-- save_invoice_draft: atomic draft + lines, as the caller.
select pg_temp.as_user(1);
set local role authenticated;
select lives_ok($$
  insert into t select 'd1', public.save_invoice_draft(null, '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0003-000000000001', 'eur', null, null, ' Thanks! ',
    '[{"description":"Logo","quantity":1,"unit_amount":30000,"tax_rate_bps":2000},{"description":"Cards","quantity":"2","unit_amount":1500}]')::text
$$, 'draft saved with its lines');
select results_eq(format('select currency, total, notes from public.invoices where id = %L', (select v from t where k = 'd1')),
  $$ values ('eur', 39000::bigint, 'Thanks!') $$, 'draft totals and fields');
select lives_ok(format($f$ select public.save_invoice_draft(%L, '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0003-000000000001', 'eur', null, null, null, '[{"description":"Only","unit_amount":500}]') $f$,
  (select v from t where k = 'd1')), 'draft updated, lines replaced');
select is((select count(*)::int from public.invoice_items where invoice_id = (select v::uuid from t where k = 'd1')), 1, 'old lines replaced');
select throws_ok(format($f$ select public.save_invoice_draft(%L, '00000000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0003-000000000002', 'usd', null, null, null, '[]') $f$, (select v from t where k = 'd1')),
  'P0002', null, 'cannot move a draft to another workspace');
select throws_ok($$ select public.save_invoice_draft(null, '00000000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0003-000000000002', 'usd', null, null, null, '[]') $$,
  '42501', null, 'cannot save drafts into another workspace');
select throws_ok($$ select public.save_invoice_draft('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0003-000000000001', 'usd', null, null, null, '[]') $$,
  'P0002', null, 'issued invoices cannot be saved as drafts');
select throws_ok($$ select public.save_invoice_draft(null, '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0003-000000000001', 'jpy', null, null, null, '[]') $$,
  '23514', null, 'unsupported currency refused');
reset role;

-- Q's fee follows its plan (agency seeded at 100 bps too; set 0 to check).
update public.plans set payment_fee_bps = 0 where code = 'agency';
select pg_temp.as_user(3);
set local role authenticated;
reset role;
insert into public.invoices (id, tenant_id, client_id) values
  ('00000000-0000-0000-0004-000000000005', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0003-000000000002');
set local role authenticated;
insert into public.invoice_items (tenant_id, invoice_id, description, unit_amount) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0004-000000000005', 'Q work', 7000);
insert into t select 'q1', public.issue_invoice('00000000-0000-0000-0004-000000000005')::text;
select is((select (v::jsonb)->>'number' from t where k = 'q1'), 'INV-0001', 'numbering is per workspace');
reset role;
set local role service_role;
insert into t select 'qb', public.begin_invoice_payment((select (v::jsonb)->>'token' from t where k = 'q1'))::text;
select is((select (v::jsonb)->>'stripe_account_id' from t where k = 'qb'), 'acct_Q', 'Q''s invoice is charged on Q''s account');
select is((select (v::jsonb)->>'application_fee_amount' from t where k = 'qb'), '0', 'fee follows the plan''s bps');

-- Disconnecting stops new payments.
select is(public.apply_connect_account(13, 'acct_Q', 'active', true, false, 'usd', true), 'applied', 'Q disconnects');
select throws_ok(
  format('select public.begin_invoice_payment(%L)', (select (v::jsonb)->>'token' from t where k = 'q1')),
  'PT409', null, 'no payments once the account is disconnected');
reset role;

select * from finish();
rollback;

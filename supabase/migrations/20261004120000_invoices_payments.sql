-- Invoices, and online payment of them by the tenant's own clients through
-- Stripe Connect.
--
-- Money flow: every tenant connects its own Stripe account (Accounts v2,
-- full Dashboard, Stripe collects fees and carries losses). A client pays an
-- invoice through a Checkout Session created ON the tenant's account (direct
-- charge), so the tenant is the merchant of record. The platform takes
-- plans.payment_fee_bps as an application fee.
--
-- Tenant isolation, layer by layer:
--   * Every table carries tenant_id; RLS limits reads to the caller's
--     workspaces and writes to its editor workspaces.
--   * Composite foreign keys (tenant_id, client_id) / (tenant_id, invoice_id)
--     make it impossible for a row to point at another tenant's row.
--   * Money state (status, number, totals, amount_paid, payment attempts,
--     connected accounts) has no write grant for API roles at all. It changes
--     only inside the SECURITY DEFINER functions below.
--   * Clients pay through an unguessable link token. Only its SHA-256 is
--     stored; the public lookup returns a minimal view of one invoice.
--   * Stripe results are matched to an invoice only through a Checkout
--     Session id we created and stored, on the connected account we stored -
--     never through metadata, which the tenant's own account could forge.

-- ---------------------------------------------------------------------------
-- Types, catalog, prerequisites
-- ---------------------------------------------------------------------------
create type public.invoice_status as enum ('draft', 'issued', 'paid', 'void');
create type public.payment_method as enum ('stripe', 'manual');
create type public.payment_attempt_status as enum (
  'open',                -- Checkout Session created (or being created), not paid yet
  'succeeded',
  'failed',
  'expired',
  'needs_review',        -- Stripe charged an amount/currency we did not ask for
  'refunded',
  'partially_refunded',
  'disputed'
);
create type public.connect_status as enum ('pending', 'enabled', 'restricted', 'disconnected');

-- Platform fee per plan, in basis points of the amount paid (100 = 1%).
alter table public.plans
  add column payment_fee_bps smallint not null default 100 check (payment_fee_bps between 0 and 1000);

-- Target of the composite foreign key from invoices.
alter table public.clients add constraint clients_tenant_id_id_key unique (tenant_id, id);

-- Card networks' minimum for the currencies below (Stripe: 0.50 in each).
create function private.min_charge_amount()
returns bigint
language sql
immutable
set search_path = ''
as $$ select 50::bigint $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table private.invoice_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_number integer not null default 0
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  client_id uuid not null,
  number text,
  status public.invoice_status not null default 'draft',
  -- Two-decimal currencies only; amounts are integer minor units.
  currency text not null default 'usd' check (currency in ('usd', 'eur', 'gbp', 'cad', 'aud')),
  issue_date date,
  due_date date,
  notes text check (notes is null or length(notes) <= 2000),
  subtotal bigint not null default 0,
  tax_total bigint not null default 0,
  total bigint not null default 0,
  -- Net amount received (succeeded payments minus refunds), kept by
  -- private.recompute_invoice_payments.
  amount_paid bigint not null default 0,
  -- Copied from the client when issued, so later client edits don't rewrite history.
  client_name text,
  client_email text,
  issued_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id),
  check ((status = 'draft') = (number is null)),
  check ((status = 'draft') = (issued_at is null)),
  check ((status = 'paid') = (paid_at is not null)),
  check ((status = 'void') = (voided_at is not null)),
  check (due_date is null or issue_date is null or due_date >= issue_date)
);

create index invoices_tenant_id_status_created_at_idx on public.invoices (tenant_id, status, created_at desc);
create index invoices_tenant_id_client_id_idx on public.invoices (tenant_id, client_id);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_id uuid not null,
  position smallint not null default 0 check (position between 0 and 99),
  description text not null check (length(btrim(description)) between 1 and 500),
  quantity numeric(12, 2) not null default 1 check (quantity > 0 and quantity <= 1000000),
  unit_amount bigint not null check (unit_amount between 0 and 99999999),
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 10000),
  amount bigint generated always as (round(quantity * unit_amount)::bigint) stored,
  tax_amount bigint generated always as (round(round(quantity * unit_amount) * tax_rate_bps / 10000.0)::bigint) stored,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete cascade
);

create index invoice_items_invoice_id_position_idx on public.invoice_items (invoice_id, position);

-- Pay-link tokens: only the SHA-256 of the token is stored. No API grants.
create table private.invoice_pay_tokens (
  invoice_id uuid primary key references public.invoices (id) on delete cascade,
  tenant_id uuid not null,
  token_hash bytea not null unique,
  created_at timestamptz not null default now()
);

-- One connected Stripe account per tenant, and an account belongs to one
-- tenant only. Written only by the Connect functions (service role).
create table public.tenant_payment_accounts (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_'),
  status public.connect_status not null default 'pending',
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  default_currency text,
  last_sync_seq bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoice_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_id uuid not null,
  method public.payment_method not null default 'stripe',
  status public.payment_attempt_status not null default 'open',
  -- Snapshot taken when the attempt is created; Stripe must charge exactly this.
  amount bigint not null check (amount > 0),
  currency text not null,
  application_fee_amount bigint not null default 0 check (application_fee_amount >= 0),
  stripe_account_id text,
  checkout_session_id text unique check (checkout_session_id ~ '^cs_'),
  checkout_url text,
  payment_intent_id text unique check (payment_intent_id ~ '^pi_'),
  expires_at timestamptz,
  amount_refunded bigint not null default 0 check (amount_refunded >= 0),
  paid_at timestamptz,
  last_sync_seq bigint not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete cascade,
  check ((method = 'stripe') = (stripe_account_id is not null)),
  check (method = 'stripe' or checkout_session_id is null)
);

-- At most one payable Checkout Session per invoice at a time.
create unique index invoice_payment_attempts_one_open_idx
  on public.invoice_payment_attempts (invoice_id) where status = 'open';
create index invoice_payment_attempts_invoice_id_created_at_idx
  on public.invoice_payment_attempts (invoice_id, created_at desc);
create index invoice_payment_attempts_open_idx
  on public.invoice_payment_attempts (created_at) where status = 'open';

-- ---------------------------------------------------------------------------
-- Row Level Security and grants
-- ---------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.tenant_payment_accounts enable row level security;
alter table public.invoice_payment_attempts enable row level security;
alter table private.invoice_pay_tokens enable row level security;
alter table private.invoice_counters enable row level security;

create policy "Members read their workspace's invoices" on public.invoices
  for select to authenticated
  using (tenant_id in (select private.current_user_tenant_ids()));

create policy "Editors create invoices" on public.invoices
  for insert to authenticated
  with check (tenant_id in (select private.current_user_editor_tenant_ids()));

-- Only drafts can be edited or deleted. Issued invoices change only through
-- the functions below.
create policy "Editors edit drafts" on public.invoices
  for update to authenticated
  using (status = 'draft' and tenant_id in (select private.current_user_editor_tenant_ids()))
  with check (status = 'draft' and tenant_id in (select private.current_user_editor_tenant_ids()));

create policy "Editors delete drafts" on public.invoices
  for delete to authenticated
  using (status = 'draft' and tenant_id in (select private.current_user_editor_tenant_ids()));

create policy "Members read their workspace's invoice items" on public.invoice_items
  for select to authenticated
  using (tenant_id in (select private.current_user_tenant_ids()));

create policy "Editors add invoice items" on public.invoice_items
  for insert to authenticated
  with check (tenant_id in (select private.current_user_editor_tenant_ids()));

create policy "Editors edit invoice items" on public.invoice_items
  for update to authenticated
  using (tenant_id in (select private.current_user_editor_tenant_ids()))
  with check (tenant_id in (select private.current_user_editor_tenant_ids()));

create policy "Editors delete invoice items" on public.invoice_items
  for delete to authenticated
  using (tenant_id in (select private.current_user_editor_tenant_ids()));

create policy "Members read their workspace's payment account" on public.tenant_payment_accounts
  for select to authenticated
  using (tenant_id in (select private.current_user_tenant_ids()));

create policy "Members read their workspace's payments" on public.invoice_payment_attempts
  for select to authenticated
  using (tenant_id in (select private.current_user_tenant_ids()));

revoke all on public.invoices, public.invoice_items, public.tenant_payment_accounts,
  public.invoice_payment_attempts from anon, authenticated;
revoke all on private.invoice_pay_tokens, private.invoice_counters from public, anon, authenticated;

grant select, delete on public.invoices to authenticated;
grant insert (tenant_id, client_id, currency, issue_date, due_date, notes) on public.invoices to authenticated;
grant update (client_id, currency, issue_date, due_date, notes) on public.invoices to authenticated;

grant select, delete on public.invoice_items to authenticated;
grant insert (tenant_id, invoice_id, position, description, quantity, unit_amount, tax_rate_bps)
  on public.invoice_items to authenticated;
grant update (position, description, quantity, unit_amount, tax_rate_bps) on public.invoice_items to authenticated;

-- Read-only for members; written only by service-role functions.
grant select on public.tenant_payment_accounts to authenticated;
grant select (id, tenant_id, invoice_id, method, status, amount, currency, application_fee_amount,
              amount_refunded, paid_at, expires_at, created_at, updated_at)
  on public.invoice_payment_attempts to authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------
create function private.invoices_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- API inserts can only name the columns granted above; the rest starts
    -- from defaults whatever else is attempted.
    new.created_at := now();
  else
    if new.tenant_id is distinct from old.tenant_id or new.id is distinct from old.id then
      raise exception 'invoices: id and tenant_id cannot change' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.notes := nullif(btrim(new.notes), '');
  return new;
end;
$$;

create trigger invoices_before_write
  before insert or update on public.invoices
  for each row execute function private.invoices_before_write();

-- Line items may change only while their invoice is a draft. Locks the
-- invoice row so an item write can't interleave with issue_invoice.
create function private.invoice_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.invoice_items := case when tg_op = 'DELETE' then old else new end;
  v_status public.invoice_status;
  v_count integer;
begin
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id
                           or new.invoice_id is distinct from old.invoice_id
                           or new.id is distinct from old.id) then
    raise exception 'invoice items: id, tenant_id and invoice_id cannot change' using errcode = '42501';
  end if;

  -- Runs as definer: check the API caller's workspace before looking at the
  -- invoice, so another workspace's invoice can't be locked or probed.
  -- (No uid = service role or a cascade; RLS still applies to API callers.)
  if (select auth.uid()) is not null and not exists (
    select 1 from public.tenant_members m
    where m.tenant_id = v_row.tenant_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'invoice items: not allowed' using errcode = '42501';
  end if;

  select i.status into v_status
  from public.invoices i
  where i.id = v_row.invoice_id and i.tenant_id = v_row.tenant_id
  for update;

  -- Deleting a draft invoice cascades here after the invoice row is gone.
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'invoice not found' using errcode = '23503';
  end if;

  if v_status <> 'draft' then
    raise exception 'invoice items: only draft invoices can be changed' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    select count(*) into v_count from public.invoice_items it where it.invoice_id = new.invoice_id;
    if v_count >= 100 then
      raise exception 'invoice items: at most 100 lines per invoice' using errcode = '22023';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    new.description := btrim(new.description);
    return new;
  end if;
  return old;
end;
$$;

create trigger invoice_items_before_write
  before insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_before_write();

-- Totals are always derived from the line items; nobody can write them.
create function private.recompute_invoice_totals(p_invoice_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.invoices i
     set subtotal = t.subtotal,
         tax_total = t.tax_total,
         total = t.subtotal + t.tax_total
    from (
      select coalesce(sum(it.amount), 0)::bigint as subtotal,
             coalesce(sum(it.tax_amount), 0)::bigint as tax_total
      from public.invoice_items it
      where it.invoice_id = p_invoice_id
    ) t
   where i.id = p_invoice_id
     and i.status = 'draft';
$$;

create function private.invoice_items_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recompute_invoice_totals(case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end);
  return null;
end;
$$;

create trigger invoice_items_after_write
  after insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_after_write();

revoke execute on function private.invoices_before_write() from public, anon, authenticated;
revoke execute on function private.invoice_items_before_write() from public, anon, authenticated;
revoke execute on function private.invoice_items_after_write() from public, anon, authenticated;
revoke execute on function private.recompute_invoice_totals(uuid) from public, anon, authenticated;
revoke execute on function private.min_charge_amount() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
-- The caller must be an owner, admin or member of the invoice's workspace.
-- Returns the invoice locked FOR UPDATE. Same error for "missing" and "not
-- yours", so ids of other workspaces can't be probed.
create function private.lock_editable_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  select i.* into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
    and exists (
      select 1 from public.tenant_members m
      where m.tenant_id = i.tenant_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'member')
    )
  for update of i;

  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  return v_invoice;
end;
$$;

-- 32 bytes from two v4 UUIDs (pg_strong_random, 244 random bits), base64url.
create function private.new_pay_token(p_invoice_id uuid, p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := rtrim(translate(encode(
    decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'),
    'base64'), '+/', '-_'), '=');
begin
  insert into private.invoice_pay_tokens (invoice_id, tenant_id, token_hash)
  values (p_invoice_id, p_tenant_id, sha256(convert_to(v_token, 'UTF8')))
  on conflict (invoice_id) do update
    set token_hash = excluded.token_hash, created_at = now();
  return v_token;
end;
$$;

-- Malformed tokens never reach the table.
create function private.pay_token_invoice_id(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.invoice_id
  from private.invoice_pay_tokens t
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and t.token_hash = sha256(convert_to(p_token, 'UTF8'));
$$;

-- Why a client can't pay online right now (null = they can).
create function private.pay_unavailable_reason(p_invoice public.invoices)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_invoice.status = 'paid' then 'paid'
    when p_invoice.status = 'void' then 'void'
    when p_invoice.status <> 'issued' then 'not_issued'
    when p_invoice.total - p_invoice.amount_paid < private.min_charge_amount() then 'amount_too_small'
    when not private.has_feature(p_invoice.tenant_id, 'online_payments') then 'payments_unavailable'
    when not exists (
      select 1 from public.tenant_payment_accounts a
      where a.tenant_id = p_invoice.tenant_id and a.status = 'enabled' and a.charges_enabled
    ) then 'payments_unavailable'
  end;
$$;

-- Net received per invoice from its payment attempts; flips issued <-> paid.
-- A void invoice stays void (a late payment shows up as a succeeded attempt
-- on it, for the tenant to refund).
create function private.recompute_invoice_payments(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid bigint;
  v_paid_at timestamptz;
begin
  select coalesce(sum(a.amount - a.amount_refunded), 0)::bigint, max(a.paid_at)
    into v_paid, v_paid_at
  from public.invoice_payment_attempts a
  where a.invoice_id = p_invoice_id
    and a.status in ('succeeded', 'partially_refunded');

  update public.invoices i
     set amount_paid = v_paid,
         status = case
                    when i.status in ('issued', 'paid') and v_paid >= i.total then 'paid'::public.invoice_status
                    when i.status in ('issued', 'paid') then 'issued'::public.invoice_status
                    else i.status
                  end,
         paid_at = case
                     when i.status in ('issued', 'paid') and v_paid >= i.total then coalesce(i.paid_at, v_paid_at, now())
                     when i.status in ('issued', 'paid') then null
                     else i.paid_at
                   end
   where i.id = p_invoice_id;
end;
$$;

revoke execute on function private.lock_editable_invoice(uuid) from public, anon, authenticated;
revoke execute on function private.new_pay_token(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.pay_token_invoice_id(text) from public, anon, authenticated;
revoke execute on function private.pay_unavailable_reason(public.invoices) from public, anon, authenticated;
revoke execute on function private.recompute_invoice_payments(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Editor actions (authenticated)
-- ---------------------------------------------------------------------------
-- Draft -> issued: assigns the next number, freezes the client details,
-- counts toward invoices_issued (PT402 when the month's limit is reached)
-- and creates the pay link. The raw token is returned once and never stored.
create function public.issue_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices := private.lock_editable_invoice(p_invoice_id);
  v_items integer;
  v_number integer;
  v_client public.clients;
  v_token text;
begin
  if v_invoice.status <> 'draft' then
    raise exception 'only draft invoices can be issued' using errcode = '55000';
  end if;

  select count(*) into v_items from public.invoice_items it where it.invoice_id = v_invoice.id;
  if v_items = 0 or v_invoice.total < private.min_charge_amount() then
    raise exception 'add at least one line item; the total must be at least 0.50' using errcode = '22023';
  end if;
  if v_invoice.total > 99999999 then
    raise exception 'invoice total is too large (max 999,999.99)' using errcode = '22023';
  end if;

  perform private.consume_quota(v_invoice.tenant_id, 'invoices_issued', 1);

  insert into private.invoice_counters as c (tenant_id, last_number)
  values (v_invoice.tenant_id, 1)
  on conflict (tenant_id) do update set last_number = c.last_number + 1
  returning c.last_number into v_number;

  select c.* into v_client from public.clients c
  where c.tenant_id = v_invoice.tenant_id and c.id = v_invoice.client_id;

  update public.invoices i
     set status = 'issued',
         number = 'INV-' || lpad(v_number::text, 4, '0'),
         issued_at = now(),
         issue_date = coalesce(i.issue_date, current_date),
         client_name = v_client.name,
         client_email = v_client.email
   where i.id = v_invoice.id;

  v_token := private.new_pay_token(v_invoice.id, v_invoice.tenant_id);
  return jsonb_build_object('number', 'INV-' || lpad(v_number::text, 4, '0'), 'token', v_token);
end;
$$;

-- Creates (p_invoice_id null) or updates a draft and replaces its lines in
-- one transaction. SECURITY INVOKER: runs as the caller, so RLS, column
-- grants and the triggers above decide what is allowed.
-- p_items: [{"description","quantity","unit_amount","tax_rate_bps"}, ...]
create function public.save_invoice_draft(
  p_invoice_id uuid,
  p_tenant_id uuid,
  p_client_id uuid,
  p_currency text,
  p_issue_date date,
  p_due_date date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;

  if p_invoice_id is null then
    insert into public.invoices (tenant_id, client_id, currency, issue_date, due_date, notes)
    values (p_tenant_id, p_client_id, p_currency, p_issue_date, p_due_date, p_notes)
    returning id into v_id;
  else
    update public.invoices i
       set client_id = p_client_id, currency = p_currency, issue_date = p_issue_date,
           due_date = p_due_date, notes = p_notes
     where i.id = p_invoice_id and i.tenant_id = p_tenant_id and i.status = 'draft'
    returning i.id into v_id;
    if v_id is null then
      raise exception 'draft not found' using errcode = 'P0002';
    end if;
    delete from public.invoice_items it where it.invoice_id = v_id;
  end if;

  insert into public.invoice_items (tenant_id, invoice_id, position, description, quantity, unit_amount, tax_rate_bps)
  select p_tenant_id, v_id, (x.ord - 1)::smallint, x.item->>'description',
         coalesce((x.item->>'quantity')::numeric, 1),
         (x.item->>'unit_amount')::bigint,
         coalesce((x.item->>'tax_rate_bps')::integer, 0)
  from jsonb_array_elements(p_items) with ordinality as x(item, ord);

  return v_id;
end;
$$;

revoke execute on function public.save_invoice_draft(uuid, uuid, uuid, text, date, date, text, jsonb) from public, anon;
grant execute on function public.save_invoice_draft(uuid, uuid, uuid, text, date, date, text, jsonb) to authenticated;

-- New pay link for an issued invoice; the previous link stops working.
create function public.rotate_pay_link(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices := private.lock_editable_invoice(p_invoice_id);
begin
  if v_invoice.status <> 'issued' then
    raise exception 'only unpaid issued invoices have a pay link' using errcode = '55000';
  end if;
  return private.new_pay_token(v_invoice.id, v_invoice.tenant_id);
end;
$$;

-- Issued and unpaid -> void. The pay link dies at once. A Checkout Session
-- already open stays payable until it expires (at most 30 min); if it is paid
-- anyway, the payment is recorded on the void invoice for the tenant to
-- refund.
create function public.void_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices := private.lock_editable_invoice(p_invoice_id);
begin
  if v_invoice.status <> 'issued' or v_invoice.amount_paid > 0 then
    raise exception 'only issued invoices with no payment can be voided' using errcode = '55000';
  end if;

  delete from private.invoice_pay_tokens t where t.invoice_id = v_invoice.id;
  update public.invoice_payment_attempts a
     set status = 'expired', updated_at = now()
   where a.invoice_id = v_invoice.id and a.status = 'open';
  update public.invoices i set status = 'void', voided_at = now() where i.id = v_invoice.id;
end;
$$;

-- Cash, bank transfer, cheque: records the remaining balance as received.
create function public.record_manual_payment(p_invoice_id uuid, p_paid_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices := private.lock_editable_invoice(p_invoice_id);
  v_paid_at timestamptz := coalesce(p_paid_at, now());
begin
  if v_invoice.status <> 'issued' then
    raise exception 'only unpaid issued invoices can be marked paid' using errcode = '55000';
  end if;
  if v_paid_at > now() + interval '1 day' then
    raise exception 'payment date cannot be in the future' using errcode = '22023';
  end if;

  -- An online payment in progress could double the money; close it here.
  update public.invoice_payment_attempts a
     set status = 'expired', updated_at = now()
   where a.invoice_id = v_invoice.id and a.status = 'open';

  insert into public.invoice_payment_attempts
    (tenant_id, invoice_id, method, status, amount, currency, paid_at, created_by)
  values
    (v_invoice.tenant_id, v_invoice.id, 'manual', 'succeeded',
     v_invoice.total - v_invoice.amount_paid, v_invoice.currency, v_paid_at, (select auth.uid()));

  delete from private.invoice_pay_tokens t where t.invoice_id = v_invoice.id;
  perform private.recompute_invoice_payments(v_invoice.id);
end;
$$;

revoke execute on function public.issue_invoice(uuid) from public, anon;
revoke execute on function public.rotate_pay_link(uuid) from public, anon;
revoke execute on function public.void_invoice(uuid) from public, anon;
revoke execute on function public.record_manual_payment(uuid, timestamptz) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;
grant execute on function public.rotate_pay_link(uuid) to authenticated;
grant execute on function public.void_invoice(uuid) to authenticated;
grant execute on function public.record_manual_payment(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Public pay page (anon)
-- ---------------------------------------------------------------------------
-- The one invoice a token opens, with only what the payer needs to see:
-- no ids, no emails, nothing about the workspace beyond its name. NULL for
-- an unknown, rotated or revoked token.
create function public.get_pay_invoice(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_reason text;
begin
  select i.* into v_invoice
  from public.invoices i
  where i.id = private.pay_token_invoice_id(p_token);
  if not found then
    return null;
  end if;

  v_reason := private.pay_unavailable_reason(v_invoice);
  return jsonb_build_object(
    'business_name', (select t.name from public.tenants t where t.id = v_invoice.tenant_id),
    'number', v_invoice.number,
    'status', v_invoice.status,
    'client_name', v_invoice.client_name,
    'currency', v_invoice.currency,
    'issue_date', v_invoice.issue_date,
    'due_date', v_invoice.due_date,
    'notes', v_invoice.notes,
    'subtotal', v_invoice.subtotal,
    'tax_total', v_invoice.tax_total,
    'total', v_invoice.total,
    'amount_paid', v_invoice.amount_paid,
    'amount_due', greatest(v_invoice.total - v_invoice.amount_paid, 0),
    'paid_at', v_invoice.paid_at,
    'can_pay', v_reason is null,
    'unavailable_reason', v_reason,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'description', it.description, 'quantity', it.quantity, 'unit_amount', it.unit_amount,
               'tax_rate_bps', it.tax_rate_bps, 'amount', it.amount) order by it.position, it.created_at)
      from public.invoice_items it
      where it.invoice_id = v_invoice.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_pay_invoice(text) from public;
grant execute on function public.get_pay_invoice(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Payment flow (service role: pay-invoice, stripe-connect-webhook,
-- reconcile-invoice-payments, connect-onboarding)
-- ---------------------------------------------------------------------------
-- Starts (or resumes) an online payment for the invoice a token opens.
-- Everything Stripe will be asked to charge comes from here, never from the
-- request: amount = balance due, currency, connected account, platform fee.
create function public.begin_invoice_payment(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_reason text;
  v_account text;
  v_attempt public.invoice_payment_attempts;
  v_recent integer;
  v_fee_bps smallint;
  v_amount bigint;
  v_superseded jsonb;
begin
  select i.* into v_invoice
  from public.invoices i
  where i.id = private.pay_token_invoice_id(p_token)
  for update;
  if not found then
    raise sqlstate 'PT404' using message = 'This payment link is not valid';
  end if;

  v_reason := private.pay_unavailable_reason(v_invoice);
  if v_reason is not null then
    raise sqlstate 'PT409' using message = 'This invoice cannot be paid online', detail = v_reason;
  end if;

  select a.stripe_account_id into v_account
  from public.tenant_payment_accounts a
  where a.tenant_id = v_invoice.tenant_id;

  v_amount := v_invoice.total - v_invoice.amount_paid;

  -- Resume the open session when it is still good for a few minutes and
  -- still matches what is owed.
  select a.* into v_attempt
  from public.invoice_payment_attempts a
  where a.invoice_id = v_invoice.id and a.status = 'open'
  for update;

  if found and v_attempt.checkout_session_id is not null
     and v_attempt.expires_at > now() + interval '5 minutes'
     and v_attempt.amount = v_amount
     and v_attempt.currency = v_invoice.currency
     and v_attempt.stripe_account_id = v_account then
    return jsonb_build_object(
      'attempt_id', v_attempt.id, 'reused', true, 'checkout_url', v_attempt.checkout_url,
      'superseded', '[]'::jsonb);
  end if;

  select count(*) into v_recent
  from public.invoice_payment_attempts a
  where a.invoice_id = v_invoice.id and a.method = 'stripe' and a.created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise sqlstate 'PT429' using message = 'Too many payment attempts for this invoice; try again later';
  end if;

  -- Close the previous open attempt locally and hand its session back so the
  -- caller expires it in Stripe. If it was paid meanwhile, the webhook still
  -- records it (a later sync ticket wins).
  v_superseded := '[]'::jsonb;
  if v_attempt.id is not null then
    update public.invoice_payment_attempts a
       set status = 'expired', updated_at = now()
     where a.id = v_attempt.id;
    if v_attempt.checkout_session_id is not null then
      v_superseded := jsonb_build_array(jsonb_build_object(
        'checkout_session_id', v_attempt.checkout_session_id, 'stripe_account_id', v_attempt.stripe_account_id));
    end if;
  end if;

  select p.payment_fee_bps into v_fee_bps
  from public.plans p
  where p.code = private.effective_plan(v_invoice.tenant_id);

  insert into public.invoice_payment_attempts
    (tenant_id, invoice_id, method, status, amount, currency, application_fee_amount, stripe_account_id)
  values
    (v_invoice.tenant_id, v_invoice.id, 'stripe', 'open', v_amount, v_invoice.currency,
     floor(v_amount * coalesce(v_fee_bps, 0) / 10000.0)::bigint, v_account)
  returning * into v_attempt;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'reused', false,
    'stripe_account_id', v_attempt.stripe_account_id,
    'amount', v_attempt.amount,
    'currency', v_attempt.currency,
    'application_fee_amount', v_attempt.application_fee_amount,
    'invoice_number', v_invoice.number,
    'business_name', (select t.name from public.tenants t where t.id = v_invoice.tenant_id),
    'client_email', v_invoice.client_email,
    'superseded', v_superseded
  );
end;
$$;

-- The Checkout Session Stripe created for an attempt. False when the attempt
-- was superseded or closed meanwhile: the caller must expire the session.
create function public.attach_checkout_session(
  p_attempt_id uuid,
  p_session_id text,
  p_url text,
  p_expires_at timestamptz
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.invoice_payment_attempts a
     set checkout_session_id = p_session_id,
         checkout_url = p_url,
         expires_at = p_expires_at,
         updated_at = now()
   where a.id = p_attempt_id
     and a.method = 'stripe'
     and a.status = 'open'
     and a.checkout_session_id is null
  returning true;
$$;

-- Stripe refused to create the session: free the invoice for a new attempt.
create function public.fail_payment_attempt(p_attempt_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.invoice_payment_attempts a
     set status = 'failed', updated_at = now()
   where a.id = p_attempt_id
     and a.status = 'open'
     and a.checkout_session_id is null;
$$;

-- Mirrors a Checkout Session (re-fetched from the connected account after
-- taking a sync ticket) onto the attempt that created it, then onto its
-- invoice. Returns what happened:
--   applied | duplicate | stale | orphan
-- 'orphan' = no attempt of ours has this session on this account. That is
-- what a session the tenant made by hand, or a forged one, looks like; it is
-- recorded (so Stripe stops retrying) and changes nothing.
create function public.apply_invoice_payment(
  p_sync_seq bigint,
  p_event_id text,
  p_event_type text,
  p_account_id text,
  p_session_id text,
  p_session_status text,              -- open | complete | expired
  p_payment_status text,              -- paid | unpaid | no_payment_required
  p_amount_total bigint,
  p_currency text,
  p_payment_intent_id text default null,
  p_payment_intent_status text default null,
  p_amount_refunded bigint default 0,
  p_dispute_status text default null, -- null when there is no dispute
  p_paid_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.invoice_payment_attempts;
  v_status public.payment_attempt_status;
begin
  if p_event_id is not null then
    insert into public.stripe_webhook_events (event_id, type)
    values (p_event_id, p_event_type)
    on conflict (event_id) do nothing;
    if not found then
      return 'duplicate';
    end if;
  end if;

  select a.* into v_attempt
  from public.invoice_payment_attempts a
  where a.checkout_session_id = p_session_id
    and a.stripe_account_id = p_account_id
    -- The account must still be the one registered to that tenant.
    and exists (
      select 1 from public.tenant_payment_accounts t
      where t.tenant_id = a.tenant_id and t.stripe_account_id = p_account_id
    )
  for update;
  if not found then
    raise warning 'apply_invoice_payment: no attempt for session % on account % (event %)',
      p_session_id, p_account_id, p_event_id;
    return 'orphan';
  end if;

  if p_sync_seq <= v_attempt.last_sync_seq then
    return 'stale';
  end if;

  v_status := case
    when p_session_status = 'complete' and p_payment_status = 'paid' then
      case
        when p_amount_total is distinct from v_attempt.amount
          or lower(p_currency) is distinct from v_attempt.currency then 'needs_review'
        when p_dispute_status is not null and p_dispute_status not in ('won', 'warning_closed') then 'disputed'
        when p_amount_refunded >= p_amount_total then 'refunded'
        when p_amount_refunded > 0 then 'partially_refunded'
        else 'succeeded'
      end
    when p_session_status = 'complete'
      and p_payment_intent_status in ('canceled', 'requires_payment_method') then 'failed'
    when p_session_status = 'expired' then 'expired'
    -- Still open, or completed with a delayed payment method still processing.
    else v_attempt.status::text
  end::public.payment_attempt_status;

  if v_status = 'needs_review' then
    raise warning 'apply_invoice_payment: session % charged % %, attempt % expected % %',
      p_session_id, p_amount_total, p_currency, v_attempt.id, v_attempt.amount, v_attempt.currency;
  end if;

  update public.invoice_payment_attempts a
     set status = v_status,
         payment_intent_id = coalesce(p_payment_intent_id, a.payment_intent_id),
         amount_refunded = least(greatest(coalesce(p_amount_refunded, 0), 0), a.amount),
         paid_at = case
                     when v_status in ('succeeded', 'partially_refunded', 'refunded', 'disputed')
                       then coalesce(a.paid_at, p_paid_at, now())
                     else a.paid_at
                   end,
         last_sync_seq = p_sync_seq,
         updated_at = now()
   where a.id = v_attempt.id;

  perform private.recompute_invoice_payments(v_attempt.invoice_id);
  return 'applied';
end;
$$;

-- Online attempts the reconcile job should re-check: still open past their
-- expiry, or created a while ago without a result.
create function public.invoice_payments_to_reconcile(p_limit integer default 100)
returns table (attempt_id uuid, stripe_account_id text, checkout_session_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.stripe_account_id, a.checkout_session_id
  from public.invoice_payment_attempts a
  where a.status = 'open'
    and a.method = 'stripe'
    and a.checkout_session_id is not null
    and a.created_at < now() - interval '10 minutes'
  order by a.created_at
  limit least(greatest(p_limit, 1), 500);
$$;

-- Records the connected account created for a tenant. Returns the account
-- registered for the tenant, which is the existing one if there already is
-- one (the account id is never replaced).
create function public.register_connect_account(p_tenant_id uuid, p_account_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account text;
begin
  insert into public.tenant_payment_accounts (tenant_id, stripe_account_id)
  values (p_tenant_id, p_account_id)
  on conflict (tenant_id) do nothing;

  select a.stripe_account_id into v_account
  from public.tenant_payment_accounts a
  where a.tenant_id = p_tenant_id;
  return v_account;
end;
$$;

-- Mirrors a connected account (re-fetched from Stripe after taking a sync
-- ticket). Unknown accounts are ignored.
create function public.apply_connect_account(
  p_sync_seq bigint,
  p_account_id text,
  p_card_payments_status text,     -- active | pending | restricted | unsupported | null
  p_details_submitted boolean,
  p_requirements_due boolean,
  p_default_currency text,
  p_disconnected boolean default false,
  p_event_id text default null,
  p_event_type text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tenant_payment_accounts;
begin
  if p_event_id is not null then
    insert into public.stripe_webhook_events (event_id, type)
    values (p_event_id, p_event_type)
    on conflict (event_id) do nothing;
    if not found then
      return 'duplicate';
    end if;
  end if;

  select a.* into v_row
  from public.tenant_payment_accounts a
  where a.stripe_account_id = p_account_id
  for update;
  if not found then
    return 'orphan';
  end if;
  if p_sync_seq <= v_row.last_sync_seq then
    return 'stale';
  end if;

  update public.tenant_payment_accounts a
     set status = case
                    when p_disconnected then 'disconnected'
                    when p_card_payments_status = 'active' then 'enabled'
                    when p_requirements_due or p_card_payments_status in ('restricted', 'unsupported') then 'restricted'
                    else 'pending'
                  end::public.connect_status,
         charges_enabled = coalesce(not p_disconnected and p_card_payments_status = 'active', false),
         details_submitted = coalesce(p_details_submitted, false),
         default_currency = lower(p_default_currency),
         last_sync_seq = p_sync_seq,
         updated_at = now()
   where a.tenant_id = v_row.tenant_id;
  return 'applied';
end;
$$;

revoke execute on function public.begin_invoice_payment(text) from public, anon, authenticated;
revoke execute on function public.attach_checkout_session(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.fail_payment_attempt(uuid) from public, anon, authenticated;
revoke execute on function public.apply_invoice_payment(bigint, text, text, text, text, text, text, bigint, text, text, text, bigint, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.invoice_payments_to_reconcile(integer) from public, anon, authenticated;
revoke execute on function public.register_connect_account(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_connect_account(bigint, text, text, boolean, boolean, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.begin_invoice_payment(text) to service_role;
grant execute on function public.attach_checkout_session(uuid, text, text, timestamptz) to service_role;
grant execute on function public.fail_payment_attempt(uuid) to service_role;
grant execute on function public.apply_invoice_payment(bigint, text, text, text, text, text, text, bigint, text, text, text, bigint, text, timestamptz) to service_role;
grant execute on function public.invoice_payments_to_reconcile(integer) to service_role;
grant execute on function public.register_connect_account(uuid, text) to service_role;
grant execute on function public.apply_connect_account(bigint, text, text, boolean, boolean, text, boolean, text, text) to service_role;

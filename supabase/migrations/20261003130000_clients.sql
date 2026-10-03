-- Clients: the first real consumer of the active_clients plan limit.
--
-- Quota contract (from the billing schema):
--   * A client counts while status = 'active'.
--   * Adding an active client consumes a slot; archiving releases it;
--     restoring needs a free slot again (PT402 otherwise, HTTP 402 through
--     PostgREST). Archiving is the "delete" - client rows are kept for
--     invoice history.
--   * Triggers run in the same transaction as the write, so a refused slot
--     rolls the write back and direct API writes can't get around the limit.
--
-- Access: members read their workspace's clients; owners, admins and members
-- write them; approvers are read-only. tenant_id and id can never change.

create type public.client_status as enum ('active', 'archived');

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  email text check (email is null or (length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  company text check (company is null or length(btrim(company)) between 1 and 200),
  status public.client_status not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'archived') = (archived_at is not null))
);

-- List queries: one workspace, one status, newest first.
create index clients_tenant_id_status_created_at_idx
  on public.clients (tenant_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Workspaces where the current user may create and edit records.
create function private.current_user_editor_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.tenant_members m
  where m.user_id = (select auth.uid())
    and m.role in ('owner', 'admin', 'member');
$$;

revoke execute on function private.current_user_editor_tenant_ids() from public, anon;
grant execute on function private.current_user_editor_tenant_ids() to authenticated;

alter table public.clients enable row level security;

create policy "Members read their workspace's clients" on public.clients
  for select to authenticated
  using (tenant_id in (select private.current_user_tenant_ids()));

create policy "Editors add clients" on public.clients
  for insert to authenticated
  with check (tenant_id in (select private.current_user_editor_tenant_ids()));

create policy "Editors update clients" on public.clients
  for update to authenticated
  using (tenant_id in (select private.current_user_editor_tenant_ids()))
  with check (tenant_id in (select private.current_user_editor_tenant_ids()));

-- No DELETE policy: clients are archived, never deleted, through the API.
revoke all on public.clients from anon;
revoke all on public.clients from authenticated;
grant select on public.clients to authenticated;
grant insert (tenant_id, name, email, company) on public.clients to authenticated;
grant update (name, email, company, status) on public.clients to authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping + quota triggers
-- ---------------------------------------------------------------------------
create function private.clients_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id or new.id is distinct from old.id then
      raise exception 'clients: id and tenant_id cannot change' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  new.name := btrim(new.name);
  new.email := nullif(lower(btrim(new.email)), '');
  new.company := nullif(btrim(new.company), '');
  -- archived_at follows status, whatever the client sent.
  new.archived_at := case
    when new.status = 'archived' then coalesce(case when tg_op = 'UPDATE' then old.archived_at end, now())
  end;
  return new;
end;
$$;

create trigger clients_before_write
  before insert or update on public.clients
  for each row execute function private.clients_before_write();

create function private.clients_active_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' then
      perform private.consume_quota(new.tenant_id, 'active_clients', 1);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status = 'active' and new.status <> 'active' then
      perform private.release_quota(old.tenant_id, 'active_clients', 1);
    elsif old.status <> 'active' and new.status = 'active' then
      perform private.consume_quota(new.tenant_id, 'active_clients', 1);
    end if;
  elsif tg_op = 'DELETE' then
    if old.status = 'active' then
      perform private.release_quota(old.tenant_id, 'active_clients', 1);
    end if;
    return old;
  end if;
  return new;
end;
$$;

create trigger clients_active_quota
  after insert or delete or update of status on public.clients
  for each row execute function private.clients_active_quota();

revoke execute on function private.clients_before_write() from public, anon, authenticated;
revoke execute on function private.clients_active_quota() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- reconcile_usage now also recounts active clients
-- ---------------------------------------------------------------------------
create or replace function private.reconcile_usage(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Same lock order as consume_quota.
  perform private.lock_tenant_plan(p_tenant_id, false);
  perform 1 from public.tenant_subscriptions s where s.tenant_id = p_tenant_id for share;

  insert into public.tenant_usage (tenant_id, metric, period_start)
  values (p_tenant_id, 'team_seats', '-infinity'), (p_tenant_id, 'active_clients', '-infinity')
  on conflict (tenant_id, metric, period_start) do nothing;

  -- Lock the counters first so nothing is added between count and write.
  perform 1
  from public.tenant_usage u
  where u.tenant_id = p_tenant_id
    and u.metric in ('team_seats', 'active_clients')
    and u.period_start = '-infinity'
  for update;

  update public.tenant_usage u
     set used = case u.metric
                  when 'team_seats' then (select count(*) from public.tenant_members m where m.tenant_id = p_tenant_id)
                  else (select count(*) from public.clients c where c.tenant_id = p_tenant_id and c.status = 'active')
                end,
         updated_at = now()
   where u.tenant_id = p_tenant_id
     and u.metric in ('team_seats', 'active_clients')
     and u.period_start = '-infinity';
end;
$$;

-- Until now active_clients could only be bumped by hand (e.g. testing
-- consume_quota from the SQL editor). The clients table is the source of
-- truth from here on and it starts empty.
update public.tenant_usage
   set used = 0, updated_at = now()
 where metric = 'active_clients'
   and period_start = '-infinity';

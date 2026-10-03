-- Self-service workspace creation.
--
-- The API roles can't insert into tenants / tenant_members (no INSERT
-- policies, privileges revoked), so creation goes through this function:
-- the caller becomes the owner of a new tenant, in one transaction.
--
-- * Identity comes from auth.uid() only, never from a parameter or JWT
--   metadata.
-- * The owner seat goes through the normal seat trigger: with no plan the
--   team_seats floor (min_allowance = 1) allows exactly the owner.
-- * A user can own at most 5 workspaces (abuse guard). A per-user advisory
--   lock makes the count check race-free.
-- * No Stripe customer is created here; create-checkout-session does that
--   when the owner first subscribes.

create function public.create_tenant(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_tenant_id uuid;
begin
  if v_user is null then
    raise exception 'create_tenant: not signed in' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 200 then
    raise exception 'Workspace name must be 1 to 200 characters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ledgerflow.create_tenant:' || v_user::text, 0));

  if (select count(*) from public.tenant_members m where m.user_id = v_user and m.role = 'owner') >= 5 then
    raise exception 'You already own the maximum of 5 workspaces' using errcode = 'P0001';
  end if;

  insert into public.tenants (name) values (v_name) returning id into v_tenant_id;
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant_id, v_user, 'owner');

  return v_tenant_id;
end;
$$;

revoke execute on function public.create_tenant(text) from public, anon;
grant execute on function public.create_tenant(text) to authenticated;

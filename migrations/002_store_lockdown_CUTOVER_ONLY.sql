-- PRODUCTION CUTOVER ONLY — DO NOT RUN until browser login and save RPC
-- have been tested with two accounts and an administrator is provisioned.
-- This script removes anonymous access to the JSON store.
-- Preconditions: 001 migration applied, verified backup, tested Auth.
begin;
drop policy if exists "store_read" on public.store;
drop policy if exists "store_update" on public.store;
drop policy if exists "store_write" on public.store;

-- Remove direct writes from all browser roles; the definer RPC is the
-- only approved mutation route and checks the caller's membership.
revoke all on public.store from anon, authenticated;
grant select on public.store to authenticated;

-- Authenticated role must be able to evaluate the current password-change
-- flag without exposing auth.users directly. Use a SECURITY DEFINER helper.
create or replace function public.hub_password_change_required()
returns boolean language sql stable security definer set search_path = ''
as $
  select coalesce((
    select (au.raw_app_meta_data ->> 'must_change_password')::boolean
    from auth.users au where au.id = (select auth.uid())
  ), true);
$;
revoke all on function public.hub_password_change_required() from public, anon;
grant execute on function public.hub_password_change_required() to authenticated;

create policy store_member_read on public.store
for select to authenticated
using (
  exists (
    select 1 from public.hub_members m
    where m.user_id = (select auth.uid())
  )
  and not (select public.hub_password_change_required())
);
commit;

-- IMPORTANT: existing public storage bucket policies are not secured here.
-- Image upload access must be separately restricted before pilot rollout.
-- This file does not delete, reseed, or update any store.data payload.

-- Pilot safeguards — REVIEW ONLY. DO NOT RUN ON LIVE PRODUCTION YET.
-- Prerequisites: tested Supabase Auth login, backup/restore test, and client migration.
-- This file is intentionally NOT referenced by the live application.
--
-- Whole-document optimistic concurrency uses a monotonically increasing version.
-- Clients must supply the version they read. A stale write updates zero rows.
-- Access is restricted to explicitly approved authenticated users.

begin;

alter table public.store
  add column if not exists version bigint not null default 0;

create table if not exists public.hub_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','member')),
  created_at timestamptz not null default now()
);

alter table public.hub_members enable row level security;
revoke all on public.hub_members from anon, authenticated;
grant select on public.hub_members to authenticated;

-- A user can see only their own membership. Admin provisioning must be
-- done through a trusted server/admin process, never from the browser.
drop policy if exists hub_members_self_read on public.hub_members;
create policy hub_members_self_read on public.hub_members
  for select to authenticated using (user_id = (select auth.uid()));

-- The live open policies must remain until the authenticated client is
-- ready to cut over. DO NOT drop them in this additive migration.

create or replace function public.hub_save_store(
  expected_version bigint,
  next_data jsonb
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_version bigint;
begin
  if (select auth.uid()) is null or exists (
    select 1 from auth.users au
    where au.id = (select auth.uid())
      and coalesce((au.raw_app_meta_data ->> 'must_change_password')::boolean, true)
  ) or not exists (
    select 1 from public.hub_members m
    where m.user_id = (select auth.uid())
      and m.role in ('admin', 'member')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.store
     set data = next_data,
         version = version + 1,
         updated_at = now()
   where id = 'main' and version = expected_version
   returning version into new_version;

  if new_version is null then
    raise exception 'Save conflict: reload before saving' using errcode = '40001';
  end if;
  return new_version;
end;
$$;

revoke all on function public.hub_save_store(bigint, jsonb) from public, anon;
grant execute on function public.hub_save_store(bigint, jsonb) to authenticated;

commit;

-- CUTOVER (separate, only after verified client and admin access):
-- 1. Confirm all authorized users are in hub_members.
-- 2. Verify the new client uses authenticated reads and hub_save_store RPC,
--    handles 40001 conflicts without overwriting user edits, and refreshes
--    version on each successful save.
-- 3. Remove the legacy public/anon store policies and replace SELECT with:
--    to authenticated using (exists (select 1 from public.hub_members m
--    where m.user_id = (select auth.uid()))).
-- 4. Revoke INSERT/UPDATE/DELETE on public.store from anon/authenticated;
--    grant SELECT to authenticated. Keep direct writes via RPC only.
-- 5. Review entry-images storage policies separately; they are also open.
-- 6. Verify anonymous REST reads/writes fail, and restore drill works.

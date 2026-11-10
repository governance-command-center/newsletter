-- CUTOVER ONLY, after verified export and test restore of the legacy JSON.
-- The legacy store.data.users object contains browser-hashed passwords.
-- It MUST NOT be returned to authenticated clients after migration.
-- Requires authenticated accounts already provisioned in auth.users and hub_members.
-- Run in a transaction and verify the backup before committing.
begin;
do $$
begin
  if not exists (select 1 from public.hub_members where role = 'admin') then
    raise exception 'No authenticated administrator provisioned; refusing cutover';
  end if;
  if not exists (select 1 from public.store where id = 'main') then
    raise exception 'Missing store row; refusing cutover';
  end if;
end;
$$;
-- Keep a private, admin-only backup OUTSIDE public.store before executing.
update public.store
   set data = data - 'users', version = version + 1, updated_at = now()
 where id = 'main' and jsonb_typeof(data) = 'object';
commit;
-- Verify: select data ? 'users' from public.store where id = 'main';
-- Expected false. Do not reintroduce the old users object in client writes.

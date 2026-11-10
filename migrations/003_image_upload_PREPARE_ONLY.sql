-- Image upload cutover — REVIEW ONLY, DO NOT RUN ON PRODUCTION.
-- Existing bucket: entry-images. Public READ remains allowed for images
-- embedded in published public newsletters; WRITE requires signed-in members.
-- Prerequisites: new browser uploader sends user access token, verified
-- membership/first-login enforcement, and old public policies inventoried.
--
-- NOTE: storage.objects policies are shared across buckets. Do not remove
-- other buckets' policies. Identify exact policy names in Supabase first.
-- This file deliberately does not DROP existing policies, so it is NOT
-- a standalone security fix.

begin;

create policy "hub_entry_images_member_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'entry-images'
  and exists (
    select 1 from public.hub_members m
    where m.user_id = (select auth.uid())
  )
  and not coalesce(
    ((select auth.jwt()) -> 'app_metadata' ->> 'must_change_password')::boolean,
    false
  )
);

-- No authenticated UPDATE/DELETE policy: filenames are unique and
-- overwrites should be disabled. Existing permissive policies MUST be
-- removed at the coordinated cutover, otherwise they still grant access.
commit;

-- Before cutover:
-- SELECT policyname, roles, cmd, qual, with_check
-- FROM pg_policies WHERE schemaname='storage' AND tablename='objects';
--
-- Verify anon upload fails, member upload succeeds, first-login user
-- upload fails, and public newsletter images continue to render.

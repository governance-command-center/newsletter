-- ============================================================
-- Platform Updates — Supabase setup
-- Run this ONCE in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- It creates:
--   • a `store` table holding one JSON row (all entries + accounts)
--   • a public Storage bucket `entry-images` for screenshots
--   • policies so the app (using the publishable/anon key) can read
--     and write. NOTE: this is intentionally open, matching the
--     lightweight, trusted-team model we agreed on. Anyone with the
--     Project URL + publishable key can read/write the data and upload
--     images. Don't store confidential material.
-- ============================================================

-- 1) The shared data row -------------------------------------------------
create table if not exists public.store (
  id   text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.store enable row level security;

-- Allow the anon (publishable) key to read + write the single row.
drop policy if exists "store_read"  on public.store;
drop policy if exists "store_write" on public.store;
drop policy if exists "store_update" on public.store;

create policy "store_read"   on public.store for select using (true);
create policy "store_write"  on public.store for insert with check (true);
create policy "store_update" on public.store for update using (true) with check (true);

-- 2) The public image bucket --------------------------------------------
insert into storage.buckets (id, name, public)
values ('entry-images', 'entry-images', true)
on conflict (id) do update set public = true;

-- Allow the anon key to upload and read objects in this bucket.
drop policy if exists "entry_images_read"   on storage.objects;
drop policy if exists "entry_images_insert" on storage.objects;
drop policy if exists "entry_images_update" on storage.objects;

create policy "entry_images_read"
  on storage.objects for select
  using (bucket_id = 'entry-images');

create policy "entry_images_insert"
  on storage.objects for insert
  with check (bucket_id = 'entry-images');

create policy "entry_images_update"
  on storage.objects for update
  using (bucket_id = 'entry-images')
  with check (bucket_id = 'entry-images');

-- Done. Now go to Settings → API, copy the Project URL and the
-- publishable (anon) key, and paste them into the app's setup screen.

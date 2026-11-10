# Supabase Auth production cutover — 10 November 2026

- Main Hub defaults to Supabase Auth username/password. Only public Supabase URL and publishable key are embedded; no service-role key.
- Before the cutover, backed up the complete 10-entry store, including legacy users, to private `hub_private.store_cutover_backup_20261110`. Never expose this backup to clients.
- Removed legacy password hashes from the live store, preserving all 10 entries. Store version incremented 1 → 2.
- Removed anonymous store read and direct write grants. Authenticated approved members may read after password change; all writes use the version-checked `hub_save_store` RPC.
- Image upload policy requires authenticated membership. Public image reading remains for existing newsletter images.
- Two existing Supabase Auth accounts have admin roles. Member-role, image upload, drafts, archive, PDF, and concurrency tests remain to be completed.
- SQL grants/policies and backup were verified. Supabase advisor warns about intentionally exposed authenticated security-definer functions and disabled leaked-password protection.
- Browser verification of the published GitHub Pages app is required before declaring the rollout complete.

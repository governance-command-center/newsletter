# Supabase Auth migration — staged, not deployed

## Current state
The live app uses browser-side user/password hashes in `store.data.users` and an anonymous/publishable REST key for the shared `store` row. This is not adequate authentication or authorization. **Do not disable existing login or modify existing RLS until a working administrator account has been tested.**

## Target
- Individual accounts identified by verified work email; username and display name are profile fields.
- Admin creates users through Supabase Auth's administrative user-creation API, invoked only from a trusted server/Edge Function with the caller's admin JWT checked. **Never embed a service-role/secret key in GitHub Pages, browser JavaScript, or public repository files.**
- Admin supplies a temporary password (or a secure one-time setup process). Set `must_change_password=true` in trusted metadata or a protected onboarding table.
- First login routes to a forced change-password screen. Call Supabase Auth `updateUser({password: ...})`; only after successful update, clear the onboarding flag via a trusted server function that validates the user's session and the completed password update. Do not allow a member to clear the flag through direct client-side table updates.
- Reset password: use Supabase Auth email recovery. Admin never sees the user's permanent password.
- Enforce roles and permissions in Supabase Row Level Security (RLS); UI-only admin checks are not sufficient.
- After authenticated access is verified, remove the legacy `users` password-hash map from the shared `store.data` payload and stop sending it to browsers.

## Preservation
Do not reset, overwrite, or reseed the existing `store` row. Export a backup of `store.data` (including slides, archives, drafts and metadata) to an access-restricted location before migration. Keep existing IDs, authorship labels, coverage dates and attachments. Auth account IDs can be mapped to legacy usernames in a separate profile table.

## Required deployment sequence
1. Confirm Supabase project ownership and current `store` / `entry-images` RLS policies; verify the current backup.
2. Create a **staging** Supabase project or isolated staging schema and copy non-sensitive test entries.
3. Configure Supabase Auth and verified email delivery; set appropriate password and rate-limit policies.
4. Add a `profiles` table keyed by `auth.users.id` with username, display name, role, and migration mapping. Ensure RLS denies unapproved reads and writes.
5. Deploy an admin-only Edge Function for account creation and temporary-password setup, with strict authorization and no service-role key exposure to clients.
6. Implement a new browser Auth adapter (login, logout, session refresh, first-login password change and reset), behind a staged feature flag. Preserve existing live login until acceptance.
7. Move shared-data read/write to authenticated endpoints with RLS. The current whole-row JSON design still requires conflict prevention; implement compare-and-swap/versioned updates or per-entry records before multi-user production.
8. Test admin and member access, forced password change, password recovery, account disabling, and direct REST attempts by an unauthenticated caller.
9. Verify existing announcements, drafts, archives, Library, Presentation, email, and PDF outputs are unchanged.
10. Switch production only after a successful rollback drill; retire the old hash-based user map and rotate compromised credentials if applicable.

## Blocking decisions / access
- Supabase dashboard access (SQL Editor, Authentication, Edge Functions and RLS configuration).
- Whether each member has a usable work email for sign-in/recovery.
- Whether temporary passwords will be distributed through an approved secure channel.
- Database security configuration and policies must be inspected in the actual Supabase project; GitHub source alone cannot verify them.

## Acceptance criteria
- Anonymous clients cannot read or modify protected Hub data through REST.
- Members cannot call admin account-management functions or promote their own role.
- First-login users cannot access Hub data or bypass the change-password requirement.
- Passwords and service-role keys never appear in frontend code, storage payloads, or logs.
- Admin and member can sign in on separate browsers; password reset and session expiration work.
- No published entry, draft, archive, coverage date, link, or attachment is lost.

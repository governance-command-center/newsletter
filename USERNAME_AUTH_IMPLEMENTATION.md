# Username-only authentication — implementation status

Status: **prototype / NOT DEPLOYED / NOT PILOT READY**.

## User experience
Admin assigns `newsletter_vn01` and a random temporary password (12+ chars).
Member signs in with username + password, changes password at first login,
then signs in again. No real member email is collected. Password recovery is
admin-mediated only.

## Design
The Edge Function uses a deterministic `@users.invalid` synthetic email as
an internal Supabase Auth identifier. This is not a real mailbox; do not
enable email-based recovery or rely on confirmation messages. Authentication
and sessions are provided by Supabase Auth, not custom password hashes.

The Edge Function must be deployed with `verify_jwt=false` because the login
route is unauthenticated; protected actions verify the bearer token explicitly.
Never put the service-role key in frontend files or public GitHub secrets.

## Blockers before any deployment
1. Add and test the browser login/session/refresh/first-login screen; legacy
   login must remain intact until acceptance.
2. Add a protected read policy and a trusted versioned save adapter. Ensure
   both the RPC and read access reject accounts requiring password change.
   A stale JWT may retain old claims: explicitly refresh/relogin after change.
3. Implement frontend conflict UI that preserves unsaved changes. The whole
   JSON payload is still one record; optimistic concurrency prevents silent
   overwrites but requires user reconciliation.
4. Restrict anonymous UPDATE/INSERT/DELETE on `store` at cutover, and inspect
   image bucket policies and other endpoints. No client should write directly.
5. Provision first administrator via trusted dashboard/server process. Never
   add an unauthenticated bootstrap-admin endpoint.
6. Implement admin user-management interface and secure delivery of temporary
   passwords. Add rate limiting, audit logging and account disable/reset tests.
7. Test the Edge Function, including invalid usernames, missing tokens,
   malicious requests, non-admin provisioning, first-login bypass and resets.
8. Check Supabase Auth support for `@users.invalid` synthetic identifiers in
   the actual project before depending on this approach.
9. Verify backup restore in a non-production environment and test rollback.
10. Run regression tests for draft/publish/archive/images/presentation/newsletter.

## Data safety
Do not execute `001_pilot_safeguards_PREPARE_ONLY.sql` on production as a
standalone fix. It is additive and does NOT secure existing open policies.
Do not merge this draft PR as a completed security solution.

## Additional review findings (10 Nov 2026)
- The current live `script.js` uses a lightweight client-side hash and whole-row
  REST upsert. It is not protected by merely deploying an Edge Function.
- Image upload also uses the public key. Staged adapter now has authenticated
  upload and a prepare-only storage policy, but existing open storage policies
  must be inventoried and removed at cutover.
- **Critical**: password reset updates Auth metadata, but an already-issued JWT
  can carry the previous `must_change_password=false` claim until expiry.
  Database authorization must check current server-side account state (or
  revoke/expire sessions with a tested approach), not trust stale JWT claims.
- Account deletion, disabling, role edits, migration of old member display
  names, and secure initial admin provisioning are not yet implemented.
- This staged adapter is intentionally not loaded by production `index.html`.
  Do not interpret its existence as completed live UI integration.

## Staged Hub persistence bridge (10 Nov 2026)
`AUTH.securePilotBridge()` is now available on the PR branch. It adapts the authenticated client to the existing Hub's `pull`, `push`, `pullData`, `pushData`, and `uploadImage` contracts without activating the bridge in production. Writes use the versioned RPC, and conflicts reject rather than overwrite.

**Still blocked:** wiring this bridge into the actual Hub login and draft/publish workflows; reconciling competing edits without discarding the editor; migrating legacy `store.data.users` password hashes out of browser-readable data; secure account listing/edit/deactivation; and testing against a separate Supabase project with protected policies. The current legacy read/write path is not secure, even if the bridge is present. Do not deploy the cutover SQL or merge as production ready.

## Opt-in full Hub pilot code path
The PR now includes a gated full-Hub pilot at `?secure_pilot=1`. It uses Supabase Auth login, mandatory first-login password change, authenticated reads, versioned RPC writes, and authenticated image upload. Legacy login and writes remain the default for existing deployments. Secure pilot does not trust a legacy session and refuses insecure first-admin bootstrap.

**Not a production release:** This path has not been browser-tested against deployed Supabase. The secure pilot requires an isolated Supabase project with the migrations and Edge Function, a provisioned admin, and independent two-browser regression tests. Do not point the pilot at production until policies, storage, legacy-user-hash removal and restore drill are verified. In particular, `004_remove_legacy_password_hashes_CUTOVER_ONLY.sql` is a destructive cutover step and requires a separately verified backup. Anonymous legacy reads must be removed at the same cutover; never run 004 on its own. Existing member role-edit/deactivation flows are not implemented in the secure admin interface.

**Conflict behavior:** The secure bridge saves against the last observed version. A concurrent write is rejected, retaining the local editor and displaying a warning. Automatic per-entry merge is not implemented; users must export their local changes and reconcile. This is safe against silent overwrites but requires explicit acceptance testing.

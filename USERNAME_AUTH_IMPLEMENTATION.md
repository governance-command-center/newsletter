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

# Merchandising Updates Hub — Pilot Readiness (9 Nov 2026)

## Release decision
**Controlled demo only until the two backend blockers below are resolved and the end-to-end checklist passes.** The current client-side login is not a security boundary.

## Blocker A — access control (critical)
- Current implementation stores application users and password hashes inside `store.data.users`, accessible to browser code with the Supabase publishable key.
- Login uses a browser-side non-cryptographic hash; role checks are primarily browser-side.
- If Supabase RLS allows the publishable/anon key to read/write the `store` row, any holder of the key can potentially read user hashes and change data without signing in.
- **Required**: migrate to Supabase Auth (or organization SSO); enforce authorization in database RLS policies / privileged server-side functions; do not return password hashes to browsers. Protect `entry-images` if screenshots are confidential.
- Verify the actual deployed RLS policies before declaring security complete. GitHub source cannot reveal deployed Supabase policies.
- Do not paste Supabase service-role keys or user passwords into GitHub or chat.

## Blocker B — concurrent edits (critical)
- `AUTH.push` upserts the whole `store.data` JSON payload; `AUTH.pushData` and member/draft operations read–modify–write that row.
- `syncPush` serializes writes **inside one tab only**; it cannot prevent lost updates between two devices.
- **Required**: atomic server-side writes with version checks and conflict responses, or normalize entries/drafts/users into independent database rows with row-level authorization and per-entry versioning.
- On conflict, keep the local form intact, reload the latest shared record, and offer explicit retry/merge; never silently overwrite.
- Test with two separate logged-in browsers saving at the same time.

## End-to-end acceptance checklist
Use a separate pilot dataset, not production records. Record pass/fail, tester and timestamp for each.

1. Login as admin and member; verify unauthorized user cannot access data via REST, not just UI.
2. Create two entries in different regions in the same Wednesday–Monday coverage period. Paste text, links, table, and two images.
3. Save a shared draft; reload in a second browser; continue editing and save.
4. Publish the draft; verify it disappears from Shared Drafts and appears exactly once in Library.
5. Search Library by title and body keyword; filter platform, region, and coverage; reset filters.
6. Open Presentation while Library search is active; verify Presentation shows all published entries and independently filters by coverage.
7. Navigate Previous/Next; confirm full text, tables, images and region-specific official sources.
8. Generate Outlook newsletter for the batch; verify all entries, correct region/platform grouping, hyperlinks and image-only-when-no-official-link rule.
9. Generate PDF; compare every announcement against Library, links, tables, images and dates.
10. Archive a pilot entry, verify it disappears from active outputs, then restore it.
11. Two users edit different entries simultaneously; verify neither change is lost.
12. Two users edit the **same** entry; verify conflict is surfaced and no silent overwrite occurs.
13. Simulate failed network save; confirm the editor remains populated and errors are visible.
14. Export backup JSON and confirm it can be read/restored using a test dataset.
15. Test on Chrome at normal browser zoom and on the Outlook desktop paste workflow.

## Presentation UI
Keep the existing slim presentation toolbar (coverage period, theme, text size, counter, previous/next, exit). Do not show the full application sidebar over the presentation.

## Rollout
- Demo to manager: permitted using non-sensitive test data.
- Team pilot: only after access-control and concurrency blockers are resolved and checklist is passed.
- Production: require verified Supabase policies, backups and an agreed recovery owner.

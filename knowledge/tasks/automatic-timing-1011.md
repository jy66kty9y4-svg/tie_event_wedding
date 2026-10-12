---
type: task
tags: [component/interface, component/domain, component/runtime]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Automatic timing to the in-app calendar

The user approved automatic standard field mapping after removal of the manual calendar/responsibility disclosure. Implemented and verified locally, then published with the preceding 15-comment cabinet follow-up as `tie-review-20261011-r2` after the user's explicit publication request. See [[cabinet-followup-release-1011|Publication and production evidence]].

`src/timing-fields.js` resolves title/start/end from stable `title`/`time`/`end` IDs with matching types, plus existing standard day offsets, required flag and typed staff IDs. Visible column renaming does not break the connection. A saved `semanticMap`, including an explicit empty object, remains authoritative. Arbitrary labels, incompatible types and free-text names are never guessed. Calendar/readiness/busy intervals use this resolver without modifying records during reads.

New standard project timing tables automatically include `timing_assigned_users` (Сотрудники, users). When an organizer opens an existing compatible table online, the versioned, authorized `timing.ensure` command adds only that missing field. It requires exact table read/edit/structure and organizer access. Repetition is a no-op even with the old schema version after successful installation; stale versions before installation return 409. Existing values remain untouched. An occupied incompatible ID uses a suffix and `automaticTimingStaffId`; tables already at the 80-column bound remain unchanged. No schema migration or database-wide backfill.

Selected real project members automatically appear in assignee-filtered calendar events and staff overlap checks. Free-text Responsible/Participants remains intact and does not create assignments. Time/date changes are projected from the original rows and wedding date, without copied calendar records. Open dates generate no invented timing dates. Explicit day/end-day offsets retain existing semantics; overnight rollover is not guessed. Calendar fields and rows require current read permission; Team rows retain the organizer-only boundary. Readiness checks visible rows when no required flag exists, and flagged rows when it does; existing opt-in readiness policy remains.

The removed setup disclosure stays absent. Sheet `users` cells now use the anchored dropdown with multiple checked options, keyboard toggle/dismissal and selected-name summaries. Timeline summaries include selected staff alongside existing responsible text. Runtime Docker packaging includes the shared resolver. External Google/Apple sync remains its existing tasks/meetings contract; this feature targets the in-app calendar.

Validation: 236/236 Node tests (six new scenarios in `tests/automatic-timing.test.mjs`), focused 22/22 timing/calendar tests, fresh Vite build. CUA used isolated fictional accounts on loopback6191 and a legacy eight-column fixture: opening timing added the field automatically; two selections, deselection by keyboard, reload persistence, timeline names and native keyboard time edits 12:00–13:00 → 13:00–14:00 were verified. Calendar agenda reflected 13:00; couple timing/calendar showed pair/common events and excluded Team, with no setup control. Standard select Escape still works. Multiple dropdown geometry at390×844 and2560×1440 stays beside the trigger and inside the viewport; size restored. No browser warning/error logs. No production records changed; cold offline startup, exports and external calendar delivery were not rechecked here.

Evidence: `/private/tmp/tie-auto-timing-20261011/` holds test/build logs and isolated preview script/database. Screenshot: `TIE_Automatic_Timing_Staff.png` in the session visualization directory, showing the fictional program with persisted time and selected organizers.

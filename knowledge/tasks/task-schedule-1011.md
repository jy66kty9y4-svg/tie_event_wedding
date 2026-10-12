---
type: task
tags: [component/interface, component/domain, component/runtime]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Optional task deadlines and periods, 2026-10-11

User requested every plan task support no deadline, a specific date or an optional period. Existing wedding-relative schedules are retained as a fourth mode. No existing records were rewritten.

`server/v2/workflow/index.mjs` normalizes none/fixed/range/relative schedules. New title-only tasks default to none; partial edits retain legacy dueDate. Range startDate/endDate are inclusive, endDate becomes dueDate for reminders/overdue. Switching clears inactive fields. Invalid dates and reversed periods reject atomically; dependency/status/version/field checks remain unchanged. Normal/focused lists include undated tasks; explicit dated filters exclude them and match ranges by overlap. Wedding reschedule leaves none/range/fixed tasks unchanged with readable preview reasons, moving active relative tasks only.

`src/v2/workflow/Workspace.jsx` offers four modes in create/edit. None has no required date input. Period fields stack to retain readable dates in the narrow fieldset and on mobile. List/board/detail/grouped schedule show Без срока or period bounds. Calendar month/week shows a range on each included day; API dateRange true uses inclusive end and exact read checks for new fields. Undated tasks are absent from calendars and deadline notification scheduling; removing a date cancels queued reminders.

`server/v2/calendar/external.mjs` exports Google/CalDAV ranges as all-day start through exclusive end+1, imports external multi-day spans as range, retains existing one-day periods, and deletes previously linked events after removing a deadline. External account QA used mocks, not personal providers.

Verification: 207/207 Node tests and production build; six new tests in tests/task-schedule.test.mjs cover schedule transitions/legacy readback, atomic validation/permissions/stale versions, focused lists/date windows/calendar, reschedule invariance, reminder cancellation, and mocked Google round trip/deletion. Local fictional CUA verified new task without date/reload, fixed date then removal, period save/reload/edit, calendar entries on 11/12/13 October and mobile390 with 16px dates/scrollWidth390. Browser date inputs require native keyboard commit in this CUA environment; actual keyboard entry verified. Viewport reset. Screenshot /Users/cabinpxrn/.codex/visualizations/2026/10/10/01a1232d-67de-7ee3-85fd-6bcdda25e8bb/task-schedule.png.

Published tie-event:tasks-20261011-r1 after explicit user approval of exact archive/SSH destination. Auto-review initially rejected source transmission despite earlier general deployment instruction; exact user confirmation resolved it. Frozen archive SHA a46ca0e81702871393aa194f98d334926b2158ee6ce1a38a8333d3d8e7c04829; seven runtime files changed from vendors-r1, no additions/dependencies/migration. Image sha256:e042625ef0c9ac82a5542fb651ec98597a89bce5ae2ad1da23d38f63eec7641b. Isolated networkless Docker passed prior feature fixtures and task schedules without the production volume. Public root/health200, private API401, www308 and five byte-matching assets passed. Technical integrity/FK/schema16/34 users/14 weddings verified;22 business fingerprints matched before/after and final. Container healthy/0 restarts. Compose/Caddy/volume unchanged.

Before backup stamp20261010T231115Z, final mode0600 backup10,084,352 bytes. Rollback vendors-r1 with current volume and env-before-tasks-20261011-r1-20261010T231115Z. Evidence docs/DEPLOYMENT.md and /tmp/tie-tasks-20261011-r1-release. Production customer records were not used for QA writes. Inherited dirty tree left intact; no commit/staging. Three older whitespace diagnostics outside the runtime delta remain.

---
type: task
tags: [domain/tables, domain/calendar, domain/seating, task/implementation, status/done]
status: done
last_verified: 2026-10-12
---

# Shared table view, calendar controls/history and quarter turns

User requests the published estimate device rules in all tables, calendar sync controls in the agency calendar instead of settings, working history restoration for tasks/calendar events, and90° turns. Clarification: rotate the selected table/zone, not the entire room.

Baseline live image `tie-event:tie-budget-device-20261012-r1`; frozen source148-file manifest `/private/tmp/tie-budget-device-20261012-r1-release/source-manifest.json`. Workspace contains previous authorized changes; preserve them. Publication authorization persists across this site's follow-ups. No delegation used.

Implemented:

- `src/table-view.js`/`src/ui/useTableView.js` share device detection/local storage/layout/number measurement. Agency/user/wedding/table/device keys isolate views; original budget namespaces/migration remain compatible via wrappers. Main's TableViewProvider covers authenticated UI/modals. TableWorkspace, GuestRegistrySheet, standalone SheetEntry and VenueComparison use SheetZoom; columns are local, row heights retain existing saves. Phone defaults compact by type and automatic fit stays<=100%, manual zoom20–250%. Budget retains its exact approved baseline. No export/domain values rewritten by view preferences.
- CalendarWorkspace header now exposes sync modal (defaults to agency in agency calendar, wedding in project calendar), refreshes events after manual sync, and removes the settings/profile copies. Existing providers/OAuth/connection data are unchanged. Controls must be tested at320px.
- History dispatches task.restore/meeting.restore instead of generic entity.restore; cards show the record title and a pending state. Shared historicalRecord validates agency/entity/kind/project. Restore validates current versions/rights/dependencies/participants/dates and uses historical before_json (after only for creation snapshots). Relative tasks recompute against current wedding date. Meeting conflicts require fresh digest/reason; dedicated UI confirmation supports this. New meeting.restore queues external sync. No blanket generic restoration of protected workflows.
- quarterTurn preserves table/zone data, wraps degrees and clamps inside current hall; oversized rotated bodies refuse clearly. Selected table/zone sidebars offer left/right90° draft controls followed by existing Save; guests/assignments remain unchanged.

New tests: history-restore.test.mjs(5), table-view.test.mjs(2), seating-interaction quarter turn(1), external-calendar restore queue assertion. 39 prior focused tests, all269 final Node tests and fictional Chrome/WebKit suites pass. General table preference tests include10–20% persistence, and estimate retains20% minimum. New script scripts/tables-calendar-followup-ui-test.mjs covers all live table paths, local width/scale, editing/formulas/row height, moved sync, task/meeting edit/delete history, table/zone turns and seat preservation. Existing mobile-followup suite is a budget/gesture regression.

Chrome/WebKit additionally verify conflict-confirmation and standalone payment forms (now in a modal to avoid the mobile dock blocking controls), guest table fit at320px, and existing budget gesture/mode/migration/calculation regressions. WebKit touch is synthetic; no physical iPhone test is claimed. Fit includes full scroll extent because WebKit reports overflow beyond the table rectangle.

Frozen150 runtime files:17 modified/2 added versus budget-device r1. Source archive SHA256cbebb75d47f75f110662929d7cca7e9506e461ac210fc69a680152a49d1351db. All29 non-map build files match the browser-tested dist. Candidate image tie-event:tie-tables-calendar-20261012-r1 / sha256:cb3a6ca16060b77f5b6d0cc17707d3a4bebb8d21818803a935c0f8f77c0d3371 passes isolated default launch/health/privateAPI/Sharp/Home Screen,29 matching build files and32 candidate tests. Frontend helper tests use byte-matching QA source copies; server/interaction tests use actual image files. Test opt-in is TIE_ALLOW_REMOTE=0; production settings are unchanged. Docker/schema/dependencies/worker unchanged.

Published and verified: activation status0; image running/healthy/0 restarts. All22 business-table fingerprints match at activation and final verification. Integrity/FK/schema16/34 accounts/14 weddings pass. All25 public resources match the frozen build; HTTPS/health200/privateAPI/privatePhoto401/www308, cache/MIME/Home Screen checks pass. Existing live Chrome session in a separate temporary tab loads app-DRBh_7Zt.js and shows the calendar sync button without loading/errors/document overflow. Original user tab was not changed or reloaded.

Before backup /opt/tie-event/backups/before-tie-tables-calendar-20261012-r1-20261012T003617Z.sqlite; env env-before-tie-tables-calendar-20261012-r1-20261012T003617Z. Final consistent backup /opt/tie-event/backups/tie-tables-calendar-20261012-r1-after-verified.sqlite,0600/11,767,808 bytes. Temporary copy removed after matching SHA. Compose/Caddy hashes and volume identity unchanged. Rollback: budget-device r1 with CURRENT volume; never replace newer user data with an older DB. Public/live mutating restore/turn/sync interactions were not performed; those were tested with fictional local data. Evidence /private/tmp/tie-tables-calendar-20261012-r1-release/.

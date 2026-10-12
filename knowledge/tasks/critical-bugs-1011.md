---
type: task
tags: [task/implementation, component/interface, component/runtime, status/done]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Critical bugs BUG-01–BUG-06, 2026-10-11

User requests prioritizing six critical bugs and skipping those already fixed. User clarification: BUG-04 concerns the agency logo when the site is added to an iPhone Home Screen; it is not photo upload. Scope follows that clarification.

BUG-01/02 already work in current performance-r1 sources: fictional organizer opens wedding settings, edits team description, changes the wedding date through preview/confirmation, remains at the same project route, reloads with values preserved and has no page errors. Fresh Chrome and WebKit checks pass BEFORE this task's runtime change. No date/edit/navigation code changed.

BUG-03 already published and verified: counted Modal background locks, in-site meeting confirmation, immediate removal, ordered refresh and preserved remaining events. See [[calendar-delete-1011]]. Current modal/date/calendar/export/formula focused suite passes50/50 tests. Per the user's request, no duplicate implementation.

BUG-05 already corrected and published: actual OOXML download endpoints, authorized columns, typed amounts/dates/times, dimensions/order/styles, formula caches/recalculation and named-range lists. See [[excel-tables-1011]]. BUG-06 already corrected and published: all96 template articles/131 formula cells, entire Additional section, exact cents/empty/zero/overpayment/custom rows and agency organization/coordination fee/advance projection. See [[estimate-finance-1010]]. Current formula/export tests pass, including per-item sums and prevention of ledger double counting. No export/finance runtime changes.

BUG-04 new fix: index explicitly declares existing PNG `apple-touch-icon` and iOS standalone title/capability; manifest adds stable id and scope. Worker v8 serves the precached official brand files immediately from its CURRENT cache, instead of waiting for network or returning a failed network response. Index/API freshness and private-data exclusions remain unchanged. Brand changes require a worker cache version bump. Only index.html, public/manifest.webmanifest and public/sw.js change relative to the published performance source.

Validation:245/245 Node tests, production build; scripts/critical-bugs-ui-test.mjs passes Chrome and WebKit with mobile390x844. Explicit iOS icon present; actual image bytes return200/image/png from cache with zero brand-origin requests even when that origin would return404. Cold launch shows a decoded visible logo with networking disabled in Chrome and the server disconnected in WebKit. WebKit's automation offline toggle failed navigation before reaching its worker; disconnected-server testing exercises actual fetch failure successfully. No physical iPhone/Home Screen installation is available, so the automated check is not represented as a device acceptance. No production business records changed.

Prepared release `/private/tmp/tie-home-screen-20261011-r1-release/`:140 runtime files, exactly3 changed/no additions/deletions; archive SHA256 `2a45aa615c86b7454b05d514190a3d220b822a4d5e909450a6c0d3c5ba5c4f31`. No dependency/schema/backend/Docker/Compose/Caddy changes; application bundles match performance r1. Build and tests use the current source; all three changed files are frozen in that package.

Published `tie-event:tie-home-screen-20261011-r1` after the user answered «Да, опубликовать» to the new source-transfer/publication question. Initial automatic-review rejection was resolved by that explicit approval; a subsequent transient approval-service403 was retried successfully. Archive staged and built with the existing helper; isolated networkless smoke and candidate iOS metadata/192px PNG/worker v8/privateAPI checks pass. Candidate's first stdin import tripped the server's entrypoint realpath guard; only the test entrypoint was corrected, with no runtime/image change.

Image `sha256:d1e97674dc27e43987f9f0183089126523836affbfad553407f47506a9e4120d`, running/healthy/0 restarts. Public HTTPS health200, private API/photo401, www308, all25 resources byte-match, explicit iOS PNG icon and standalone metadata present. App bundle remains app-B-JQoxbe.js. Business fingerprints for all22 tables match before/after activation and final acceptance; integrity/FK pass, schema16/34 users/14 projects.

Source `/opt/tie-event/releases/tie-home-screen-20261011-r1`; before backup `/opt/tie-event/backups/before-tie-home-screen-20261011-r1-20261011T200727Z.sqlite`; final consistent backup `/opt/tie-event/backups/tie-home-screen-20261011-r1-after-verified.sqlite`,0600/11,530,240 bytes. Temporary duplicate freed only after SHA equality. Compose/Caddy hashes unchanged, existing external tie-event-data volume preserved. Rollback tie-event:tie-performance-20261011-r1 with CURRENT volume and env `/opt/tie-event/backups/env-before-tie-home-screen-20261011-r1-20261011T200727Z`; never restore old data over newer user actions. No production business edits for testing.

Evidence: `/private/tmp/tie-critical-existing-checks.log`, `tie-critical-ui-before.log`, `tie-critical-webkit-before.log`, `tie-critical-chromium.log`, `tie-critical-webkit-final.log`, `tie-critical-all-tests.log`, `tie-critical-build.log`; release directory has source manifest/delta, stage/candidate-final/activate/public-verify/postcheck logs. Public source reference: [Apple Home Screen configuration](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).

During initial interpretation of BUG-04, an AVIF metadata rejection was independently reproduced (`sharp` returns heif/av1). A trial fix/test was removed after the user's clarification; it is not included in this release. Also noticed existing multipart header lowercasing may break mixed-case browser boundaries; not changed or claimed verified in this narrowed task.

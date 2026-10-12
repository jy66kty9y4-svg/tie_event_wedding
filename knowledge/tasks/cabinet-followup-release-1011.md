---
type: task
tags: [component/interface, component/domain, component/runtime]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Cabinet follow-up and automatic timing publication

The user explicitly requested publication of the latest changes. `tie-review-20261011-r2` is now live on https://tie-event.ru, running/healthy with zero restarts. Includes [[cabinet-followup-1011|15 cabinet comments]] and [[automatic-timing-1011|Automatic timing]]. No new schema/dependencies/worker changes.

Frozen source has 137 files; relative to r1, 19 changed and three new runtime files, with no removals. Source SHA256 `e79a8ef4f4161822600325927af4738d70ad50f3d70e653b2d0d88c48fc4e71e`; image `62e86ad07bdf79ad68f9f0fff2d20ff81817e844a1b086cb68abf9ea059ba44f`. Archive/source parity checked. Fresh 236/236 Node tests and build; networkless/production-volume-free candidate starts correctly and passes 59 focused server tests with test-only `TIE_ALLOW_REMOTE=0`.

Public verification: health/site200, private API/photo401, www 308; 25 resources byte-match the frozen build, including five bundles and 17 brand files; correct WOFF MIME. Live couple CUA confirms new `app-CTeqp1mC.js`, avatar dropdown/no navigation, retained profile controls, pair-only timing/choices, absent setup disclosure/extra row control, admin-gated website, edit/delete icons, Venue without booking verification, proposal-only search, guest Actions 160/nowrap/resize and calendar. No console errors/document overflow. The viewed wedding has no date, so fake timing dates are not emitted. No business commands were issued for QA. Staff/date/time propagation was verified on fictional local fixtures and inside the candidate. Live contract upload/export and cold offline startup were not repeated.

All 22 business hashes matched before/after activation and after browser acceptance; integrity/FK pass, schema 16, 34 accounts / 14 weddings. Successful backup stamp `20261011T163953Z`; before and final snapshots are 0600, final 11,350,016 bytes. Same Compose/Caddy hashes and external `tie-event-data` volume. Rollback only the image to r1 with the CURRENT volume; the saved env is `/opt/tie-event/backups/env-before-tie-review-20261011-r2-20261011T163953Z`. Never restore an old database over new user actions.

Initial activation stopped before switching because 32 MiB container `/tmp` was full of old backup duplicates. Two exact copies were byte-compared with persistent backups and removed from `/tmp` only, then activation succeeded. Final backup duplicate was also freed after byte comparison. Persistent backups remain intact. Check temporary free space before future backups; source code did not need a change for this condition.

Release source `/opt/tie-event/releases/tie-review-20261011-r2`. Local evidence `/private/tmp/tie-review-20261011-r2-release/`: frozen manifest/delta, tests/build/stage/candidate/activation/public verification, final database comparison and `live-acceptance.json`. Screenshot `TIE_Live_Cabinet_R2.png` in the session visualization folder. Full operational paths and rollback are in `docs/DEPLOYMENT.md`.

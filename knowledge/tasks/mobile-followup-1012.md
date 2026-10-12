---
type: task
status: done
tags: [domain/vendors, domain/finance, domain/calendar, layer/frontend, layer/backend, risk/medium, task/implementation]
last_verified: 2026-10-12
updated: 2026-10-12
---

# Automatic venue catalog, mobile estimate zoom and meeting priority

User requested automatic agency saving for all created venues, two-finger zoom of the estimate on phones, and meetings before tasks in calendar cells regardless of task time. Implementation and publication are complete on tie-event.ru. The new work followed the user’s requests and the existing authorization for this site/server; no additional confirmation was requested.

- `server/service.mjs`: venue selection create/edit/restore atomically links a reusable agency vendor. It retains exact current source/copy permissions, photos and conditions, excludes wedding rent override/agreed price/notes/commission, reuses matching venue name+site within the agency and keeps different contractor categories separate. A duplicate active wedding assignment is rejected transactionally. Explicit old save commands remain idempotent; later wedding edits keep independent snapshots. An idempotent startup backfill links existing non-deleted venues in active weddings, including legacy category-only records, using the existing protected owner. Linking changes only vendorId/version/timestamp, with catalogLink audits, and never rewrites financial obligations. `server/http.mjs` runs it on startup; schema/dependencies unchanged.
- `src/ui/SheetZoom.jsx`/`sheet-zoom.css` wrap only CoupleBudget's table. Two-finger touch input anchors the table at the gesture midpoint, scales20–250%, suppresses accidental cell clicks and native page pinch only inside the table, and retains single-finger scrolling. Buttons offer decrease/increase/reset/fit; localStorage contains only a numeric scale scoped to agency/user/wedding. CSS zoom preserves actual scroll dimensions. Existing amount/formatting/exports remain domain data. ResizeHandle divides screen motion by zoom and cancels a pending drag when pinch begins; unrelated pointer IDs cannot commit it. Print resets zoom.
- CalendarWorkspace sorts meetings first after filtering each cell, before taking the first three visible items. Month, week and expanded day use the same order. Remaining order and chronological API/external feeds/agenda stay unchanged. No scheduling data changes.
- VenueForm explains that a newly created project venue is saved automatically. The separate manual save button disappears once linked.

## Verification

- 255/255 final Node tests pass. Three additional venue tests cover automatic/idempotent saving, duplicates/category isolation, preserved snapshots, restricted-catalog atomic denial and backfilling/legacy/deleted records/financial preservation.
- New `scripts/mobile-followup-ui-test.mjs` passes Chrome and WebKit with fictional data: actual form-to-catalog saving, eight-event overflow meeting priority in month/week/day, pinch geometry/cancellation/fit/reset/reload/user/project scope, scaled resizing, money edit/calculation/reload,320–768px overflow. Chrome additionally uses trusted browser touch input for two-finger pinch and one-finger panning with page scale1 and unchanged budget version. WebKit pinch uses synthetic touch events; physical iPhone testing is not claimed.
- Previous venue Chrome/WebKit320–2560 suite also passes: gallery/AVIF/order/comparison/base refresh/couple choice and access.
- Frozen146-file runtime source has6 modified/2 added files versus venue r1. Archive SHA256 `f0282356b0a41ec2516044778994095d5aed1fd33beb0ab9e20c90387a7199ce`; build29 non-map files match browser-tested build, frozen HTTP import passes. Bundles app-vW17_Nbi.js/app-C1xXFGAY.css/Workspace-CEKgzS7l.js/guest-87unq2UJ.js. No Docker/schema/dependency/worker changes.
- Server image `tie-event:tie-mobile-followup-20261012-r1`, digest `sha256:6c296e572f5b24a5dba7f979cc5ddc8212764c5517f7fa774a7e81140b195c8e`, passes isolated default-launch/health/privateAPI/Sharp/Home Screen checks,17 candidate tests and29 byte-matching build files.
- A consistent0600 preview backup was kept on the same server and copied only into a network-isolated temporary container. Preview startup linked1 existing venue and created1 catalog card. All20 unaffected business tables, every wedding field except its new catalog link, every financial record and the old audit are verified unchanged; only expected catalog insert/link audits are added. Integrity/FK pass, schema16/34 users/14 weddings. SQLite copies use writable tmpfs for WAL sidecars; mounted server backups remain read-only. Business data never left the server.

Evidence `/private/tmp/tie-mobile-followup-20261012-r1-release/`, screenshots `/private/tmp/tie-mobile-followup-previews/`. Activation preserves the existing volume and takes a fresh consistent backup. Because entities/audit intentionally change for the backfill, their exact semantic delta is verified separately from the20 unchanged table fingerprints. Rollback uses venue r1 image with the current volume.


## Published verification

- Activation exit0; image running/healthy/0 restarts. Source `/opt/tie-event/releases/tie-mobile-followup-20261012-r1`. HTTPS/health200/privateAPI/privatePhoto401/www308; all25 public resources byte-match the frozen build, WOFF MIME/immutable assets/no-store API/Home Screen metadata pass.
- Fresh before backup `/opt/tie-event/backups/before-tie-mobile-followup-20261012-r1-20261011T230104Z.sqlite`; env backup `env-before-tie-mobile-followup-20261012-r1-20261011T230104Z`. Final consistent copy `/opt/tie-event/backups/tie-mobile-followup-20261012-r1-after-verified.sqlite`,0600/11,718,656 bytes. Temporary duplicate freed only after matching SHA with the persistent copy.
- All20 unaffected business fingerprints match at activation and final verification. A strict comparison of before/final backup copies confirms exactly1 existing venue gained its link, exactly1 reusable agency card was added, all other wedding fields/financial records/photos stayed unchanged and the audit gained only the expected create/link entries. Integrity/FK/schema16/34 users/14 weddings pass. This intentionally changes entities/audit;22 unchanged hashes are not claimed.
- Existing live Chrome session in a separate temporary tab loads app-vW17_Nbi.js and visible scale controls at100%, with no document overflow or console errors. User’s original tab/form was left untouched. Populated calendar priority and actual gesture/edit interactions were tested in isolated fictional browser fixtures, not by editing production records or a physical iPhone.
- Compose/Caddy hashes and volume identity are unchanged. Rollback is venue r1 image with the current volume; never restore an old database over newer user work. Final verification helper and archive are retained on the server; the initial copy-check harness was adjusted for writable WAL sidecars and empty legacy vendorId fields before successful preview/final checks.

Evidence `stage.log`, `candidate-final.log`, `preview-backfill.log`, `activate.log`, `public.log`, `postcheck-db.log`, `postcheck-server.log`, `verify-final-data.log`, `live-browser.json`; source/build manifests and `verification-final.tar.gz` are in the local release directory. See `docs/DEPLOYMENT.md` for operational paths.

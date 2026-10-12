---
type: task
tags: [component/interface, component/runtime]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Horizontal guest names on rotated seating tables, 2026-10-11

User requested rotating tables and seat positions while keeping guest names horizontal and readable. In src/v2/guest/Workspace.jsx, svgMarkup previously put shapes, seat circles and guest text under the same rotation, making names rotate too. Each guest/empty-seat label now counter-rotates around its own seat center. The parent still rotates the table body and the seat positions; the label's baseline and offsets stay in screen coordinates.

Initial visual acceptance found overlapping horizontal names at rectangular corners after45 degrees. Assigned names are now anchored outside their seats according to the rotated screen direction: start/end on left/right sides, centered above/below for vertical seats. Font size and the existing surname-initial abbreviation remain unchanged; empty seat numbers remain centered. Assignment IDs/seat indexes/data, table shapes, geometry, drag/save behavior and permissions are untouched. The same generator supplies the screen, downloaded PNG and print layout.

Verification: final212/212 Node tests and production build pass. Initial full tests were blocked by sandbox localhost listen restrictions; the authorized run passed. No new implementation-mirroring tests were added for this presentation change. Local fictional CUA used24 assigned guests across rectangle45, circle90 and snakeQuarter270 tables. Via the ordinary rotation editor, verified0/22.5/30/45/90/180/270/-45/360 degrees: table rotation changes, all eight text orientations stay0 and names remain attached to the same seats. Save/reload and actual PNG download verified, with readable non-overlapping names. Mobile390 at300% keeps all24 names horizontal; viewport restored. Console errors0. Screenshots /Users/cabinpxrn/.codex/visualizations/2026/10/10/01a1232d-67de-7ee3-85fd-6bcdda25e8bb/seating-rotation.png and seating-rotation-export.png. Production records were not used for these test edits.

Frozen seating-names-20261011-r1 archive SHA256 ccab76cf8028e06b437def2c467ad15e7cb9c88170b7c7beed8be7f5541ecaaf. Compared with live calendar-delete-r1, only src/v2/guest/Workspace.jsx changed; no additions, dependencies, backend, schema, cache or worker changes. Combined isolated candidate extends prior feature fixtures with the exact SVG generator copied from the frozen source, covering six shapes × nine angles, label orientation, escaping and zero capacity. Local candidate passes.

Auto-review initially rejected transmission of this new private source archive despite prior calendar approval. User explicitly approved this archive, server ptitsa-plus130.17.11.158 and publication on tie-event.ru. SCP, stage smoke, isolated networkless Docker candidate and activation then passed.

Published seating-names-20261011-r1 image SHA256 8cb71761e6376e32825e8358140249a686eeec99f56d5332b005fe2c2f8e4b3d, running/healthy/0 restarts. HTTPS and health200, private API/photo401, www308; all five public assets byte-match the build. Integrity/FK pass, schema16, 34 accounts/14 weddings; 22 business fingerprints match before/activation/final. Before backup and environment use stamp20261010T235801Z; final consistent backup /opt/tie-event/backups/seating-names-20261011-r1-after-verified.sqlite is10,137,600 bytes mode0600. Compose/Caddy hashes and external volume unchanged. Rollback calendar-delete-20261011-r1 with current volume, never restore an older DB over new user actions.

User's existing production tab was intentionally reloaded, loaded app-Cq_DE--6.js and navigated through the wedding's primary Seating button. Page is accessible, console errors0. That wedding has no assigned guests/rendered labels, so production customer records were not edited; the visible rotation proof remains the fictional local plan. Source/build/runtime evidence /tmp/tie-seating-names-20261011-r1-release; deployment details in docs/DEPLOYMENT.md.

---
type: task
tags: [component/interface, component/domain, component/runtime, task/wedding-state]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Wedding state publication, 2026-10-11

The user explicitly requested publication of the latest changes. `tie-wedding-state-20261011-r1` is live on https://tie-event.ru. The 18 manual organizer checkpoints are smaller bare emoji in two fully visible rows below the phase/property controls; comments/editing use an anchored 300px non-modal panel without blur or backdrop. See [[wedding-state-1011]].

Frozen runtime source has 140 files: five changed and three added relative to review r2, no removals. Shared wedding-control module is included in the Docker runtime. Source archive SHA256 `bb5a5a06682a1530ebd6e7b505ba1d5b44bab981e17cdde0071fb7a7e4539a44`; image `sha256:74c8b923e3df962a9e942bbab1bcc9aa2c373940a8a27ceb51003fb29a794552`. No schema, dependency, worker, Compose or Caddy changes.

Fresh frozen-source build and 243 discovered Node tests: 242 passed, zero failed, one existing V1-backup migration test skipped because that local fixture is absent from the package. The earlier complete workspace run passed all 243. Candidate smoke and all 66 focused server tests pass inside a networkless container with temporary data only. Private stages, field grants, scoped history, versions/idempotency and persistence are covered.

Public HTTPS/health 200, private API/photo 401, www 308; all 25 public resources byte-match the frozen build. Main bundle `app-s499Mgtr.js`, CSS `app-RLY5zXSa.css`. Live CUA fresh couple session loads the new bundle, profile and account popover; no backdrop, horizontal overflow or console warning/error. An initial reload transiently failed in the in-app browser; a fresh tab loaded successfully, and direct HTTPS checks for profile/projects/estimate all returned 200. Organizer stage interaction was verified on fictional local fixtures, not by changing production wedding records. No business commands were issued for release QA.

All 22 business-table fingerprints match before/after activation and final verification. Integrity/FK pass, schema16, 34 accounts/14 weddings. Backup stamp `20261011T180124Z`; before `/opt/tie-event/backups/before-tie-wedding-state-20261011-r1-20261011T180124Z.sqlite`, final `/opt/tie-event/backups/tie-wedding-state-20261011-r1-after-browser.sqlite`, 0600, 11,358,208 bytes. External `tie-event-data` volume is unchanged; running/healthy with zero restarts. The final temporary backup duplicate is byte-compared before cleanup; persistent backups retained.

Rollback image `tie-event:tie-review-20261011-r2`, saved env `/opt/tie-event/backups/env-before-tie-wedding-state-20261011-r1-20261011T180124Z`. Keep the CURRENT data volume; never restore an old database over newer user actions. Source `/opt/tie-event/releases/tie-wedding-state-20261011-r1`. Evidence `/private/tmp/tie-wedding-state-20261011-r1-release/`; live screenshot `TIE_Live_Wedding_State_Release.png` in the session visualization directory.

---
type: task
tags: [task/budget-device, component/interface, component/runtime]
status: done
last_verified: 2026-10-12
---

# Device-specific estimate view, 2026-10-12

User requests separate estimate zoom by device/account/wedding and compact phone numeric columns matching their manual Chrome setup. Read-only inspection of their440×956 phone emulation measured46/200/165/127/120/110/123px columns, scale0.4551 and406px scroller. Their original tab/settings are untouched.

- `src/budget-view.js` and `src/ui/useBudgetView.js` keep view preferences in browser-local storage, scoped to agency/user/wedding and primary input/screen mode: phone, tablet, desktop. Separate browsers/physical devices have separate storage. Phone mode uses the smaller screen dimension so rotation preserves it; fine-pointer narrow desktop windows remain desktop. Chrome device emulation switches modes in the same browser. Legacy zoom migrates once to the active mode and leaves the old key available for rollback; existing new-mode settings win.
- CoupleBudget column widths are now local view overrides. Shared dimensions are retained as desktop/tablet fallback; phones start with the measured compact baseline independently of shared widths. Automatic numeric widths expand for rendered amounts and cell font sizes, without changing any financial values or export/shared layout. A manual local width takes precedence. Existing row-height saves remain shared. Other tables are unchanged.
- New phone views automatically fit the table until the user changes scale; manual zoom persists. Font completion/table-width changes re-fit the default. ResizeObserver writes are deferred to a frame to avoid WebKit resize-loop errors. Existing pinch anchoring/panning/edit protections remain intact.

260/260 Node tests pass, including5 preference/device/migration/validation tests. Chrome and WebKit fictional UI suites pass: compact widths/default fit, local scaled resizing/reload, separate browsers/users/weddings, legacy upgrade, large amounts with24px formatting, pinch/pan/edit/calculation/reload and320–768px overflow. Chrome additionally checks same-browser mobile emulation/rotation/desktop restoration with trusted touch input. WebKit touch is synthetic; no physical iPhone testing is claimed. Prior automatic venue/calendar scenarios also remain green.

Frozen148 runtime files have3 modified/2 added files versus mobile-followup r1. Archive SHA256883ef2ce5c9aa47c4c614859a62f735a5b7de2a8be3ef65ec350c003d9413811. All29 non-map build files match browser-tested output. app-CZxzLauL.js/Workspace-DARYBKRo.js/Workspace-NwltNUi7.css/app-C1xXFGAY.css; server/Docker/dependencies/schema/worker are unchanged. Evidence `/private/tmp/tie-budget-device-20261012-r1-release/`.

Publication uses the existing volume, a fresh consistent backup and all22 business-table fingerprints. Rollback target is mobile-followup r1 with the current data volume.

## Published verification

- Image `tie-event:tie-budget-device-20261012-r1`, digest `sha256:731cf04c2277d599347d35b0b8225f932bc2892e09fc5a3c8545d89a2b92c1e0`, running/healthy/0 restarts. Release `/opt/tie-event/releases/tie-budget-device-20261012-r1`; activation status0.
- Isolated default launch/health/private API/Sharp/Home Screen pass; all29 build files match and12 candidate tests pass. The first runtime-test invocation inherited the image's deployment opt-in; the QA container was restarted with TIE_ALLOW_REMOTE=0 for the explicit refusal test. Production environment is unchanged.
- Public HTTPS/health200, private API/photo401, www308 and25 byte-matching resources pass. Existing live Chrome session in a temporary tab loads app-CZxzLauL.js and the dashboard without errors/overflow. Original user's phone-emulation tab remains untouched; real wedding rows were never edited for browser QA.
- Before consistent backup `/opt/tie-event/backups/before-tie-budget-device-20261012-r1-20261011T233316Z.sqlite`; env `env-before-tie-budget-device-20261012-r1-20261011T233316Z`. Final consistent backup `/opt/tie-event/backups/tie-budget-device-20261012-r1-after-verified.sqlite`,0600/11,767,808 bytes. All22 business-table fingerprints match both at activation and final verification. Integrity/FK/schema16/34 users/14 weddings pass. Temporary backup duplicate removed only after matching SHA with the persistent copy.
- Compose/Caddy hashes and volume identity are unchanged. Rollback uses mobile-followup r1 with current volume, never an old database over newer user work. Evidence: source/build/delta manifests, Chrome reference metrics,260-test/Chrome/WebKit logs, stage/candidate-final/activate/public/postcheck logs and live-browser.json in the local release directory.

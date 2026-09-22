---
type: task
status: done
work_id: ux-fixes-20260913
role: worker
agent_role: developer
owner: "guest_fixes"
profile: L2
routing_grade: P4
progress_revision: 1
state_fingerprint: ""
no_progress_count: 0
circuit_state: closed
routing_reason: "Multi-file corrections from verified UX audit"
luna_benchmark_evidence: ""
exception_evidence: ""
assigned_model: gpt-5.6-terra
reasoning_effort: high
launch_status: inherited
actual_model: "inherited/unconfirmed"
actual_reasoning_effort: "inherited/unconfirmed"
fallback_reason: "Requested Terra/high was not confirmed by the runtime."
model_fallback: false
last_verified: 2026-09-13
updated: 2026-09-13
write_scope:
  - "src/v2/guest"
  - "server/v2/guest"
  - "tests/v2-guest.test.mjs"
  - "tests/v2-seating-interaction.test.mjs"
  - "tests/ux-guest.test.mjs"
source_paths:
  - "src/v2/guest"
  - "server/v2/guest"
  - "tests/v2-guest.test.mjs"
  - "tests/v2-seating-interaction.test.mjs"
  - "tests/ux-guest.test.mjs"
depends_on: []
tags:
  - "task/implementation"
  - "status/done"
links:
  - "[[../ORCHESTRATION|Orchestration]]"
---

# Guests seating accessibility and permissions

## Goal

Correct guest and seating mobile workflows, field-level permissions, invitation identification, and contour-editor accessibility from A05, A06, A07, A13, and A15.

## Scope and instructions

- Modify only `write_scope` paths.
- `assigned_model` is only a requested route. Before `review` or `done`, record `launch_status: confirmed` with matching actual model/effort, or `inherited` with actual model/effort and a fallback reason.

## Completion evidence

- Changed paths: `src/v2/guest/Workspace.jsx`, `src/v2/guest/ContourEditor.jsx`, `src/v2/guest/guest.css`, `server/v2/guest/index.mjs`, `tests/v2-guest.test.mjs`.
- Commands and tests run: bundled Node `--test tests/v2-guest.test.mjs tests/v2-seating-interaction.test.mjs` (26 passed); Vite production build; `git diff --check`. Handed focused browser cases to `ux_regression`.
- Result: guest registry has name search, no-seat filter, semantic mobile stacked rows without a 680px table minimum, per-row field permission checks, explicit no-access values, recipient-labelled/redacted invitations, consequence confirmation with focus management, and truthful copy status. Seating has guest/edit modes, usable zoom/fullscreen, geometry rendered only in edit mode, occupancy/seat conflict reasons, and source-ID focus. Contours support keyboard point creation, closure, movement and exact coordinates with 44px targets.
- Risks or follow-up: navigation must forward `sourceId` and `can(action, section, row, field)` as coordinated; browser regression is in progress with `ux_regression`.

## Handoff

Accepted by root for the local implementation. Integrated evidence and remaining release approval are recorded in `docs/v2/UX_FIXES_2026-09-13.md`. Production deployment is not claimed.

## Integrated acceptance

The final application source passed 99/99 Node tests and Vite build. Independent browser/CUA verification covered the audit workflows using temporary data; follow the consolidated report and final browser results rather than the earlier handoff limitations above. Root retained all pre-existing working-tree changes.

## R3 production follow-up

Live acceptance found missing values were mistaken for denied fields. `src/v2/guest/readable.mjs` now uses per-row field read permission; empty allowed RSVP and seating values retain readable fallbacks and filters, while restricted values remain hidden. The temporary deleted-property fixture, 101/101 tests and build passed; R3 was deployed and the live unseated guest/filter scenario passed without modifying business data.

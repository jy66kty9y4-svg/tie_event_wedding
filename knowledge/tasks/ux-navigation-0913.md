---
type: task
status: done
work_id: ux-fixes-20260913
role: worker
agent_role: developer
owner: "navigation_fixes"
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
actual_reasoning_effort: "inherited"
fallback_reason: "Parent task supplied this worker; runtime did not expose the requested Terra/high route."
model_fallback: false
last_verified: 2026-09-13
updated: 2026-09-13
write_scope:
  - "src/main.jsx"
  - "src/styles.css"
  - "src/ui/AppShell.jsx"
  - "src/ui/Modal.jsx"
  - "src/ui/ProjectTools.jsx"
  - "src/ui/TableWorkspace.jsx"
  - "src/v2/routes.js"
  - "src/v2/calendar"
  - "src/v2/workflow"
  - "server/v2/calendar/readiness.mjs"
  - "server/v2/workflow"
  - "tests/ux-navigation.test.mjs"
source_paths:
  - "src/main.jsx"
  - "src/styles.css"
  - "src/ui/AppShell.jsx"
  - "src/ui/Modal.jsx"
  - "src/ui/ProjectTools.jsx"
  - "src/ui/TableWorkspace.jsx"
  - "src/v2/routes.js"
  - "src/v2/calendar"
  - "src/v2/workflow"
  - "server/v2/calendar/readiness.mjs"
  - "server/v2/workflow"
  - "tests/ux-navigation.test.mjs"
depends_on: []
tags:
  - "task/implementation"
  - "status/done"
links:
  - "[[../ORCHESTRATION|Orchestration]]"
---

# Routes calendar tasks navigation and shared form accessibility

## Goal

Repair audit findings A01, A02, A08, A09, A11, A12, A15 and A16 in the owned navigation, calendar, workflow, shared-form and readiness paths.

## Scope and instructions

- Modify only `write_scope` paths.
- `assigned_model` is only a requested route. Before `review` or `done`, record `launch_status: confirmed` with matching actual model/effort, or `inherited` with actual model/effort and a fallback reason.

## Completion evidence

- Changed paths: central route/navigation handling, AppShell, table accessibility, calendar grid and task flow, workflow task ordering and presentation, readiness attention wording, and focused route/date tests.
- Commands and tests run: `node --test tests/ux-navigation.test.mjs tests/v2-calendar.test.mjs tests/v2-workflow.test.mjs`; Vite production build; `git diff --check`.
- Result: 23 focused tests passed; build and diff check passed.
- Risks or follow-up: browser acceptance should exercise the dirty publication guard through mobile navigation and the calendar-to-task flow with real project data.

## Handoff

Accepted by root for the local implementation. Integrated evidence and remaining release approval are recorded in `docs/v2/UX_FIXES_2026-09-13.md`. Production deployment is not claimed.

## Integrated acceptance

The final application source passed 99/99 Node tests and Vite build. Independent browser/CUA verification covered the audit workflows using temporary data; follow the consolidated report and final browser results rather than the earlier handoff limitations above. Root retained all pre-existing working-tree changes.

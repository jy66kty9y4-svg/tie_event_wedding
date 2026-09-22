---
type: task
status: done
work_id: ux-fixes-20260913
role: worker
agent_role: developer
owner: "system_flow_audit"
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
actual_model: "inherited-unconfirmed"
actual_reasoning_effort: "inherited-unconfirmed"
fallback_reason: "The runtime could not confirm the requested new route because the thread limit required reuse of the existing audit agent."
model_fallback: true
last_verified: 2026-09-13
updated: 2026-09-13
write_scope:
  - "src/v2/publishing"
  - "server/v2/publishing/index.mjs"
  - "src/ui/unsaved-changes.mjs"
  - "tests/ux-publishing.test.mjs"
source_paths:
  - "src/v2/publishing"
  - "server/v2/publishing/index.mjs"
  - "src/ui/unsaved-changes.mjs"
  - "tests/ux-publishing.test.mjs"
depends_on: []
tags:
  - "task/implementation"
  - "status/done"
links:
  - "[[../ORCHESTRATION|Orchestration]]"
---

# Safe publication drafts timezone and public responsive header

## Goal

Make wedding-site editing preserve the configured project time zone and unsaved work, require specific confirmation for destructive publication actions, and keep public navigation and publishing controls usable at 320 px.

## Scope and instructions

- Modify only `write_scope` paths.
- `assigned_model` is only a requested route. Before `review` or `done`, record `launch_status: confirmed` with matching actual model/effort, or `inherited` with actual model/effort and a fallback reason.

## Completion evidence

- Changed paths: `src/v2/publishing/Workspace.jsx`, `src/v2/publishing/datetime.mjs`, `src/v2/publishing/publishing.css`, `server/v2/publishing/index.mjs`, `src/ui/unsaved-changes.mjs`, `tests/ux-publishing.test.mjs`.
- Commands and tests run: `node --test tests/ux-publishing.test.mjs tests/v2-publishing.test.mjs`; `node --check` for the server and both new modules; isolated Vite transform of `Workspace.jsx`; `git diff --check` for the owned scope.
- Result: 15/15 focused and publishing regression tests passed. The close instant round-trips in the project time zone, including preserving the selected instant during a DST fold. Navigation guards block, allow and unregister synchronously. The editor is unavailable until its request succeeds, ignores stale responses, disables editing while a returned server row is applied, and prevents timing import over unsaved fields. Destructive publication actions are grouped and require consequence-specific confirmation. React and SSR public headers have a 320 px layout with 12 px labels and 44 px navigation targets. Upload, save, copy and date-validation states have visible, associated status text.
- Risks or follow-up: central navigation must call `confirmNavigation()` before internal transitions and popstate; owned by `navigation_fixes`. Full integrated Vite build and 320 px browser measurement belong to consolidated QA because a concurrent calendar edit temporarily prevented the repository build during this task. No deployment or production mutation was performed.

## Handoff

Accepted by root for the local implementation. Integrated evidence and remaining release approval are recorded in `docs/v2/UX_FIXES_2026-09-13.md`. Production deployment is not claimed.

## Integrated acceptance

The final application source passed 99/99 Node tests and Vite build. Independent browser/CUA verification covered the audit workflows using temporary data; follow the consolidated report and final browser results rather than the earlier handoff limitations above. Root retained all pre-existing working-tree changes.

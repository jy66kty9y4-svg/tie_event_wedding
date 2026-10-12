---
type: task
tags: [layer/frontend, layer/backend, capability/navigation, risk/medium, status/done, task/review]
status: complete
updated: 2026-10-10
---

# Full system audit — 10 October 2026

Scope: audit the current working tree, production build, all automated domain/runtime suites, browser scenarios, navigation/history/deep links and responsive layouts, permissions, persistence and offline behavior. Use disposable local databases for writes. Existing application changes and live business data remain untouched.

Owner: root; no delegated agents. Evidence: `test-results/audit-2026-10-10/`. Final report: `docs/v2/SYSTEM_AUDIT_2026-10-10.md`.

Completed: 154/154 final workspace Node tests; production build; 132 local route/viewport checks; 84 authenticated read-only production route/viewport checks; navigation/history/scroll/drafts/keyboard checks; complete new registration/approval/questionnaire lifecycle; isolated persistence/offline tests and dependency audit. Browser scripts required explicitly recorded temporary harness adaptations. During the audit other work changed the shared tree; frozen source manifests and successive test results distinguish versions.

Findings: late responses replace the last selected project; session deduplication collides for independent cookie jars sharing IP/User-Agent; history, publishing, timing and table-library overflow; new-meeting draft uses edit/delete UI; missing static files return 200 HTML; four package advisories; public source maps; stale browser acceptance scripts. New-account onboarding defects observed in an intermediate version were resolved by concurrent work and reverified in the final UI lifecycle. No application fixes or release performed by this audit.

Final report: `docs/v2/SYSTEM_AUDIT_2026-10-10.md`. Reusable isolated regression harness: `scripts/system-audit-test.mjs`. Evidence and source snapshots: `test-results/audit-2026-10-10/` (ignored by Git).

Independent follow-up review: [[system-audit-review-1010]]. Historical counts were verified, but route smoke did not prove every action or loaded data, and adapted V2 used the earlier snapshot. Fresh frozen-source verification passed 165/165 Node tests and 66 route-content cases; 11 unchanged browser suites produced five passes and six non-passes, including one bounded run. Four important defects independently reproduced. See `docs/v2/SYSTEM_AUDIT_REVIEW_2026-10-10.md` for exact coverage and version limits.

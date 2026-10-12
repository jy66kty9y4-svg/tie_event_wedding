---
type: task
tags: [layer/frontend, layer/backend, capability/navigation, risk/medium, status/done, task/review]
status: complete
updated: 2026-10-10
---

# Independent review of system audit — 10 October 2026

User requested independent verification of the earlier audit and its completeness, explicitly permitting subagents. Root owns report/knowledge updates; three read-only reviewers owned non-overlapping evidence, coverage, and reproduction artifact directories. Requested route: P6 `gpt-5.6-sol/high`; spawn responses confirmed launch, but actual model/effort was not exposed and remains unconfirmed. Operational state is in `test-results/audit-review-2026-10-10/orchestration.json` because `.codex` is read-only under the current permission profile.

Accepted findings: historical arithmetic is correct, but the 216 route/viewport cases were shallow smoke checks. Earlier 154/154 came from the moving workspace; adapted V2 12/13 used the earlier snapshot. One later change to the final snapshot's audit harness invalidated that file's manifest hash. Production source claims must be scoped to their versions. Existing report amended to link the review and make these limits explicit.

New immutable source snapshot: 2026-10-10T19:36:02.928Z, 137 source files, manifest SHA-256 `b1c65d32293ad1951b7a66f6790406bf22c917941adb6d4c3c8c21fb2581ce54`; all manifest files still match. Dependencies remain a symlink to installed node_modules, with lockfile hashed. Root `scripts/ui-test.mjs` changed after snapshot; final browser runs use the saved script. No application source changes by this review.

Validation: production build passed; frozen Node suite with read-only original V1 fixtures and temporary migration copies passed 165/165 with no skips; workspace suite also passed 165/165. Stronger browser route checks passed 66/66 (33 routes at 1440/390 px), with expected route headings/regions, selected project, error checks and final network-idle wait. A delayed calendar 503 demonstrated that the original route smoke could pass before data failure. Initial anonymous /api/state 401 is allowed only before login; unexpected runtime/console/HTTP/request failures are checked separately. Final extended run 68/68 includes the two method/error checks.

All 11 unchanged browser suites attempted on the same frozen source: five pass (auth, client waiting, users, workspace switch, V2 entry), six non-pass (browser fixture import graph, offline old route, management required phone, UI old onboarding assumption, visual old font contract, V2 stale selectors). V2 reached the explicit 180-second bound; post-termination closed-browser failures are cascade and not independent product failures. Whole browser set is not green.

Four important findings independently reproduced with a separate script: project response race, independent cookie-jar session collision, new-meeting edit/delete UI, and missing JS receiving 200 HTML. Full catalog of six historical browser adaptations and fixture changes saved; old generic ERR_FAILED did not reproduce and has no request attribution, so no product-defect claim or blanket filter.

Remaining coverage limits: all role/action combinations; complete file/download lifecycle; service-worker version update; real external calendar/message integrations; operational backup/restore and container execution; browser/device variety, full accessibility, sustained load and penetration testing. Review is complete, system remediation and exhaustive coverage are not claimed.

Report: `docs/v2/SYSTEM_AUDIT_REVIEW_2026-10-10.md`. Evidence: `test-results/audit-review-2026-10-10/`.

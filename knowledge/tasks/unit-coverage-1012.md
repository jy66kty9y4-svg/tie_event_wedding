---
type: task
tags: [layer/frontend, layer/backend, layer/data, risk/medium, status/done, task/implementation]
status: complete
updated: 2026-10-12
---

# Effective automated coverage — 12 October 2026

User request: broadly cover the website and system with effective unit tests. Owner: root, no delegation. Preserve all existing work and the clean production database. Fixtures must be fictional and local.

Baseline: Node24 native runner,275 registered tests,274 passed/one skipped legacy migration fixture,12.7seconds with coverage. Imported non-React business/server modules:95.63% lines,84.64% branches,89.36% functions. This scope does NOT measure React rendering,unimported client modules or browser gesture behavior. One-line functions make line coverage alone insufficient.

Scope: independent arithmetic/money oracles, validation boundaries, authorization scopes, dates/time zones, schema/export contracts, seating geometry, client transport behavior, transactions/replay/session invariants and reproducible synthetic migration fixtures. Add deterministic property tests and targeted mutation checks. Fix reproduced defects and rerun focused/full suites. Track counts,coverage scope and any remaining limitations in the final report.

Completed:373 new registered tests in12 files; skipped migration now runs on independent fictional V1 DDL. Full648/648 pass without skips; fast372 checks take1.3seconds. Coverage including newly imported client transport:93.31% lines,86.75% branches,90.16% functions. Baseline aggregate is not directly comparable because client.js was previously absent. Auth branches94.81→98.64%, geometry71.43→91.49%, venue83.22→95.98%, shared81.25→100%. Native thresholds93/86/90 enforced by test:coverage.

16/16 targeted mutation checks detected assertion failures in isolated source copies; syntax/import/timeout failures do not count. Native test:unit/test:coverage/test:mutations work through pnpm. Build passes, unchanged frontend output app-DwN_2Ome.js. Evidence: test-results/unit-coverage/; docs/TESTING.md.

Fixed: invalid dates causing RangeError/HTTP500; malformed IDs/inherited type names/null columns and early semantic guards, formula/row validation faults; Promise results redacted to{} before synchronous command check; maintenance timestamp ties changing default template. HTTP400, rollback and subsequent usable wedding verified. All corrections remain local; no deployment or live data changes.

Limits: no JSX/gesture coverage; client transport does not exercise full IndexedDB replay; native report omits never-imported files. External provider/publishing/error branches remain future focused targets. Whole-tree diff whitespace warnings predate this task; its new files introduce none.

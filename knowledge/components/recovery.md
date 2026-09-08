---
type: component
tags:
  - knowledge/component
last_verified: 2026-09-08
source_paths:
  - server/service.mjs
  - src/main.jsx
  - src/client.js
---

# Recovered application

The first workers were interrupted by the model service returning HTTP 403. Their /tmp worktrees disappeared before commits. The integration owner reconstructed their apply_patch operations from local execution records into the project. Historical first-wave cards are not accepted handoffs.

Verified recovery baseline: production Vite build passes; seven domain test groups pass; three HTTP test groups pass when localhost ports are permitted. No live GUTV/Finance data or source changes.

Known remaining work: full dynamic structure UI and native editing coverage, mobile hero clipping, cash/money inputs, draft-save errors and permissions, usable schema/relation/formula editors, offline cold-start/payment/conflict/logout browser validation. scripts/browser-test.mjs currently awaits serviceWorker.ready before registering the service worker, so fix the test bootstrap before relying on it.

All new worker copies must live in project .worktrees (ignored), and commits are required at verified milestones. Orda state belongs to the persistent visualization workspace outside the Git worktree, not /tmp. Do not alter this shared note in workers; return verified knowledge delta.

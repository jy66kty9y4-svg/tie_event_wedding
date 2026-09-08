---
card_id: wedding-finish-runtime
status: frozen
version: 2
supersedes: null
work_id: wedding-finish
task_id: runtime
purpose: Verify and finish real offline restart payments and synchronization
role: developer
card_path: knowledge/tasks/wedding-finish-runtime.md
dependency_shas: []
branch: codex/finish-runtime
write_scope:
  - server/http.mjs
  - src/client.js
  - public/sw.js
  - scripts
  - tests/runtime.test.mjs
forbidden_paths:
  - PROMPT_DEVELOPER.md
contract_versions:
  input: v1
  output: v1
acceptance_commands:
  - node --check server/service.mjs
knowledge_paths:
  - knowledge/INDEX.md
  - knowledge/tasks/wedding-finish-runtime.md
  - knowledge/components/recovery.md
---

Fix browser-test registration hang. Verify offline first-load preparation, browser restart, row edit and payment, two independent device payment conflicts, revoked rights/schema, logout and account switch. Fix actual client/server transport defects and preserve API exports.

Read selected notes only. Do not load Orda/routing or spawn. Commit owned files at verified milestones. Return feature SHA, actual checks and bounded knowledge_delta. No credentials or private records in notes. Requested route: P4 Terra high for interface; P6 Sol high for runtime/domain due financial and authorization risks; actual runtime model unconfirmed until tool reports.

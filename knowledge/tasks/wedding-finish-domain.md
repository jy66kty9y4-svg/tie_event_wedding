---
card_id: wedding-finish-domain
status: frozen
version: 2
supersedes: null
work_id: wedding-finish
task_id: domain
purpose: Complete financial and permission acceptance gaps
role: developer
card_path: knowledge/tasks/wedding-finish-domain.md
dependency_shas: []
branch: codex/finish-domain
write_scope:
  - server/db.mjs
  - server/auth.mjs
  - server/model.mjs
  - server/service.mjs
  - tests/domain.test.mjs
forbidden_paths:
  - PROMPT_DEVELOPER.md
contract_versions:
  input: v1
  output: v1
acceptance_commands:
  - node --check server/service.mjs
knowledge_paths:
  - knowledge/INDEX.md
  - knowledge/tasks/wedding-finish-domain.md
  - knowledge/components/recovery.md
---

Current seven tests pass. Inspect remaining correctness and requirement gaps with targeted regression coverage: field permissions across verbs, finance corrections, multiple grants, delete/restore dependencies, invitations and self-service clarification, template/native fields. Do not add speculative features. Coordinate contract changes.

Read selected notes only. Do not load Orda/routing or spawn. Commit owned files at verified milestones. Return feature SHA, actual checks and bounded knowledge_delta. No credentials or private records in notes. Requested route: P4 Terra high for interface; P6 Sol high for runtime/domain due financial and authorization risks; actual runtime model unconfirmed until tool reports.

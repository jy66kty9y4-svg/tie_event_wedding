---
card_id: wedding-finish-interface
status: frozen
version: 2
supersedes: null
work_id: wedding-finish
task_id: interface
purpose: Finish complete editable and responsive wedding interface
role: designer
card_path: knowledge/tasks/wedding-finish-interface.md
dependency_shas: []
branch: codex/finish-interface
write_scope:
  - src/main.jsx
  - src/ui
  - src/styles.css
forbidden_paths:
  - PROMPT_DEVELOPER.md
contract_versions:
  input: v1
  output: v1
acceptance_commands:
  - node --check server/service.mjs
knowledge_paths:
  - knowledge/INDEX.md
  - knowledge/tasks/wedding-finish-interface.md
  - knowledge/components/recovery.md
---

Complete actual UI requirements, fix mobile clipping and form/schema/permission gaps. Read PROMPT_DEVELOPER.md and docs/API_CONTRACT.md. Verify against running server and browser. Only owned source writes.

Read selected notes only. Do not load Orda/routing or spawn. Commit owned files at verified milestones. Return feature SHA, actual checks and bounded knowledge_delta. No credentials or private records in notes. Requested route: P4 Terra high for interface; P6 Sol high for runtime/domain due financial and authorization risks; actual runtime model unconfirmed until tool reports.

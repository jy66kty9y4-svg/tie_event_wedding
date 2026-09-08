---
card_id: wedding-v1-interface
status: frozen
version: 2
supersedes: null
work_id: wedding-v1
task_id: interface
purpose: Build complete responsive wedding agency interface
role: designer
card_path: knowledge/tasks/wedding-v1-interface.md
dependency_shas: []
branch: codex/wedding-interface
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
  - knowledge/tasks/wedding-v1-interface.md
---

React UI including public website and auth, project workspaces, CRUD flexible tables, finance, invitations/access editor, templates/settings, offline queue UI. Read docs/API_CONTRACT.md and PROMPT_DEVELOPER.md. Use frontend-design skill. Validate production build and browser after integration.

Route planned: P4 Terra high for implementation, P6 Sol high for security-sensitive domain/runtime. No persistent role configuration files installed. Use a bounded write-capable worker. Do not modify frozen card. Return knowledge_delta with verified facts.

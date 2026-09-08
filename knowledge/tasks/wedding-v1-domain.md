---
card_id: wedding-v1-domain
status: frozen
version: 2
supersedes: null
work_id: wedding-v1
task_id: domain
purpose: Finish domain correctness and acceptance regression tests
role: developer
card_path: knowledge/tasks/wedding-v1-domain.md
dependency_shas: []
branch: codex/wedding-domain
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
  - knowledge/tasks/wedding-v1-domain.md
---

Inspect implemented domain and correct substantive bugs, permissions agency/project/row/field isolation, idempotency vs independent payment conflicts, restoration, invitations, guest/timing schema consistency and native finance. Add meaningful node:test acceptance scenarios. Keep external API contract stable; message interface/runtime changes.

Route planned: P4 Terra high for implementation, P6 Sol high for security-sensitive domain/runtime. No persistent role configuration files installed. Use a bounded write-capable worker. Do not modify frozen card. Return knowledge_delta with verified facts.

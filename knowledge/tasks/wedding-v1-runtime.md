---
card_id: wedding-v1-runtime
status: frozen
version: 2
supersedes: null
work_id: wedding-v1
task_id: runtime
purpose: Implement HTTP transport, offline client and local demo
role: developer
card_path: knowledge/tasks/wedding-v1-runtime.md
dependency_shas: []
branch: codex/wedding-runtime
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
  - knowledge/tasks/wedding-v1-runtime.md
---

Implement docs/API_CONTRACT.md transport/client contract exactly, private IDB account isolation, permitted offline preparation, durable replay/conflicts, cache shell without API, clean startup and optional fictional demo. Test HTTP and offline client as feasible.

Route planned: P4 Terra high for implementation, P6 Sol high for security-sensitive domain/runtime. No persistent role configuration files installed. Use a bounded write-capable worker. Do not modify frozen card. Return knowledge_delta with verified facts.

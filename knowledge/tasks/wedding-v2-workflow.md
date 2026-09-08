---
card_id: wedding-v2-workflow
status: frozen
version: 2
supersedes: null
work_id: wedding-v2
task_id: workflow
purpose: Implement preparation tasks and immutable approvals end to end
role: developer
card_path: knowledge/tasks/wedding-v2-workflow.md
dependency_shas: []
branch: codex/v2-workflow
write_scope:
  - server/v2/workflow
  - src/v2/workflow
  - tests/v2-workflow.test.mjs
  - docs/v2/WORKFLOW-API.md
forbidden_paths:
  - server/db.mjs
  - server/service.mjs
  - server/http.mjs
  - src/main.jsx
  - src/styles.css
contract_versions:
  input: v2
  output: v2
acceptance_commands:
  - node --test tests/v2-workflow.test.mjs
knowledge_paths:
  - knowledge/INDEX.md
  - knowledge/tasks/wedding-v2-workflow.md
  - knowledge/components/v2-contract.md
---

Task plan, phases, 18-task templates and repeat-safe application preview; task dependencies, assignments, board/list/calendar views, reschedule transaction preview including anchored meetings; immutable approval revisions, any/all voting, changes requests, comments, explicit conflict-safe budget linking. Fulfill respective REQUIREMENTS 2,3 plus common/security/AC; read full exact requirements. Own server/v2/workflow/**, src/v2/workflow/**, tests/v2-workflow.test.mjs, docs/v2/WORKFLOW-API.md. Test persistence/versions/rights/cycles/date+price conflicts, never assume administrator may vote for another person.

Use common module interface and only scoped files. Implement complete working module and frontend, not placeholders. Run focused tests and build parse check as feasible; root integrates final browser tests. Commit feature changes and return SHA, changed paths, exact passing checks, API hooks and concise knowledge_delta proposal. Do not edit frozen card/shared knowledge. Never spawn or load Orda/routing. Requested P4 Terra/high, runtime model not confirmed until tool response.

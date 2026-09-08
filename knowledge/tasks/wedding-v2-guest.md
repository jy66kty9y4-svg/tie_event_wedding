---
card_id: wedding-v2-guest
status: frozen
version: 2
supersedes: null
work_id: wedding-v2
task_id: guest
purpose: Implement mapped guest RSVP and visual seating end to end
role: developer
card_path: knowledge/tasks/wedding-v2-guest.md
dependency_shas: []
branch: codex/v2-guest
write_scope:
  - server/v2/guest
  - src/v2/guest
  - tests/v2-guest.test.mjs
  - docs/v2/GUEST-API.md
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
  - node --test tests/v2-guest.test.mjs
knowledge_paths:
  - knowledge/INDEX.md
  - knowledge/tasks/wedding-v2-guest.md
  - knowledge/components/v2-contract.md
---

Guest schema mapping wizard preserving existing rows/Russian statuses; scoped hashed family invitation links/24h sessions, deadlines/revocation, atomic guest responses and guest audit identity; seating same-row assignments, canvas and keyboard/mobile alternatives, bounds/capacity/move/delete/conflicts, multi-table generation, legacy import preview, print A4/A3 + PNG. Full corresponding REQUIREMENTS and AC including plus-one placeholders and schema protection. Public guest React page can be exported from src/v2/guest/Workspace.jsx. Publication is a separate worker; follow frozen microsite data boundary and communicate specifics.

Use common module interface and only scoped files. Implement complete working module and frontend, not placeholders. Run focused tests and build parse check as feasible; root integrates final browser tests. Commit feature changes and return SHA, changed paths, exact passing checks, API hooks and concise knowledge_delta proposal. Do not edit frozen card/shared knowledge. Never spawn or load Orda/routing. Requested P4 Terra/high, runtime model not confirmed until tool response.

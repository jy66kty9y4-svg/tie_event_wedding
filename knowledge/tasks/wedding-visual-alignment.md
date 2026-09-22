---
type: task
status: complete
updated: 2026-09-09
---
# Align the real application with the reviewed visual prototype

User request: review the developer's implementation and correct it. Reference: `docs/v2/prototype.html` and its modules. Preserve actual business rules, real data, access controls and offline behavior. Test data lives in a separate temporary SQLite database started by `scripts/design-preview.mjs`.

## Ownership
- Root: integration, `src/main.jsx`, collection and table presentation, browser QA, documentation.
- Pascal (`v2_design_spec`, reused child, inherited existing route Terra/medium): shell, Mark, shared CSS, workflow.
- Franklin (`visual_event`, reused child, inherited existing route Terra/high): guest/seating modules, new TimingView.
- Anscombe (`visual_public`, reused child, inherited existing route Terra/high): public React views, publishing CSS, SSR presentation, new fallback PublicHome.

No deployment, migrations, production data writes, API or accounting changes are part of this work. Child runtime identities inherited from existing tasks; no new model override was requested. Browser checks use CUA only. Source changes and relevant server tests, build and desktop/mobile interactions are acceptance evidence.

## Verification
Accepted after root integration, correction of CSS cascade and removal of imperative DOM patches. Build passed, 78 server tests passed; 11 publishing tests repeated after final SSR work. CUA desktop/mobile route checks and save/navigation scenarios passed. Evidence: `docs/v2/APPLICATION_VISUAL_ALIGNMENT_2026-09-09.md`. Local preview: loopback port 4188; fixture metadata is ignored `test-results/design-preview.json`.

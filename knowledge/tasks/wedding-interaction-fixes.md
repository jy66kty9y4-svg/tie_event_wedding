---
type: task
status: complete
updated: 2026-09-09
---
# Local interaction fixes from browser comments

Scope: live table/zone dragging without click movement, repeatable table batches, zero seats, additional/custom shapes, inline boolean fields, task board dragging, comment composition and readiness spacing. Keep the user's existing local preview database. No production release.

Ownership: root owns seating Workspace/guest.css and interaction helpers/QA. Reused Anscombe owns guest server validation and shared geometry/tests (existing Terra/high route). Franklin owns workflow board/comments (existing Terra/high route). Pascal owns TableWorkspace/collections.css and readiness styles (existing Terra/medium route). Launches reused existing children; routes inherited, no new override. Operational notes recorded here because .codex is read-only.

Source baseline: /private/tmp/tie-interactions-baseline-20260909.tgz. Validate meaningful domain/geometry tests, build and CUA interactions on the existing local fixture. Preserve permissions/version/conflict handling.

Accepted: 85/85 full tests, 21/21 focused tests after final geometry correction, Vite build and diff check. CUA confirmed click/drag/zone/batch/zero/custom shapes, board move and skip dialog, inline checkbox persistence, comments and readiness. Desktop 1357×983, mobile 390×844, seating zoom150%. PNG generation/link verified; OS download completion and physical touch device not observed. Evidence: docs/v2/INTERACTION_FIXES_2026-09-09.md. Preview loopback4188 retains original temporary DB; no production deployment. Guest component card source claims should be refreshed using new shared geometry contract on next domain task.

Subsequent authorized deployment: completed in `wedding-parity-release.md`; the preceding paragraph records the local acceptance stage, not current deployment status.

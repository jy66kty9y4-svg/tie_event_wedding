---
type: task
tags: [task/estimate-format, component/interface, component/domain, component/runtime]
updated: 2026-10-10
last_verified: 2026-10-10
---

# Estimate formatting, 2026-10-10

User requested larger estimate text, Telegram-like selection formatting (size, bold, italic, text color), colored highlighting and thousands spaces. Previous live deployment authorization remains applicable.

Runtime delta from R4: Dockerfile, src/client.js, src/main.jsx, src/ui/CoupleBudget.jsx, src/ui/couple-budget.css, server/service.mjs; new src/budget-format.js and src/ui/BudgetCell.jsx. Existing dirty work and system-audit changes are preserved. New six-case `tests/budget-format.test.mjs` covers combined selections, edit/rebase/reset, allowlist safety, exact monetary parsing, transactional persistence, calculated-amount invariance and permission/redaction. Existing browser helper now checks font, money grouping and formatted reload; execution used CUA rather than an external browser driver.

Manual CUA on isolated fictional preview: whole/partial formatting combines, saves on Done/outside click, survives reload; clear and Cmd B/undo operate on selection. Money entry and totals show `1 250 000`, `100 000`, `25 000`, calculated `75 000`; changing computed presentation cannot edit its value. Paste displays HTML-looking input as literal text, removes line breaks and clamps notes to 500 characters. Menu and 16 px text fit at widths 390/320 without document overflow. Offline formatting and text changes queued separately, synchronized and survived reload. No customer financial data was edited.

Release evidence directory: `/tmp/tie-estimate-format-20261010-r1-release/`. Local screenshot directory: `/Users/cabinpxrn/.codex/visualizations/2026/10/10/01a1232d-67de-7ee3-85fd-6bcdda25e8bb/tie-auth/` (`tie-estimate-format-final.jpg`, `tie-estimate-format-menu-320.jpg`). Temporary viewport was reset.

Published `tie-event:estimate-format-20261010-r1`, healthy with zero restarts. All 165 Node tests and build passed. Frozen source archive SHA256 `3d36668028d3b94d937d1e801fa3b630edea9d8cc76cc5ae9e312ccdad45c06b`; image `sha256:8621875d597079bdfdba75362b832fc7e2377a868c6cde40ad37af4a4e6b3128`. Candidate isolated formatting/financial invariance/malicious payload rollback and previous onboarding/inbox scenarios passed. HTTPS read-only checks passed existing admin access, 13 weddings, two existing estimate sheets with integer amounts, CSRF/session/logout and all five byte-matching assets. No production estimates or accounts were created/edited for testing.

All 22 business-table fingerprints match before/after activation and after read-only acceptance; schema 16, integrity/foreign keys pass, 34 users and 13 projects remain. Current pending-registration count is 0; no approval was performed by release checks. Backup `/opt/tie-event/backups/before-estimate-format-20261010-r1-20261010T194420Z.sqlite`; after-verified backup `/opt/tie-event/backups/estimate-format-20261010-r1-after-verified.sqlite` (0600). Rollback image R4 and env `/opt/tie-event/backups/env-before-estimate-format-20261010-r1-20261010T194420Z`; preserve current volume. See docs/DEPLOYMENT.md for details.

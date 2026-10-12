---
type: task
tags: [task/estimate-finance, component/domain, component/interface, component/runtime]
last_verified: 2026-10-10
updated: 2026-10-10
---

# Estimate formulas and agency sync, 2026-10-10

User requested full formula validation against «Шаблон для пар.xlsx», inclusion of additional costs in organizer budget, and automatic agency fee/prepayment display. User explicitly confirmed BOTH Organization (row 29) and Coordination (30), with prepaid from those same rows. Previous publication authorization persists. No personal workbook content is copied into releases.

Read-only workbook audit resolved all shared formulas: 131 formula cells, 96 articles, seven sections. Source defects: E33 has a cached zero and no C33-D33 formula; C/D/E135 exclude row134. Site already corrected these two issues; regression now covers every original item independently, including exact cents, empty/zero/overpayment and custom rows. Source organizer total selected only122/134 in Additional; full section121 now contributes alongside whole28/51. Original workbook unchanged.

Agency projection previously used only legacy obligations/fee movements. It now reads field-authorized estimate rows29/30 by stable ID; rename safe; actual overrides plan including zero; forecast and advances independently fall back to legacy only if their corresponding cells are empty. Sheet amounts replace legacy display so a wedding fee/advance is not doubled. Existing commission projection remains. Card/top metric show fee advances and receivable. Recorded cash still follows actual ledger movements and is labeled accordingly; estimate changes do not fabricate cash movements. No schema migration or customer data rewrite.

Five intended runtime changes relative to estimate-format R1: src/couple-budget.js, src/ui/CoupleBudget.jsx, src/client.js, server/service.mjs, src/main.jsx. New tests/agency-estimate-sync.test.mjs plus expanded couple-budget tests. All170 Node tests/build passed; first sandboxed full run could not open loopback ports, then authorized local-server run passed. Existing UI helper updated and syntax-checked; browser execution used CUA. Isolated preview edits to organization120k/prepaid30k, coordination30k/prepaid10k and Additional website5k/prepaid1k proved organizer inclusion and agency150k/40k/110k. Card survived reload; mobile390 width and document scrollWidth both390; viewport reset. Screenshot `tie-estimate-agency-sync-final.jpg` (fictional preview), plus `tie-estimate-agency-sync-390.jpg` in the current visualization/tie-auth directory. Production browser session remains untouched.

Evidence directory `/tmp/tie-estimate-finance-20261010-r1-release/`, including `workbook-formulas.json` (formulas only, no source contacts).

Published `tie-event:estimate-finance-20261010-r1` with no migration; healthy, zero restarts. Source SHA256 `69e77efc034712b73110d705b2b2bf0bd9f894d4458d197254a1b9accbe185ce`; image digest `sha256:e5ae4d41a8a17c9cf2d089e70be69bb07d4626d18dd9bdfae10aaa2b7922b9b4`. Isolated candidate passed formula/additional/fee/advance/deduplication/ledger-invariance and previous onboarding/format checks. Live read-only HTTPS verified all13 agency cards against wedding source data, two existing estimate sheets, five byte-identical assets, existing admin session, CSRF and logout. Full22 business-table fingerprints match before/after activation and after acceptance; schema16, integrity/foreign keys, 34 users/13 projects preserved. Production estimates were not modified for testing.

Before backup `/opt/tie-event/backups/before-estimate-finance-20261010-r1-20261010T200457Z.sqlite`; after backup `/opt/tie-event/backups/estimate-finance-20261010-r1-after-verified.sqlite` (0600). Rollback previous image estimate-format R1 and env `/opt/tie-event/backups/env-before-estimate-finance-20261010-r1-20261010T200457Z`; preserve current volume. Source comparison to the active previous archive found exactly the five intended runtime changes. Docs/DEPLOYMENT.md records complete release details.

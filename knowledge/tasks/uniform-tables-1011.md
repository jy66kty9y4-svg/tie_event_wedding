---
type: task
tags: [task/excel-tables, task/guests, component/domain, component/interface, component/runtime]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Uniform table interaction, 2026-10-11

User clarified that creating a guest must use actual cells aligned with the headers, and that the earlier Excel-style requirements apply to every live table. Follow-up to excel-tables-1011 and guests-1011. Publication authorization persists. No agents, dependencies or schema migration.

SheetDraftRow shares SheetCell/BudgetCell with saved rows; draft data and formatting submit together. Each draft has the same number of cells as the header, never a colspan form of separate labeled fields. Blur/Enter commits the active cell before Save reads typed values; invalid cells retain the draft. Guest name is required; RSVP/seating creation values remain protected. Cancel creates no data. Guest creation can stay open for the next person. Generic/timing/guest/budget/obligation/wedding-ledger/agency-ledger use the same draft component. Financial SheetEntry joins the existing TableWorkspace, extending headers with required relationship/custody fields while open. Editing financial details uses that same row. Existing calculated values remain read-only; drafts include custom list columns.

Guests and the estimate now use the shared TableEditor with drag/arrow ordering, add/remove/hide/restore columns and raw comma-separated option drafts, including editing existing optional guest lists. Required identity and calculation/service columns are protected. Guest cells (including RSVP), typography, formatting and resize behavior match the shared spreadsheet. Guest row order also follows persisted rowOrder so the dedicated view matches the full register and export. Guest deletion and estimate deletion use site confirmation dialogs.

Server accepts typed values/formats when creating estimate rows in one outer transaction. Financial creation/edit accepts separate sheetValues and sheetVersion with live-schema validation, exact field grants and normalization, retaining custom values/styles and existing integer-kopeck, paid/due and custody constraints. Invalid amounts/options/styles, denied fields or stale schemas roll back the complete row.

Verification: 191/191 Node tests and production build. New integration coverage tests atomic estimate drafts/rollback, create-field limits, financial formatting authorization, custom list persistence on create/edit/export and stale financial schema rollback. CUA on fictional local data covers real guest cells, immediate active-cell Save, creation formatting, reload, RSVP/statistics, dimensions, existing list options entered through commas, ordinary table creation/formula, estimate creation/sums and obligation/payment rows. Actual guest download read with openpyxl retains Cyrillic, custom columns, styles/fill and stored dimensions. At390px document width390 while the guest grid scrolls within356px; viewport reset. No production QA writes, native Excel app or physical touch device.

Formatting persists on reload. Explicit user-triggered clear-formatting preserves null patches through financial draft submission; tested bold → Details → clear → Save → reload. Guest RSVP has one canonical unanswered option, defaults missing values to unanswered and saves that choice correctly.

Evidence: /tmp/tie-uniform-tables-20261011-r3-release/; screenshot /Users/cabinpxrn/.codex/visualizations/2026/10/10/01a1232d-67de-7ee3-85fd-6bcdda25e8bb/uniform-guest-row.png. Source delta against previous deployed guests release: 11 modified runtime files, two new shared UI modules. Release metadata is recorded after live acceptance in docs/DEPLOYMENT.md.

Published tie-event:uniform-tables-20261011-r3 healthy/zero restarts. Source 8e308c97836a96eaf45d31c2b97ff20a5fd4ed6b767478fccd75b8f3a4a0a4bb; image sha256:26c7821816ee5e4443d1982599711892c779795bdde7a6d492dfbfc1f142cfaa. Public HTTPS/health 200, unauthorized private API 401, www 308 and 5 exact assets. Authorized private-production QA was rejected by automatic approval review and not run; isolated scenarios/public checks substituted. Technical DB integrity/FK and 22 before/after hashes pass, schema 16/34 users/14 weddings. Before/after backups 0600, final size 9,981,952 bytes. Rollback is uniform-tables-20261011-r1 with the current data volume; details in docs/DEPLOYMENT.md.

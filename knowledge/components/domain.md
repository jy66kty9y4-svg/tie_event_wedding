---
type: component
tags: [component/domain]
last_verified: 2026-09-08
source_paths: [server/auth.mjs, server/db.mjs, server/model.mjs, server/service.mjs, tests/domain.test.mjs]
---

# Wedding domain

SQLite entities use stable IDs and versions. Every authorization grant binds action, agency/project, resource, row and changed fields together. Current database grants apply at each command, including queued offline commands. Couple access includes the full project structure. Agency resources stay separate.

Money uses integer kopecks. One movement ledger derives wedding custody, obligation payments and agency income; a fee is counted once. Independent offline payments check obligationVersion. Corrections/deletions recalculate the same ledger. Custodians must be authorized staff.

Invitations record issuer and permissions; accept rechecks authority. Public application approval creates one project transactionally. Applicants may answer a clarification/rejection through application.respond. Built-in role identities are stable keys, independent of editable labels.

Validation: feature 5c88a4e8d763d704491bf6c516b18e83030e7f57 initially passed 12 domain tests and 3 HTTP tests. Integration added empty-section visibility, current history versions, global verb checks, normalized templates, explicit movement counterparties and agency category projections. Final suite: 18 domain tests plus 3 HTTP tests. Browser integration is verified separately. See docs/API_CONTRACT.md for transport contracts.

---
type: component
tags: [v2, runtime, guest, publishing, workflow, calendar]
last_verified: 2026-09-08
---

# Runtime V2

Navigation: `docs/v2/INTEGRATION-API.md`, `docs/v2/VALIDATION-NOTES.md` and the three module API documents. Verify contracts against source/tests; this card is a handoff, not authority for new scope.

- Central command entry is `server/service.mjs` → `server/v2/index.mjs` → `executeModule`. Current authorization precedes idempotent replay. Results and conflicts are field-filtered. One-time guest tokens are stripped before command persistence.
- SQLite migrations 4–6 preserve V1 entities/audit/ledger; readonly backup-copy integration tests verify actual local V1 data and repeat-open behavior.
- V2 types cannot be mutated through generic entity bypasses. Date/time-zone changes go through reschedule preview/apply. Finance application never creates payment.
- Private app entry and anonymous wedding RSVP entry are distinct Vite bundles. Guest context uses only invitation membership and active publication display settings; no private IndexedDB client or staff-state request.
- Service worker v5 caches static app chunks and app shell for V1 offline workflows, never API or `/w/` pages. Cold restart regression matters when changing asset exclusions.
- Seating table and canvas edit the same mapped rows. Geometry uses plan proportions, bounded rotations and finite zone coordinates; printable output excludes contacts, dietary restrictions and finance.
- Notifications are durable/transactional and revalidated at delivery. No external email provider is configured.
- Local clean/demo databases remain separate. Server entry is `scripts/start.sh`; use `TIE_DB_PATH`/`PORT` for isolated QA. Dependencies belong to this project with `pnpm-lock.yaml`.

## Orda history

Worker feature commits: guest `47adb906f517976892d840d93c97f0b4a36a9aec`, publishing `ac7ace9df28b8a7271051bc080dd5f7a6f7f8f67`, workflow `e62153c2ab98f24cd3ac236014993d8c4c286982`. Root integrated and tested follow-up corrections in the working integration merge.

The guest output receipt was frozen against merge `02959ba` before the first-parent mismatch was reported. `983fa5a337c49a31d01d9dc79bb90291e905e47f` preserved all history and corrected the parent relationship, but immutable receipt finalization refuses a different integration SHA. No receipt was edited or deleted. Formal Orda acceptance is not claimed; source integration and independent product tests are recorded separately. `knowledge/ORCHESTRATION.md` explicitly says historical terminal-card metadata does not gate product tests or commit. Frozen task/index inputs remain unchanged.

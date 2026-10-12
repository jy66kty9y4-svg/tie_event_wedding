---
type: task
tags: [layer/frontend, capability/files, risk/low, status/done, task/implementation]
last_verified: 2026-10-06
updated: 2026-10-06
---

# Wedding document deletion — 6 October 2026

The user requested the ability to delete wedding attachments. `src/main.jsx` now wires Documents to the existing `entity.delete` command with project ID, file ID, current version and explicit confirmation. Each section has separate download and delete controls, a named-file confirmation and persistent server errors. `src/styles.css` keeps long names and actions inside mobile widths. The combined files/delete grant uses the file row and a null field scope, matching backend authorization. Offline deletion is disabled. Files included in immutable approval revisions remain protected.

Evidence: 132 Node tests, production build, expanded `scripts/ui-test.mjs` covering upload/cancel/delete in all three sections, tab counts, persistence after reload, deleted-download 404, reader permissions, published-approval conflict and 390 px width. An isolated Docker smoke checked health, private API authorization and built assets.

Authenticated live browser acceptance confirmed an existing document's delete control and dialog, cancellation without a version change, and 390/320 px layout with no horizontal overflow or page errors. No production documents were deleted for verification.

Production source hashes matched HEAD before the change. `tie-event:document-delete-20261006-r1` is active at `https://tie-event.ru`, healthy with zero restarts. Backup `/opt/tie-event/backups/before-document-delete-20261006-r1-20261006T152928Z.sqlite` has mode 0600. All 29 non-operational table fingerprints matched before/after activation. Rollback uses `tie-event:session-dedupe-20261002-r1` and the existing data volume. Release source archive and digest are recorded in `docs/DEPLOYMENT.md`.

Existing unrelated limitation observed during verification: HTTP downloads with Cyrillic file names can return 500 from the raw Content-Disposition header in `server/http.mjs`. This change leaves that handler untouched; Cyrillic-named files were successfully uploaded and deleted in the browser checks.

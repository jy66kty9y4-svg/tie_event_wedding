---
type: task
tags: [domain/wedding, layer/release, capability/quality, risk/high, status/in-progress, task/release]
last_verified: 2026-09-13
---

# UX fixes release preparation — 13 September 2026

Scope: package the frozen UX-fix working tree, build and validate an isolated Docker candidate, then release only after root confirms the release gate. Production code, server source, tests, live SQLite, volumes, Caddy and unrelated services are out of scope for this release worker.

R1 was superseded after A09 browser regression found scroll restoration `1989 -> 272`; do not stage, upload, or deploy its archive. R2 was deployed successfully and is the image-only rollback target for the current R3 release.

## R3 completion

R3 is active as `tie-event:ux-20260913-r3`, healthy with zero restarts. Its immutable archive is `release/tie-event-ux-20260913-r3-source.tar.gz`, 339,385 bytes, SHA-256 `8c0d13b3b00f3ae55a5226e8df9fb5ca0b61c2cda22b4c01a1903e4d3b7f459f`; 77 allowlisted entries contain 49 regular `src/`/`server/` files verified against source-freeze R3. The only application changes from R2 are `src/v2/guest/Workspace.jsx` and `src/v2/guest/readable.mjs`.

R3 staging passed in an isolated container. Activation retained `tie-event:ux-20260913-r2` and an `.env` rollback copy, created and quick-checked `/opt/tie-event/backups/before-ux-20260913-r3-20260913T203222Z.sqlite`, and matched 21 business-table fingerprints before/after excluding only `attempts`, `guest_sessions`, `notification_outbox`, and `sessions`. Container/HTTPS/neighbors returned `200/401`, `200`, and `200/200/307/401/200`; Caddy and `tie-event-data` were unchanged. Final authenticated browser acceptance confirms the unseated guest filter and mobile layout, with no console errors. Evidence is `release/r3-preflight.json`, `stage-r3.stdout.txt`, `activation-r3.stdout.txt`, and `live-browser-r3.json`.

The frozen archive helper is preserved as historical input. The local future-release helper uses the proven `docker exec` stdin/stdout streaming path for backup and fingerprints, creates host evidence at `0600`, and accepts `EXPECTED_ACTIVE` as an environment override. It does not rewrite R2/R3 archives.

Prepared R2 inputs:

- `test-results/ux-fixes-2026-09-13/release/tie-event-ux-20260913-r2-source.tar.gz` is the exact frozen archive. SHA-256 is `89766a7f53023414174943d4cffcfef3ba8b811b8ea5923cb9d10ac2df03c882`; it is 339,275 bytes and its allowlisted manifest has 76 entries, including 48 regular `src/`/`server/` files verified byte-for-byte against disk.
- `deploy/ux-release-20260913-r1.sh` validates R2 when invoked with `RELEASE_ID=ux-20260913-r2 TAG=tie-event:ux-20260913-r2` and performs local isolated smoke when Docker is available.
- `deploy/ux-release-20260913-r1-remote.sh` stages only `tie-event:ux-20260913-r2` with the same variables, then gates activation on `RELEASE_GATE=passed`.
- `deploy/ux-release-20260913-r1-db-fingerprint.mjs` compares business tables by row counts and hashes, excluding only `sessions`, `attempts`, `guest_sessions`, and `notification_outbox`.

Read-only production evidence confirmed the current service is `tie-event:font-20260911-r3`, healthy with zero restarts. Compose and Caddy hashes match the established release baseline, and the listed server module hashes match `production-before.txt`.

The user explicitly authorized transfer and deployment. The 339,275-byte archive reached `ptitsa-plus:/opt/tie-event/releases/tie-event-ux-20260913-r2-source.tar.gz` with matching SHA-256. Candidate `tie-event:ux-20260913-r2` was built and isolated smoke passed: health 200, private API 401, four emitted JS/CSS assets 200, Sharp and server import. Image ID is `sha256:9a480234788a304f32a02e918fe2bed4bfaddaa09f559de53c939fa09668b068`.

After root release gate, only `tie-event` was recreated on `tie-event:ux-20260913-r2`; it is healthy with zero restarts. A consistent SQLite backup and quick_check passed, and 21 business-table fingerprints matched before/after with only `attempts`, `guest_sessions`, `notification_outbox`, and `sessions` excluded. HTTPS and neighbor statuses were `200/200/307/401/200`; Caddy and `tie-event-data` remained unchanged. Rollback retains current SQLite and uses `tie-event:font-20260911-r3` plus `/opt/tie-event/backups/env-before-ux-20260913-r2-20260913T202047Z`. Root owns the final authenticated browser smoke.

Release acceptance after authorization: archive remote SHA matches; candidate build and isolated smoke pass; `ux_regression` reports final browser/unit acceptance; root sends `release gate passed`; then create consistent SQLite backup, compare fingerprints before/after, change only TIE_IMAGE, and retain rollback image and `.env` copy. Do not restore an old database during rollback.

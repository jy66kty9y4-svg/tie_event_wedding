---
type: task
tags:
  - task/seating
  - task/release
  - component/frontend
status: completed
last_verified: 2026-10-01
updated: 2026-10-01
---

# Seating snake hotfix, 2026-10-01

## Outcome

Switching an existing table to `snakeQuarter` no longer crashes the seating workspace. The client applies the complete preset (2.4 × 2.4 m and a cloned quarter-circle contour), recognizes saved snake tables as that preset, and falls back to the canonical contour when rendering incomplete legacy or transient data.

## Verification

- `node --test tests/v2-seating-interaction.test.mjs tests/v2-guest.test.mjs`: 27/27 passed.
- `pnpm test`: 132/132 passed.
- `pnpm build`: passed.
- Focused browser test changed a round table to the snake preset, verified dimensions and polygon rendering, saved it, reloaded, and verified the persisted preset.
- Candidate image passed isolated health, private API, asset, Sharp, and server-import smoke checks.
- Authenticated live verification passed on desktop and mobile routes without creating business data.

## Production

- Active image: `tie-event:seating-snake-hotfix-20261001-r1`.
- Source archive SHA-256: `d56fe1405abf5cc121269add3b53fcca166a4a95af09dc3038e5e848d86e2b02`.
- Image digest: `sha256:2b117e91dee728ea357f51bd2c5075cb82b754c00a8acf77d6b27a612a56f045`.
- Pre-activation backup: `/opt/tie-event/backups/before-seating-snake-hotfix-20261001-r1-20261001T100111Z.sqlite`.
- All 22 business-table fingerprints matched before and after activation; container is healthy with zero restarts.
- Rollback image: `tie-event:calendar-cell-click-20261001-r1`.

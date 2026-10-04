---
type: task
tags: [domain/wedding, layer/frontend, layer/backend, layer/release, capability/calendar, risk/medium, status/done, task/implementation]
last_verified: 2026-10-01
updated: 2026-10-01
---

# Calendar controls and completed-wedding search hotfix — 1 October 2026

`tie-event:calendar-cell-click-20261001-r1` is active on `https://tie-event.ru`, healthy with zero restarts.

Calendar navigation is now one responsive control tray: circular period arrows, a separate Today action, an accessible segmented Month / Week / Agenda switch, a styled project selector and an adaptive meeting button. Browser acceptance covers 1440, 390 and 320 px, all three view switches and horizontal-overflow checks.

The entire free area of every calendar cell opens that day. The date number is presentational, while a full-cell background button provides mouse and keyboard interaction; event buttons remain above it and keep their own actions. Local and authenticated production checks clicked the lower blank area of a cell on desktop and mobile and opened the same cell with Enter.

The release also retains the preceding `wedding-search-hotfix-20261001-r1`: an explicitly requested completed or archived project remains eligible for dashboard calculation, while those projects stay excluded from agency active totals. The client guards a missing project report instead of dereferencing `undefined`. A focused production browser check opened an existing completed wedding through global search without a page error.

Evidence: 132 Node tests for the base release, a repeated 9-test calendar suite, production build, local browser screenshots and authenticated live browser checks. Twenty-two business-table fingerprints matched before and after activation. The SQLite backup is `/opt/tie-event/backups/before-calendar-cell-click-20261001-r1-20261001T090748Z.sqlite`; rollback image is `tie-event:calendar-controls-20261001-r1` and must reuse the current data volume.

Archive SHA-256: `2fa9bdab8326216cb5bb007d19ed0647a8f9b7794e265bdf244c9a84353233c0`. Image digest: `sha256:b7009f2151335d9c8189f093d1d86af071a0445a388386c18f081b35adf61f7b`.

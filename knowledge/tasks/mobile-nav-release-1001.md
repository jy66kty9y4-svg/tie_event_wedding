---
type: task
tags: [domain/wedding, layer/frontend, layer/release, capability/navigation, risk/medium, status/done, task/implementation]
last_verified: 2026-10-01
updated: 2026-10-01
---

# Mobile navigation release — 1 October 2026

`tie-event:mobile-nav-20261001-r1` is active on `https://tie-event.ru`, healthy with zero restarts.

On organizer mobile screens the persistent bottom dock contains, from left to right, Tasks, Weddings, Calendar and Agency finances. Labels remain available to assistive technology but are visually hidden. The former hamburger drawer is replaced by an avatar-triggered account menu containing the remaining navigation, profile, notifications and sign-out. The menu traps focus, closes with Escape or the backdrop, and returns focus to the avatar. Couple and contractor project navigation remains permission-aware.

The same release removes the visible “Требует внимания” and “Проверка перед свадьбой” surfaces and their snooze controls while retaining ordinary metrics, overdue-task counts and calendar access.

Evidence: 131 Node tests, production build, workspace-switch browser acceptance, isolated Docker smoke, and authenticated live browser acceptance at 1440, 390 and 320 pixels. The live 390 px check asserts the exact four-item dock order and opens the avatar menu. Twenty-two business-table fingerprints matched before and after activation. The SQLite backup is `/opt/tie-event/backups/before-mobile-nav-20261001-r1-20261001T080207Z.sqlite`; rollback image is `tie-event:calendar-all-day-20260930-r1` and must reuse the current data volume.

Archive SHA-256: `b19c86976b45f09febcc5989b4b1797959d2c365e2d6040fe8277b5b3cc5a42d`. Image digest: `sha256:2781dbf4c688ced1286f6fab0d8c2093184bae3f778d29ec7f676f5d94c85241`.

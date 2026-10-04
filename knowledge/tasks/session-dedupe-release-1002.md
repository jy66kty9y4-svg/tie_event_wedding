---
type: task
tags: [layer/backend, layer/release, capability/auth, risk/medium, status/done, task/implementation]
last_verified: 2026-10-02
updated: 2026-10-02
---

# Same-device session replacement release — 2 October 2026

Successful account login now revokes and removes an older active session only when user ID, client IP and User-Agent all match. A different browser or device keeps its own parallel session. Registry rows remain as revoked audit history, so no production history was destructively deleted.

`tie-event:session-dedupe-20261002-r1` is active on `https://tie-event.ru`, healthy with zero restarts. Before activation, the production registry contained 103 historical rows (98 revoked and 75 expired, with overlap) and no active sessions. A consistent SQLite backup is `/opt/tie-event/backups/before-session-dedupe-20261002-r1-20261002T201034Z.sqlite`; 22 business-table fingerprints matched before and after activation. Rollback image is `tie-event:seating-snake-hotfix-20261001-r1` and must retain the current data volume.

Evidence: 132 Node tests, production Vite build, isolated container smoke, HTTPS 200, private API 401 and post-switch health checks.

---
type: task
status: complete
updated: 2026-09-09
---
# Preserve functionality and publish the visual release

Authorization: user explicitly requested to fill omissions relative to this repository and deploy to its server. Root completed this release without delegation.

Parity review against fbfbef9 covered navigation, workflow, configurable tables, finance, files/history, participants/permissions, guests/seating, publishing and offline entry. Restored project search across all project data while keeping the status filter. Added shared seating geometry to the final Docker stage and a server-import build gate.

Live acceptance found a pre-existing timing selector bug: an earlier guest table matched the name fallback before the keyed timing table. Added findProjectTable with explicit-key priority and timing-pair/team regression tests; deployed the correction in r2.

Released tie-event:interactions-20260909-r2 to the existing /opt/tie-event compose project and tie-event-data volume. Archive contains app source/assets only. Test fixture DB and access files were excluded. Details and rollback: docs/DEPLOYMENT.md.

Validation: 87/87 Node tests, production Vite build, diff check; isolated Docker health/API authorization/all five bundled resources/Sharp. HTTPS/TLS and actual authenticated browser navigation passed. Correct timing columns verified live for both audiences. Restored full-data search and status filtering verified live. Desktop and 390px mobile checked; 21 table checksums unchanged from before the first switch through r2, existing 20 entities retained; Caddy checksum unchanged; neighbor response codes preserved. No production test records created.

Limits: external email delivery remains unconfigured as before; actual OS PNG saving and physical touch hardware were not observed. Dragging/inline editing and filled states were verified in the separate local fixture, not by altering live customer records. Cold offline restart not rerun for this release; offline client and service worker are unchanged.

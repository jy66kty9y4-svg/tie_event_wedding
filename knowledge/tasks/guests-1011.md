---
type: task
tags: [task/guests, component/domain, component/interface, component/runtime]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Guests and optional personal invitations, 2026-10-11

User requests invitations hidden by default, administrator ON/OFF, couple feature only after enablement, in-table guest add/edit/delete and a statistic counting people with dietary restrictions. Prior publication authorization persists. No dependencies or schema migration.

Per-wedding `project.data.personalInvitationsEnabled` must be exactly true; new projects store false, old missing flags remain off without database backfill. `guestInvitations.settings` requires global agency settings capability and project edit access for that field, validates boolean and optimistic project version, writes an audit entry and invalidates guest sessions on disable. Generic project edits/restoration cannot alter the protected field. Private invitation create/rotate/revoke/list and public exchange/context/respond enforce the flag. Disabling pauses tokens without deleting invites; still-valid tokens can be exchanged again after re-enable. Wedding-page publication, manual RSVP and seating remain available.

Snapshot exposes `canManageGuestInvitations`; `guestInvites` is absent while off. Reusable admin switch is available in wedding settings and guest registry. Couples have no switch; invite section, recipient selection and mapping prompt require enablement and previous permissions. Guest in-cell editing and inline new row from the Excel task are retained. Delete is now a website ConfirmDialog with error feedback, soft deletion and existing atomic seat cleanup/history restoration.

`countGuestsWithFoodRestrictions` reads mapped allergies/diet fields and counts each live authorized row once. Blank/explicit negative answers are ignored, multiple comma-separated restrictions do not multiply the people count. Hidden fields do not contribute. Metric remains independent of search/RSVP filters.

Validation: 187 Node tests passed; production build and whitespace check of the delta against the previous release (pre-existing dirty-tree whitespace remains unchanged). Tests cover default/missing false, administrator/couple gates, protected generic writes, isolated wedding defaults, invalid/stale writes, disable/session invalidation/token pause/re-enable, people count/negative/read-restricted values, deletion/seat cleanup/restoration. Existing invitation fixtures explicitly enable the feature before their scenarios. Isolated built candidate additionally passes real default-couple onboarding, feature visibility/permissions, published invite exchange/pause, guest edit/delete/restore, and preceding registration, budget, agency and XLSX scenarios.

Manual CUA on existing fictional local preview: allergy edit (two types, count one), negative guest add (people increase, restricted count unchanged), inline creation, website delete confirmation/cancel/save and immediate counts, admin setting in wedding settings and registry, invitation show/hide, reload persistence and 390px layout (document width390). Browser native confirmation initially stalled; deletion now uses website modal. Original user tab was recovered/reloaded; temporary tab closed; viewport override reset. Screenshot: /Users/cabinpxrn/.codex/visualizations/2026/10/10/01a1232d-67de-7ee3-85fd-6bcdda25e8bb/guests-settings-statistics.png.

Release evidence: /tmp/tie-guests-20261011-r1-release/. Source SHA256 8f56647a2da5d6f876e10dfbfe7923cc3959d5e49054d164fe6283db2205391c. Runtime diff from Excel r2: seven changed source files and one new GuestInvitationSettings component. See docs/DEPLOYMENT.md for publication and backup verification.

Published healthy/zero restarts as tie-event:guests-20261011-r1 (image sha256:f0e4fb08e3dc3c1b153a852ded9cc25fd46d32d6fef66c07e1a3ef628f3b40e8). Live checks: all13 wedding defaults off/admin capability/disabled invitation GET403, existing authentication and CSRF, 28 downloads, 13 financial cards and five byte-matching assets. All22 business-table fingerprints unchanged; schema16/integrity/FK/34 users/13 projects retained. Before backup /opt/tie-event/backups/before-guests-20261011-r1-20261010T212905Z.sqlite; verified after backup /opt/tie-event/backups/guests-20261011-r1-after-verified.sqlite (0600,9814016bytes). Rollback Excel r2 plus env-before-guests-20261011-r1-20261010T212905Z, keep current data volume.

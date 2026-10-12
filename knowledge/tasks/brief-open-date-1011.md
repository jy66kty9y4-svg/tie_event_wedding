---
type: task
tags: [component/domain, component/interface, component/runtime]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Optional/open wedding date in the brief

User requested a wedding date that can remain unknown and be specified later. Shared
WeddingDateField defaults to «Дата пока не определена» for an empty date, exposes an
optional exact-date input and restores an in-session exact date when toggling back.
It is used in the questionnaire, applications/clarifications, new weddings and the
existing reschedule editor. Account questionnaires expose the agreed date read-only;
an open assigned wedding accepts the first date or remains open. The submitted date
appears in administrator answers. Registration still requires both phone and email.

Project/application validation stores an omitted/empty date as ''. Seeded/edited/template
relative tasks retain their rules with no dueDate until date selection. First-date selection
and reopening use the existing preview/apply mechanism, preserving fixed/range/none/done
records. Anchored meetings prevent clearing the wedding date until they are detached.
No migration/backfill or default fabricated date is used. Dates set before this change
remain untouched. Account completion/date assignment uses current projectVersion, only
permits the first date, and runs the reschedule engine within the same transaction after
unlocking the approved grant; revoked field permissions roll back completion. Existing
clients without the new date parameter remain compatible. External sync receives the
existing queue trigger on account.questionnaire.

Local CUA on a dedicated fictional SQLite environment verifies open-date draft/reload,
submission of all33 answers without a date and successful workspace access, later date
assignment in organizer settings/reload, reopening date, first exact date in the brief,
agreed-date read-only preservation, and mobile390 with16px date input/no horizontal
overflow. Native date input needed onInput plus onChange for immediate state updates;
empty reschedule query parameters must be preserved. The normal viewport was restored.
Console errors0. Evidence: brief-open-date.png, brief-date-mobile.png in local visualizations;
/tmp/tie-open-date-preview and /tmp/tie-brief-open-date-20261011-r1-release.

Seven new domain tests cover optional brief approval, relative tasks/templates, selecting
and clearing dates without disturbing fixed/completed records, account completion/open
or first date, stale/invalid/agreed date protection, anchored meetings and revoked-grant
rollback. Final full test suite passes 219/219; production build passes. Frozen candidate
passes locally and in the networkless Docker image, including former release regressions.

Frozen archive SHA2563c8f9c22ee6b4c1da9e644809b428fe26e572c3bf2f23a393ec052a866c816eb.
Relative to seating-names-20261011-r1, nine runtime files modified and two shared UI files
added; no dependency, Docker, worker, cache or schema change.

Published brief-open-date-20261011-r1 after the user's exact archive/server/publication
approval. Image SHA256 d3b70079f16bc4aef1ba1d9e2c0c0e2bbbbf5ee71d6c0521daf8d0d9899c869f.
Healthy with zero restarts; all 22 business fingerprints match before/after activation and
final acceptance. Integrity/FK pass, schema16, 34 accounts/14 weddings. Before backup stamp
20261011T001956Z; final consistent backup10,137,600 bytes, mode0600. Five public assets
byte-match the verified build; HTTPS/health200, private API/photo401, www308. User's existing
tab reloads app-Cu_HNmAs.js without console errors. No test writes to production client
records. Rollback uses seating-names-20261011-r1 with the current data volume; details and
backup paths are in docs/DEPLOYMENT.md. Initial source upload was rejected by automatic
review for lacking approval of this specific payload; exact user approval resolved it.

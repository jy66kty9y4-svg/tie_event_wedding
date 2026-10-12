---
type: task
tags: [component/interface, component/runtime, task/excel-tables]
last_verified: 2026-10-11
updated: 2026-10-11
---

# Wedding card navigation, 2026-10-11

User requested editable wedding tables and exactly this main navigation: Estimate, Venue, Timing, Vendors, Documents, Guests, Seating, Plan, Calendar, More. Existing shared table editing, dimensions, formatting, row/column operations and export remain in place. Calculated financial totals and permission boundaries stay enforced. No backend, dependency or migration changes.

`project-navigation.mjs` supplies one ordered definition to wedding tabs and the couple sidebar, with scoped read filtering and a reduced contractor view. The couple mobile dock offers Estimate, Plan, Calendar, More. Payouts highlight Estimate; team timing highlights Timing; approval/detail tools highlight More. Calendar is removed from More; Approvals enters More for users with access. The agency Today dashboard remains available separately.

Overview is removed from all wedding navigation. Opening a card, login, project picker and workspace switches select the first available main section (normally Estimate). Existing overview links and browser-history entries normalize to that section with the URL replaced; restricted roles never gain access through the fallback.

Venue uses `/app/projects/:id/venue`, including selection-source links. It reuses existing selection records by category ID or legacy category name, keeps couple selection and verification, and defaults new proposals to the existing Venue category (or the normal create-category form). It does not copy vendor data or create monetary movements through navigation. Vendor cards retain the complete category view.

Verification: 194/194 Node tests, production build, frozen archive equals workspace, isolated candidate without network/live volume passed onboarding, notifications, estimates, financial sync, tables/OOXML, guest gates and atomic drafts. New tests cover navigation/secondary-route grouping, restricted-role landing and venue-category resolution. Browser helper route expectations were updated; they were not run through shell browser automation.

Manual CUA used fictional local data: organizer and couple-view navigation, old overview URL → Estimate, Venue creation with category preselected, More → Approvals, main Calendar, shared timing draft/save/in-cell edit/reload. Existing guest and estimate cells remain editable. At 390 px the document is 390 px wide; the couple dock opens the wedding calendar. Viewport reset. Screenshot: `/Users/cabinpxrn/.codex/visualizations/2026/10/10/01a1232d-67de-7ee3-85fd-6bcdda25e8bb/wedding-navigation.png`. No production customer records were used for QA writes.

Release `wedding-card-20261011-r1`: source SHA256 `476d04c665cb15d44219f1d71801805239020716c2d8c0bf9862c23c44f44c06`, image `sha256:619581d5aec9234749d1dbf134b8a576c31362988e6bfecb644bfa47143cbc82`. Runtime delta versus uniform-tables r3: five modified frontend files and one new navigation module. Activation/public verification and rollback evidence are recorded in `docs/DEPLOYMENT.md`.

Published on tie-event.ru, healthy/0 restarts. Public HTTPS/health 200, unauthorized API 401, www 308 and all five matching assets. Technical DB integrity/FK, schema 16/34 accounts/14 weddings and all 22 business fingerprints preserved. Backups before activation at 20261010T222249Z and after verification have mode 0600; final size 10,022,912 bytes. Rollback is uniform-tables-20261011-r3 with the current SQLite volume. Original local organizer mode restored; production user tabs were not altered for QA.

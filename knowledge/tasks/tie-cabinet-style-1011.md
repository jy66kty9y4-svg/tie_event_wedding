---
type: task
status: complete
updated: 2026-10-11
---
# TIE cabinet brand styling

## Latest publication: tie-review-20261011-r1

Published on https://tie-event.ru/ at the user's explicit request to deploy the latest changes. Both the wide-screen and couple-space follow-ups below are now live. Fresh 95-module build, 226 Node tests, isolated candidate and 25 byte-matching public resources pass. Source `ac03ae96ba79bad46c79b2e1f80533adea3bbe469403c811dfe44f6190a38294`; image `88ef6adeb087b56879f92749958d7c9534e14cb845f59b3c6ed41cc71a5c6bb8`; running/healthy/0 restarts. Runtime delta is 13 UI files, with server/schema/dependencies/public assets unchanged from tie-brand-r1.

Existing live couple session verifies estimate controls/no intro, no duplicate wedding navigation/picker/settings/sidebar notifications, ten retained sections through profile entry/reload/history, venue title, labeled timing mapping fields, grid on/off, ruler disclosure, separate edit-tools row and full-width calendar. No console errors or document overflow in checked views; live measured width1925, prior fictional local CUA supplies320–2560/organizer/contractor coverage. No business records edited; exports/cold offline not retested. All22 business fingerprints match before activation and after live acceptance; integrity/FK pass, schema16/34 accounts/14 weddings. Before stamp20261011T150715Z, final backup `tie-review-20261011-r1-after-browser.sqlite` mode0600/11,079,680bytes. Compose/Caddy/volume unchanged. Rollback tie-brand-r1/current volume; never overwrite new user actions from an older backup. Evidence `/private/tmp/tie-review-20261011-r1-release/` and `docs/DEPLOYMENT.md`; live screenshots `TIE_Live_Couple_Profile_Release.jpg`, `TIE_Live_Review_Seating.jpg`.

## Wide-screen review after publication — local follow-up

User supplied 2560×1440 comments and authorized applying the same layout rules to the other cabinet screens. This follow-up was first verified locally, then published in `tie-review-20261011-r1` as recorded above.

`AppShell` centers the bounded 1440px workspace for Today, Applications, Tasks, Settings and other form/detail screens. Weddings, calendar, agency finance, catalogs and wedding tables use the available workspace width; card grids fill it with normal-sized cards. Header actions follow their content. Agency task creation now lives inside the task header instead of an absolute button attached to the window edge.

Weddings sort by date after the existing date-tab/search/status filters: ascending in Current, descending in Completed; undated weddings come last and equal-date order is stable. The helper copies the array. Date/time-zone tab classification is unchanged.

Calendar rows adapt to viewport height and account for wedding navigation. On mobile, weekdays and date cells share one horizontal scroll container. Verified keyboard focus scrolls the container while both stay aligned.

Vite build (95 modules) and 12 focused tests pass, including two added date-order tests. Local fictional CUA checks cover 2560/1440/1002/390/320 widths, rail/expanded center positions, Today/Applications/Tasks board/Settings/Finance/Weddings, estimate and agency/project calendars. Task-create chooser opens and cancels. No page horizontal overflow or console errors in checked views; no business records changed. Before-state: `/private/tmp/tie-wide-layout-20261011/before/`; geometry: `browser-geometry.json` beside it. Screenshots `TIE_Wide_Today.jpg`, `TIE_Wide_Tasks.jpg`, `TIE_Wide_Calendar.jpg` and `TIE_Responsive_Calendar_390.jpg` in the session visualization folder.

User authorized implementation after supplying local font folders. Scope: working cabinet, authentication and onboarding; Frame 80 is a supplemental usage reference, not a target layout. The brandbook, official logos and elements supply the visual direction. Existing uncommitted functionality work is preserved.

## Implementation

- `src/ui/tie-theme.css`: document-scoped tokens, local Evolventa/Ardeco, graphite navigation, shared controls, readable data and responsive dashboard. The `tie-workspace` class includes body portal components.
- `src/ui/Mark.jsx`, AppShell/AuthPage/waiting/questionnaire: official artwork replaces approximate rings and manually drawn lettering.
- Private component CSS uses the shared TIE palette. Saved cell formatting remains inline and authoritative; finance table titles wrap without crossing the amount columns.
- Seating SVG/export and contour preview use neutral brand colors; geometry and guest labels are unchanged.
- `public/brand/tie`: official PNG outputs, local WOFF faces, copyright/license documents and provenance. Betmo binary excluded because its supplied document says Personal Use; supplied signature artwork is used instead.
- PWA icons/manifest and `tie-shell-v6` precache include brand resources; `server/http.mjs` adds WOFF MIME only.
- Public publishing and RSVP rules remain separate and keep their previous declarations.

## Verification and handoff

Final Vite build passed (91 modules); 219/219 Node tests passed. CUA checked organizer/couple/contractor, auth/onboarding, table amount persistence/calculation and bold formatting after reload, neutral PNG export, mobile menu/calendar/modal and 320/390/808/1440 px layouts. Final console error list is empty. HTTP WOFF returns 200 with `font/woff`. Cold offline browser restart and live release were not performed.

Report: `docs/v2/TIE_CABINET_STYLE_IMPLEMENTATION_2026-10-11.md`. Local preview on loopback 6188 uses an isolated temporary DB; metadata is ignored `test-results/tie-design-preview.json`. Before-state backup: `/private/tmp/tie-cabinet-design-20261011/before/`. There is no production deployment or production data mutation in this task.

## User review follow-up

Implemented 13 browser comments and the subsequent smaller borderless sidebar toggle below the logo. `src/ui/cabinet-review.css` contains the focused refinements. AppShell owns the notification panel and persisted, bounded sidebar width; task filters now live behind the descending-lines icon. `NotificationPopover.jsx` keeps existing notification commands and pagination; `usePopover.js` handles dismissal/focus and available panel height. Legacy notification URLs open the panel over the normal workspace. Internal event navigation retains URL query parameters so specific registrations/timing rows are opened correctly. Wedding header copy, create button, date hint and checkbox were simplified.

Review build: 95 modules. Final test run: 222/222 pass, including three sidebar-boundary tests. CUA checked desktop drag/keyboard limits and 1440/768/390/375 px views, query-preserving notification navigation, unread filtering and mobile menu entry, task search/reset, date toggling and removed application borders. Report: `docs/v2/TIE_CABINET_REVIEW_2026-10-11.md`. Review before-state snapshot: `/private/tmp/tie-cabinet-review-20261011/before/`.

Subsequent four visual comments: the wedding-status select has a custom chevron inset 12px with native select behavior retained; the line above wedding filters is removed; Settings uses a gear outline. Build passed and CUA verified borders, select behavior and mobile390 without overflow. Changes are limited to `cabinet-review.css` and icon paths in `Mark.jsx`; backup: `/private/tmp/tie-cabinet-review2-20261011/`.

The initial arrow correction used a 32px logo row plus a flexible remaining row, moving the arrow center to y81.5; this was superseded by the user's explicit spacing clarification below. Before-state CSS: `/private/tmp/tie-sidebar-arrow-correction-20261011.css`.

Sidebar layout clarification: organizer group labels Work/Management removed from JSX; desktop header/navigation/group padding consolidated to one spacing variable. Header height is content-driven (logo plus 28px toggle row), with equal spacing above/below that row. Initial 2px version verified rail/expanded centering and expand/collapse but was rejected by the user as too tight. Initial before-state: `/private/tmp/tie-sidebar-spacing-20261011/`.

The user also found 8px spacing too tight. Current spacing is 16px via `--sidebar-control-gap`. Build passed; refreshed the selected user tab3 on Today and verified all measured button/group/header gaps at16px, arrow midpoint48/108→78, absent group names and no horizontal overflow. Screenshot: `TIE_Sidebar_16px_Today.jpg`. Before-state CSS: `/private/tmp/tie-sidebar-spacing-16px-before-20261011.css`.

## Production release

User explicitly requested publication. `tie-event:tie-brand-20261011-r1` is live on https://tie-event.ru/, running/healthy/0 restarts. Source `/opt/tie-event/releases/tie-brand-20261011-r1`; archive SHA256 `be62d78cbf2e118065a9f8624dede20673f968ddceba68f17dff5804afea8ea9`,134 files. Image `sha256:2661ce69102229e85acd864354ccd239259365d779dede50137d66ff2ece594f`. Runtime source compared against the previous frozen brief-open-date-r1: styling/UI/assets changes; server delta only WOFF MIME; dependencies/schema/Docker unchanged.

Fresh222/222 tests,95-module build, isolated networkless candidate and25 byte-matching public resources pass (5 bundles/17 brand/icon/manifest/worker). HTTP health200/privateAPI401/privatePhoto401/www308/WOFF MIME pass. Existing live couple browser session checked calendar, font families, popup, rail/expanded centering and16px gap with no horizontal overflow or console errors. No working records edited; organizer/mobile checks remain the prior local fictional acceptance. Live screenshots `TIE_Live_Brand_Release.jpg` and `TIE_Live_Notifications.jpg` in the session visualization folder.

Before backup `/opt/tie-event/backups/before-tie-brand-20261011-r1-20261011T120144Z.sqlite`; final backup `/opt/tie-event/backups/tie-brand-20261011-r1-after-verified.sqlite`, mode0600/10,137,600 bytes.22 business-table fingerprints match at activation and after acceptance; integrity/FK pass, schema16,34 accounts/14 weddings. Compose/Caddy/volume unchanged. Rollback previous image `tie-event:brief-open-date-20261011-r1` with current volume; env backup `/opt/tie-event/backups/env-before-tie-brand-20261011-r1-20261011T120144Z`. Preserve new user actions; do not overwrite live DB from old backup. Evidence `/private/tmp/tie-brand-20261011-r1-release/`; deployment details in `docs/DEPLOYMENT.md`.


## Local couple-space review follow-up

Latest 13 browser comments plus profile-menu correction are implemented locally. Couple space hides duplicate wedding tabs, picker, settings, sidebar notifications and the divider above its navigation; section icons follow the shared organizer system, including mobile quick navigation. Profile entry/reload/history preserve an accessible assigned wedding and its controls; organizer profiles remain global. Current project can supply the personal calendar integration context.

Budget group actions use natural-width add and a dedicated trash icon; intro removed. Venue header only shows its title. Timing mapping uses FormField with responsive two/one-column layout. Seating grid survives surface styling, edit tools occupy a second row and a ruler button opens plan parameters. No domain/schema/permission changes.

Final 95-module build and 35 focused tests pass. Fictional CUA verifies actual couple profile click/reload/back/forward, ten retained sections, organizer global calendar choices, contractor picker/tabs, budget buttons, timing fields, ruler disclosure/grid on-off, 2560/1440/1280/390/320 widths and no observed document overflow or console errors. No business records edited; exports/offline startup were not retested. Evidence: `docs/v2/TIE_CABINET_REVIEW_2026-10-11.md`, `/private/tmp/tie-couple-review-20261011/` and `TIE_Couple_*` screenshots. These and the prior wide-screen changes were subsequently published in `tie-review-20261011-r1` as recorded above.

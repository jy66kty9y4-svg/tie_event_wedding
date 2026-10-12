---
type: task
status: done
tags: [domain/vendors, layer/frontend, layer/backend, capability/venues, risk/medium, task/implementation]
last_verified: 2026-10-12
updated: 2026-10-12
---

# Venue cards, galleries and comparison

User approved the second image mockup (large rounded cards, inset carousel, smaller prices on the left and View button on the right), then the seven-step implementation plan with «делай». Implementation and publication are complete. User separately authorized this exact venue release with «Да, опубликовать»; it is live on tie-event.ru with consistent backups and preserved business data.

## Behavior and sources

- `src/ui/VenueWorkspace.jsx` and `venue.css`: photo-led cards, swipe/arrows/dots, full detail, named map/site links, retained couple choice and independent comparison. Two comparison columns fit mobile; three or more scroll horizontally, including when dragging over photos. Comparison preferences contain only record IDs and are scoped to agency, user and wedding in localStorage. They are independent of `selected` and financial obligations.
- `src/ui/VenueForm.jsx`: up to16 ordered photos, first is cover, structured conditions, daily/range tariffs, per-wedding override, menu, deposit meaning/terms, mandatory/optional fixed/per-guest charges, service percentage/basis, accommodation, included items and up to30,000 characters of details. Link to a venue site/page is required on save. General VendorForm switches to this form when its category becomes Venue, preserving entered fields and staged photo source. Updates from the catalog are explicit; agreed budget price and project notes are preserved.
- `src/venue-profile.js`: validated minor-unit money, bounded photo IDs/fields, open-date min/max, exact UTC weekday rate, missing prices as unknown, manual ranges/override and safe map links. Required fixed charges form the default extras lower bound. A manual summary below mandatory charges is rejected. Unspecified service basis is shown as unknown, never assumed to be menu.
- `src/vendor-profile.js`, `vendor-category-tabs.mjs` and main: reusable venue drafts/search and venue rendering in both wedding Venue and agency Contractors. Existing links/photos/conditions are retained. Catalog internal notes and commission are excluded from new wedding drafts.
- `server/vendor-profile.mjs`, `http.mjs`: gallery upload/read uses exact `photoId`/`photoIds` grants, live user access, same-agency ownership and record references. Gallery removal revokes that record's image access while other references survive. Images are private inactive vendor-photo assets. Input remains <=5MiB per file and is normalized to WebP, maximum1600px, without enlarging smaller files. Shared raster sanitation now recognizes real AVIF metadata (`heif`/`av1`) and accepts an optional resize bound; public publishing keeps its previous default dimensions.
- `server/service.mjs`: validated venue/gallery snapshots on vendor/selection; catalog changes do not propagate into existing weddings. `venue.saveToCatalog` atomically creates a reusable card and links the wedding selection, with explicit catalog create, wedding read/edit and organizer authority. Photos retain authorized references. Wedding-specific rent override, agreed total, project notes and agency commission do not become catalog defaults. Catalog snapshots now honor row/field reads.
- Docker copies the new shared module. No dependencies, schema/table migration, worker/cache policy or infrastructure change.

## Verification

- 252/252 Node tests passed. Seven new tests cover actual rent/date/range calculations, missing/zero/variable charges, validation, long descriptions, snapshots, private gallery fields/revocation/removal, atomic catalog promotion/idempotence, preserved budget values, JPEG/PNG/WebP/AVIF and1600px resize.
- `scripts/venue-ui-test.mjs` passed in Chrome and WebKit using isolated fictional data: carousel/synthetic swipe; comparison/reload/account/project scope; price/detail/gallery edits and AVIF upload/reorder; explicit catalog refresh; project-to-catalog save; exact-date tariff; agency creation; generic-category-to-venue transition with draft preservation; catalog search/add; couple choice/privacy;320–2560px geometry; two-column mobile comparison and3+ horizontal scroll. No page errors. This is browser engine testing, not physical iPhone testing.
- Fresh production and frozen-source builds passed; frozen HTTP runtime imports. All29 non-source-map build files byte-match the browser-tested build. Only Workspace source-map metadata differs between workspace roots; runtime JS/CSS are identical.
- Evidence: `/private/tmp/tie-venue-all-tests.log`, `/private/tmp/tie-venue-chromium.log`, `/private/tmp/tie-venue-webkit.log`, `/private/tmp/tie-venue-previews/`. Screenshots use generated solid-color test images, not customer photos. Production data was not changed.

## Published package

`/private/tmp/tie-venues-20261012-r1-release/`:144 source files, exactly9 modified/4 added relative to the previous Home Screen source manifest. Archive `tie-event-tie-venues-20261012-r1-source.tar.gz`; SHA256 `492c7fa46a9ca4053a77e4f808c026a8bf915c255ee276306ca26caeb9a3bd2b`. Frozen build uses `app-DlybhkX5.js`, `app-D4XkbEcf.css`; Workspace and guest runtime bundles unchanged. Source tar contains no database or fixture data. It was frozen before temporary node_modules/build artifacts were added to the candidate directory.

## Publication verification

- User authorized source transfer to ptitsa-plus (130.17.11.158) and publication on tie-event.ru with backups. Source extracted at `/opt/tie-event/releases/tie-venues-20261012-r1`; image `tie-event:tie-venues-20261012-r1`, digest `sha256:a70beda102ba552377b5646d1d248e4fdf00159eb1832e682a9e9521c9f67816`, running/healthy/0 restarts.
- Candidate has no network/production volume. Default launch/health/Sharp/privateAPI smoke, Home Screen metadata,14 venue/vendor tests and29 byte-matching runtime build files pass. Stage SSH ended after the image build; explicit smoke/candidate checks then completed successfully before activation.
- Activation exit0; fresh consistent before backup `/opt/tie-event/backups/before-tie-venues-20261012-r1-20261011T213811Z.sqlite`, env backup `env-before-tie-venues-20261012-r1-20261011T213811Z`. All22 business fingerprints match before/after and final verified backup. Final copy `/opt/tie-event/backups/tie-venues-20261012-r1-after-verified.sqlite`,0600/11,530,240 bytes; integrity/FK pass, schema16/34 accounts/14 weddings. Temporary final copy freed only after SHA match with the retained server backup.
- 25 public resources match frozen bytes; HTTPS/health200/privateAPI/privatePhoto401/www308; fonts MIME, immutable hashed assets, no-store API pass. New app-DlybhkX5.js is visible in existing live Chrome session. Venue list, empty comparison, all venue form fields and closing without save work at1710px without page overflow or site errors. Current wedding has no venue selection records; populated galleries/cards/comparison and edits were verified in isolated fictional Chrome/WebKit fixtures. No production records were created or edited for QA.
- Compose/Caddy hashes and external volume identity preserved. Rollback is previous Home Screen r1 image with current data volume and the saved env, never an old database over newer user actions. See `docs/DEPLOYMENT.md`.
- Evidence under local release directory: `smoke.log`, `candidate-final.log`, `activate.log`, `public.log`, `postcheck-db.log`, `postcheck-server.log`, `live-browser.json`, source/build manifests. Deployment is complete.

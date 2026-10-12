---
type: task
status: done
tags: [domain/vendors, layer/backend, capability/venues, risk/medium, task/implementation]
last_verified: 2026-10-12
updated: 2026-10-12
---

# Agency catalog import from five supplied Google spreadsheets

User explicitly authorized filling the agency catalog on tie-event.ru from five supplied spreadsheets. Owner: root, no delegation. Used data-analytics:validate-data for source reconciliation and acceptance. All five workbooks were exported through the user's authorized Chrome session. Professional catalog tabs were read; wedding guest lists, budgets, payments, timing, couple choices and internal organizers were excluded. No complete production database was downloaded.

## Result

- Batch `tie-catalog-sheets-20261012-r1`:107 vendor cards,61 venues/halls and46 contractors.105 created; existing Dmitry Makeev and Anton Varavka augmented while their prices, services, contacts, original notes and original link labels were preserved.
- Geneva and La Manche archived because their source explicitly says they are no longer rented;105 active cards,107 including archive. Five missing professional categories created; existing categories preserved.
-159 professional source rows mapped;14 structural/internal/unnamed exclusions reconciled. All1,055 professional source cell values retained exactly in provenance. Each card includes workbook/worksheet/row provenance and source links.
- Repeated identities merged only on clear names, aliases or shared professional URLs. Separate venue halls remain separate. Artem Andrianov, Angelia Events and KSK main-hall identity checked against official sites.
- Weekday tariffs, rent ranges, menus, deposit meaning, mandatory versus optional charges, service fees, accommodation, links and full descriptions retained. Multiple packages/years/discounts remain qualified quotes rather than a fabricated single price. Missing values remain unknown; explicit zero is preserved.
- Invalid source units, approximate quotes, gifts for an individual couple and missing Friday prices are marked/kept unknown. Source1's “Dom v Lobne” conflicts with its Lyubertsy address; the main address/map are empty, the conflict is explained in notes/details, and the original address and map URL remain in provenance/links. Browser verified “Адрес нужно уточнить”; no generated destination from an unconfirmed address.
- No embedded images exist in the supplied workbooks. Source portfolio/gallery/video links imported; no invented images or unrelated stock photos added.

## Verification and preservation

11 focused source-quality checks pass, including every quote/cell reconciliation, complete row accounting, identity/room separation, independent tariff/extra-cost checks, privacy exclusions and safe links.107 payload schemas validated locally and with the actual deployed image. Import rehearsed through normal service commands on a server-only consistent SQLite copy. Final replay skips107 records with0 row writes; all three accounts see the complete catalog.

Live changes applied atomically with exact business-table baseline fingerprints and entity-version guards. Only catalog entities/new categories, their audit records and command receipts changed. All other business tables and all unrelated entities match the pre-import baseline, including the three accounts, the user's new wedding and its18 tasks. Integrity is `ok`; foreign-key errors0. Narrow presentation polishing shortened link labels without losing URLs/quotes/financial fields. Source address ambiguity was corrected and verified separately under the same guards.

Chrome acceptance on the live site:105 active versus107 with archive;11 photographers; search; photographer details with different package lengths and discounts; Sherwood's seven weekday rates, deposit bands and required/optional costs; existing Makeev price; source-address uncertainty. Dedicated result tab retained; user-owned source/settings tabs left intact. Screenshot and compact report: `test-results/catalog-import-20261012/` (ignored).

No code deployment, image change or restart. Running image remains `tie-event:tie-clean-reset-20261012-r1`. Previous unit-test corrections remain local. Do not deploy them implicitly as part of this data import.

## Evidence and retention

- Source/export metadata, targeted extracted cells, builder/audit scripts: protected `/private/tmp/tie-catalog-import-20261012/`; full workbook exports are not in Git or the server import package.
- Professional payload SHA256 `17022f357cb37d815598a9ccade8e3741c33948ef6fa908d9b24f3470da4c247`. Original payload remains immutable after import. Import-owned provenance retains that inputHash through presentation updates, so reruns do not create duplicates or undo later edits.
- Protected server package/evidence: `/opt/tie-event/imports/catalog-20261012-r1/`, including base/presentation/correction plans, command scripts and final summary/fingerprints. This contains targeted catalog records, not a database backup.
- Temporary SQLite rehearsals/pre-import copies are removed after final acceptance. Keep the user's one closed original backup, `/opt/tie-event/backups/clean-reset-20261012-before.sqlite`, root0600, SHA256 `9c32f834c81d6d1a895b053bcc8b292092c3fd1e389a4e895d678871c1039c36`. Never restore deleted wedding/history data from that archive for code rollback.

Scope: completeness and correctness against supplied source content, not a fresh market-price confirmation or booking availability check. Values missing or conflicting in the sources are visibly qualified rather than invented.

## Follow-up: remove visible Google spreadsheet sources

User explicitly requested removing the Google spreadsheet source links from all contractor cards. Applied to all 107 vendor cards, including both archived venues: 150 source links removed, plus 16 automatically derived source portfolio fallbacks. Professional website/social/gallery/video/map links remain. Every other card field, including prices, conditions, notes, categories and internal provenance, is byte-identical to the fresh pre-change baseline. User's intervening category edits were preserved.

Rehearsed through normal service commands, then applied atomically with full business-table fingerprints and entity versions. Live checks: 107 cards, two archived, zero remaining Google spreadsheet links/fallbacks, all three accounts see the cleaned catalog, integrity `ok`, foreign-key errors zero. Chrome verifies zero source anchors/labels across all 107 rendered cards and no source links in Sherwood details. Screenshot: `test-results/catalog-import-20261012/source-links-removed.jpg`.

Protected change plans and summary: `/opt/tie-event/imports/source-links-20261012/`. The temporary server-only SQLite rehearsal is removed after verification; the sole original closed backup remains. This changes catalog data only; no code deployment or restart. Original import replay remains a skip because the retained provenance inputHash is unchanged, so it will not recreate the removed source links.

## Follow-up: host packages and fresh completeness audit

User clarified ВД = host + DJ and ВДА = host + DJ + equipment, requesting these descriptions in host conditions. Fresh Chrome exports of all five supplied workbooks have zero professional cell changes/additions relative to the initial extraction. Twenty host rows resolve consistently to ten host cards: six ВД and four ВДА. Added the matching full explanation at the start of `terms` on all ten cards. Existing terms remain as an exact suffix; every other data field is byte-identical to the fresh baseline.

User additionally asked whether every contractor was transferred. Independently enumerated 173 nonempty professional source rows in the fresh exports: 159 mapped and 14 explained exclusions, zero missing/extra rows. Exclusions are eight structural headings, two internal agency organizers and four anonymous installers without names or contact details. Named team members remain in their company's source data/notes rather than being mistaken for separate suppliers. All 107 source identities resolve uniquely to live cards; all 1,055 professional source values match exactly. Current category edits are preserved. Result remains 46 contractors and 61 venue/hall cards, including two archived venues.

Changes rehearsed on a server-only SQLite copy through actual service commands, then applied with business hash/version guards. Live verification passes for all three accounts; integrity `ok`, no foreign-key errors and no reintroduced Google spreadsheet source links. Chrome reads both VD/ VDA definitions from persisted forms; screenshot `test-results/catalog-import-20261012/host-packages.jpg`. Evidence: protected `/private/tmp/tie-catalog-import-20261012/hosts-followup/` and server `/opt/tie-event/imports/host-packages-20261012/`. Full workbooks remain local; only targeted professional evidence is sent to the server. Temporary SQLite rehearsal removed after verification; sole original closed backup retained. No code deployment or restart.

User corrected the target field to «Услуги и пакет». Current state: all ten host cards now have `services` = «Ведущий и диджей (ВД)» (six) or «Ведущий, диджей и аппаратура (ВДА)» (four). Removed only the ten explanatory prefixes added in the preceding step from `terms`, preserving the original conditions exactly. All other card/business fields remain unchanged. Atomic preview/apply/live checks pass; all ten rendered service descriptions verified in Chrome. Current screenshot: `test-results/catalog-import-20261012/host-services.jpg`; protected server evidence `/opt/tie-event/imports/host-services-20261012/`. Temporary SQLite rehearsal removed; no code deployment/restart or source-link restoration.

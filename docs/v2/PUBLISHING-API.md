# V2 publication API

The publication module is `server/v2/publishing/index.mjs`. Root calls
`migrate(db)` during its V2 migration and adds `operations` to the central
command dispatcher through `executeModule`. These commands are online only;
the existing offline queue must not enqueue them.

## Commands

All commands use the usual `{ id, op, projectId?, entityId?, version?, data }`
envelope. Their successful result is the changed entity except
`publicContent.configureDomain`, which returns `{ configuredDomain }`.

Publication drafts are whole structured documents. The module therefore checks
the concrete owner row and a full-field permission (`fields: null`) before a
draft read or mutation, including an idempotent replay. A field-limited grant
cannot receive, overwrite, publish, or replay a full draft. Creation uses
`row: null`, so a row allow-list cannot create an unscoped publication.

| Command | Required access | Body |
| --- | --- | --- |
| `microsite.saveDraft` | `edit` in project `microsite` | `{ draft, rsvpDeadline?, closesAt? }` |
| `microsite.publish` | `edit` + `publishWeddingSite` in `microsite` | `projectId`, current microsite `version` |
| `microsite.unpublish` | `edit` + `publishWeddingSite` in `microsite` | `projectId`, current microsite `version` |
| `microsite.rotateShareId` | `edit` + `publishWeddingSite` in `microsite` | `projectId`, current microsite `version` |
| `microsite.importTiming` | `edit` in `microsite`, `read` on chosen timing table | `projectId`, microsite `version`, `{ tableId, rowIds[] }`; imports only title/time/place into the draft |
| `publicContent.saveDraft` | agency `edit` in `public-site` | `{ kind: 'case'|'package'|'faq', draft }`; add `entityId/version` while editing |
| `publicContent.publish` | `publishAgencySite` | `entityId`, current `version`, `{ kind }` |
| `publicContent.unpublish` | `publishAgencySite` | `entityId`, current `version`, `{ kind }` |
| `publicContent.archive` | `publishAgencySite` | `entityId`, current `version`, `{ kind }` |
| `publicContent.restore` | `publishAgencySite` | archived `entityId`, current `version`, `{ kind }` |
| `publicContent.configureDomain` | `publishAgencySite` | `{ configuredDomain }`; empty value removes canonical/sitemap output |
| `publicSite.saveMainDraft` | agency `edit` in `public-site` | `{ draft }` for hero, approach, steps, cabinet benefits and contacts |
| `publicSite.publishMain` / `unpublishMain` | `publishAgencySite` | current main-page `version` |

Microsite `draft.template` is one of `light`, `plum`, or `photo`. Its ordered
blocks are `cover`, `rsvp`, `program`, `directions`, `contacts`,
`accommodation`, `transport`, and `gallery`; cover and RSVP are always visible.
Publishing makes a new immutable `micrositeRevision`; its allowlisted display
fields are names, date label, venue, dress code and palette, intro, program,
directions, accommodation, transport, contacts, RSVP switches, ordered gallery
metadata (alt/caption/order), and public asset IDs. It never contains guest rows,
private file IDs, money, project notes, or access data. A later draft save only
sets `dirty`; it does not change the active revision.

Agency publications use `publicCase`, `servicePackage`, and `faq` entities with
an immutable `publicRevision` child. Cases and packages require title, slug,
and summary at publication time. FAQs require question and answer. There are no
seeded cases, prices, contacts, testimonials, or promises.

Rotation generates a new opaque 128-bit share ID and clones a new active
revision/assets. The former URL and its assets are revoked. Unpublish revokes
the active revision assets and makes the public lookup return 404.

## Reads and root HTTP hooks

Private reads require the authenticated current user:

```text
GET /api/v2/publishing/microsite?projectId=…
  -> getMicrosite(db, user, projectId)
GET /api/v2/publishing/microsite/preview?projectId=…
  -> previewMicrosite(db, user, projectId), private `srcDoc` only; image URLs
     use authenticated `/api/v2/publishing/assets/:id`, never public asset URLs
GET /api/v2/publishing/content?kind=case|package|faq&offset=&limit=
  -> listContent(db, user, kind, query)
GET /api/v2/publishing/home -> getPublicHome(db, user)
GET /api/v2/publishing/assets/:id -> authorize current owner and return the private preview derivative
```

Public root routes only call the pure functions below. Never fall back to an
entity or draft when a published revision is missing.

```text
GET /api/public/w/:shareId          -> getPublishedMicrosite(db, shareId)
GET /api/public/content/:kind/:slug -> getPublishedContent(db, agencyId, kind, slug)
GET /api/public/assets/:id          -> getPublicAsset(db, agencyId, id)
GET /w/:shareId                     -> renderWeddingHtml(site)
GET /stories, /services, /faq, /     -> renderAgencyHtml({ page, content, home, ... })
GET /stories/:slug                   -> renderAgencyHtml({ page: 'story', item: publishedCase, ... })
GET /sitemap.xml                    -> sitemapXml(db, agencyId)
```

`/w/*` responses must set `X-Robots-Tag: noindex, nofollow, noarchive`,
`Referrer-Policy: no-referrer`, and `Cache-Control: no-store`. The root public
renderer uses `configuredDomain` only when it is configured; it must not invent
a canonical host. The sitemap function returns `null` until then and contains
only published agency pages, never `/w/*`, drafts, apps, APIs, or assets.

The guest worker calls `getPublishedMicrosite(db, shareId, now)`. It receives
the share ID, public revision, current RSVP deadline, and `closesAt`; it must
still apply its invitation/session checks. No guest handler may read a draft or
the `microsite` entity directly.

## Public assets

Root mounts an authenticated multipart/JSON adapter that decodes the supplied
bytes and calls:

```js
await createPublicAsset(db, user, { projectId, ownerId, content: bytes });
```

`ownerId` must be the saved microsite for that project or a saved agency content
entity. The adapter may send either new bytes or `privateFileId`; in the latter
case it must still pass the current project/file permission check before reading
the private blob. No private file ID is stored in a revision. The module accepts only JPEG, PNG, WebP, and AVIF by signature, rejects
files over 12 MB and images over 40 MP, decodes/re-encodes them to WebP, applies
orientation, and stores a separate derivative in `published_assets`. Sharp's
default output does not preserve EXIF/XMP/IPTC metadata. The returned ID is
placed in `draft.assetIds`; it becomes externally readable only after publish.
Each publication creates a fresh derivative for its new revision. Unpublish
revokes that derivative, and republishing creates a new URL rather than
reactivating the old one.

Install the locked native dependency in the root project, not in a symlinked
foreign `node_modules` tree:

```text
sharp@0.35.4
```

This version was selected from Sharp's official current changelog. Its official
API documents `metadata()` for dimensions and default `toBuffer()` metadata
removal. The module imports it dynamically so normal command-only tests can run
before the root dependency is available, but a real asset upload fails closed if
it is absent.

## Legacy migration

`migrateLegacyDrafts(db, user)` is an explicit, idempotency-safe **operator
step to invoke once with a recorded migration marker in root**. It imports old
`agencies.settings.portfolio` and `services` only as drafts and returns counts.
It deliberately does not publish them, does not convert private images, and
does not replace the existing public page/snapshot. Root must record the marker
after a successful run to avoid importing the same legacy rows twice.

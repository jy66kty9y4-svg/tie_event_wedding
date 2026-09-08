---
type: component
version: 2
source_paths: [server/v2/common.mjs, docs/v2/TECHNICAL.md]
last_verified: 2026-09-08
---
# V2 integration contract

Baseline V1: fa0a598. User authorized full PROMPT_DEVELOPER_V2.md and AC-01…47, preserving V1 finances, records, permissions and offline. Full normative details in docs/v2/REQUIREMENTS.md, TECHNICAL.md, DESIGN.md; prototype is only layout evidence.

Workers own dedicated directories, tests and a module API document. Do not edit shared db/auth/model/service/http/main/shared/styles files. Return precise root integration hooks in your API document. Work in persistent worktree and commit milestones; no other product/data access, no push, no new agents.

## Module interface

Each domain's `server/v2/DOMAIN/index.mjs` exports:
- `operations`: object keyed by command op. Each descriptor `{authorize(db,u,c),run(db,u,c)}`. Current user and project existence checked centrally, then descriptor.authorize BEFORE replay. Authorize must enforce current section/row/field action and special identity restrictions even for replay. Run must return synchronous JSON; it is inside BEGIN IMMEDIATE and central idempotency. Never nested transaction. Commands keep existing `{id,op,projectId,entityId,version,data,...}`.
- `migrate(db)`: idempotent schema create/alter, synchronous. Called inside central migration transaction; no migrations table writes, no destructive rewrite.
- Read/preview functions named/documented in `docs/v2/DOMAIN-API.md`, pure GET, current auth, scoped and paginated. Readbacks use existing entity row DTO `{id,agency_id,project_id,kind,parent_id,data,version,...}` and listPage.
- Worker tests can migrate own schema after openDatabase and call executeModule with operations directly. Root integrates operations into service.execute; integration tests follow.

Common helper `server/v2/common.mjs` contains executeModule, currentUser, projectAccess, scoped, members/validateMembers, visible, listPage, sectionRows, date-only addDays/localDate, timeZone, zonedInstant with DST gap/fold handling. Existing db helpers insert/change/audit/version; model getScoped/financials/validateRow, auth can/requireAccess. Do not import service from modules (cycle). On inter-domain need, return hook API, do not invent a second source of truth.

Frontend domain `src/v2/DOMAIN/Workspace.jsx` exports components taking `{state,projectId,run,refresh,navigate}`. state is authorized V1 snapshot with assignableMembers; `run(op,body)` sends command, returns actual result and throws on errors. `refresh()` reloads. New read endpoints use `/api/v2/DOMAIN/RESOURCE?projectId=...`, module API doc declares each. Existing src/client.js exports api(path, options), see source; new domains can use own request helper if needed, but preserve same-origin CSRF. Import domain CSS locally, prefix classes `v2-DOMAIN-`, no global CSS edits. Root owns shell/design tokens/routes. UI text Russian, real forms, preserved errors/drafts, 409 detail. Warm white/rose, design spec. No demo facts inserted.

## Shared boundary: publication + guests

Publication domain owns microsite entity project scope and immutable micrositeRevision, public content and published_assets. microsite.data fields: shareId (random opaque string), draft, publishedRevisionId, status ('draft'|'published'|'unpublished'), rsvpDeadline YYYY-MM-DD, closesAt ISO instant, dirty boolean. Revision contains public display fields only, no private blob IDs or guest data. Root mounts public HTTP pages and guest handlers.

Guest domain reads current microsite by project/shareId. Must require published active revision, live project, now < closesAt. Invitation deadline/expiry use current microsite.rsvpDeadline/project.data.timeZone. Guest domain owns guest_invites, guest_invite_rows, guest_sessions, guest_commands, semanticMap, seating entity kinds. Export public guest handlers as pure service functions for HTTP to wrap in guest cookie+CSRF: exchange, context, respond (transaction+idempotency handled there), and revocation. Tokens never URL query/log/persistent browser storage. Guest audit must set actor_type='guest_invite', actor_ref=invite ID; root adds audit columns. Guest module migrate may add those columns defensively; normal db.audit will use named columns after root integration.

seatingTable relation is the only extra target kind (explicit targetKind). Existing guest rows are unique source, assignment stored using mapped column IDs. Define exact semanticMap in GUEST-API.md and notify publisher/root. Generic mutation guard exported for root: validate schema edits; block mapped RSVP/seat edits outside specialized commands including offline; guest delete/restore side-effects preserve no seats on restore.

## Shared boundary: workflow + calendar

Workflow owns task, approval, approvalRevision, comment, template_applications/approval_votes/approval_budget_links. Task data field names exactly TECHNICAL, dueMode 'fixed'|'relative', offsetDays integer ±1095. Tasks dueDate computed from project date. Template blueprints persisted within existing template data via specialized operation. Preserve existing tables/categories. 18 structural built-in tasks, not fictional personal details. Root integrates project creation/apply and generic template/date guard hooks supplied by worker.

Date reschedule preview/commit workflow includes active relative task versions, project version and dependency digest. Root owns meetings/calendar; export/register hooks or accept root-supplied anchored meeting preview/apply callbacks. Do not silently ignore anchored meetings: base behavior can read meeting entities according to TECHNICAL and common zonedInstant. Microsite dirty on project date/timing edits managed root guard.

Approval apply touches existing selection+obligation synchronously under transaction, checks original versions and amounts against existing financials, no movement. Authorize finance+vendors, never permission combination across scopes.

Root owns calendar/meeting/notifications/readiness, shared permissions+migrations, API dispatcher and central UI. Source event hooks integrate module changes with durable notification outbox at command transaction boundary. Modules can expose event facts in result but never fabricate notifications or paid/booking/contract confirmations.

# Workflow API v2

`server/v2/workflow/index.mjs` exports `migrate`, `operations` and `integrationHooks`.
The root dispatcher calls `migrate(db)` during its migration transaction and forwards listed commands to
`executeModule(db, user, command, operations)`. All commands are online-only and return synchronous JSON.

## Commands

- Tasks: `task.create`, `task.edit`, `task.setStatus`, `task.delete`, `task.restore`.
  They require the `tasks` section action. `task.setStatus` requires `version`; completing verifies that
  every active dependency is `done` or `skipped`. Deleting a depended-on task returns 409 with the
  dependent IDs; it never removes their dependencies silently.
- Template: `taskTemplate.apply` requires `templateId`, `templateVersion`, `projectVersion`.
  `previewTemplateApplication(db,user,{projectId,templateId,templateVersion})` is the GET/preview hook.
  It creates only blueprint keys absent from this project and records `(project, template, version)` once.
- Date: `previewReschedule(db,user,{projectId,newDate})` returns `projectVersion`, active relative task
  versions, old/new dates and a SHA-256 digest. It also includes each `meeting` whose
  `data.dateAnchor === 'wedding'`, recalculating `startAt/endAt` from `localStartTime`,
  `durationMinutes`, and its IANA time zone with explicit DST-gap/fold validation.
  `project.reschedule.apply` accepts `projectVersion`, `sourceVersions`, `previewDigest`; a stale plan
  returns 409 with a fresh preview.
- Approvals: `approval.saveDraft`, `approval.publish`, `approval.withdraw`, `approval.vote`,
  `approval.applyToBudget`. A publish creates an immutable `approvalRevision` entity. Vote requires
  current revision, `approvals.edit`, and the current actor in the revision's `approverUserIds`.
- Comments: `comment.create`, `comment.edit`, `comment.delete` attach to a task or approval. Editing is
  limited to the author; deletion permits the author or a user with parent-section delete rights.

## Pure reads

Root mounts these permission-filtered GET handlers (private/no-store):

- `GET /api/v2/workflow/tasks?projectId=&from=&to=&assignee=&status=&phaseKey=&offset=&limit=` →
  `listTasks` (default 50, maximum 200).
- `GET /api/v2/workflow/approvals?projectId=&offset=&limit=` → `listApprovals`.
- `GET /api/v2/workflow/approvals/:id?projectId=` → `getApproval`, including immutable revision history
  and votes visible to a user who can read the approval.

## Root integration hooks

Register `operations` before the generic entity handlers so specialized workflow operations own task,
approval, revision and comment mutations. Call `guardProjectDateEdit(command)` from the generic entity
handler before a project edit; it rejects `data.date` and forces the preview/apply path. Route legacy
project-date edits through `previewReschedule` / `project.reschedule.apply`; do not allow a generic project
edit to move the date. The preview already handles V2 anchored meetings; calendar may extend it only by
recomputing the final digest and preserving the all-or-nothing version check.

`taskBlueprints` and `taskPhases` live in the existing template `data`. The module exports
`DEFAULT_TASK_BLUEPRINTS` with the required 18 structural titles for a fresh template setup; root can seed
it while it owns template creation. Budget application only changes existing selection/obligation entities
in its command transaction and records `approval_budget_links`; it creates no movement or payment.

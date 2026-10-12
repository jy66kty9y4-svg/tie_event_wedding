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
- Date: `previewReschedule(db,user,{projectId,newDate,newTimeZone?})` returns `projectVersion`, active relative task
  versions, old/new dates, validated IANA time zones and a SHA-256 digest. It also includes each `meeting` whose
  `data.dateAnchor === 'wedding'`, recalculating `startAt/endAt` from `localStartTime`,
  `durationMinutes`, `offsetDays`, and its IANA time zone with explicit DST-gap/fold validation. `unchanged`
  lists fixed/period/undated/completed tasks and readable obligation/deposit dates that will stay untouched.
  `project.reschedule.apply` accepts `projectVersion`, `sourceVersions`, `previewDigest`; a stale plan
  returns 409 with a fresh preview. It marks an active wedding-site draft dirty in the same transaction.
- Approvals: `approval.saveDraft`, `approval.publish`, `approval.startRevision`, `approval.withdraw`, `approval.vote`,
  `approval.applyToBudget`. A publish creates an immutable `approvalRevision` entity. Vote requires
  current revision, `approvals.edit`, and the current actor in the revision's `approverUserIds`.
  `approval.startRevision` requires a reason after an approved result; earlier revisions and votes remain intact.
  `approval.delete` accepts only a never-published draft.
- Comments: `comment.create`, `comment.edit`, `comment.delete` attach to a task or approval. Editing is
  limited to the author; deletion permits the author or a user with parent-section delete rights.

## Task schedules (2026-10-11)

Task creation and editing accept four `data.dueMode` values:

- `none` (default for a new manual task): no date is required. `dueDate`, `fixedDate`,
  `startDate`, `endDate` are cleared to empty strings and `offsetDays` to null.
- `fixed`: `fixedDate` is a required valid calendar date; `dueDate` matches it.
- `range`: required `startDate` and `endDate` are inclusive valid calendar dates,
  `endDate >= startDate`. `dueDate = endDate` is the completion deadline and drives
  overdue detection and deadline reminders. A one-day period is allowed.
- `relative`: existing integer `offsetDays` rule relative to the wedding date remains available.

Changing modes clears inactive fields. Partial edits preserve the existing schedule, including
legacy tasks having only `dueDate`. Wedding-relative template tasks retain their dates; they can
be individually switched to any mode. No records are backfilled or migrated.

Undated tasks remain in the plan, board, grouped schedule and an organizer's focused task list;
explicit `from`/`to` filters exclude them. Date filtering includes periods overlapping the window.
Undated tasks produce no overdue state or date reminders, and existing queued reminders are
cancelled when the deadline is removed. Wedding rescheduling moves only active relative tasks;
unchanged preview reasons include `undated_task` and `range_task`. Version, dependency, status
and field-permission checks remain enforced.

Calendar task events use inclusive `start`/`end` and `dateRange: true` for a visible range;
point dates have `dateRange: false`. Restricted readers lacking the range fields see only an
allowed due date. The calendar UI displays a range on each included day. Tasks without a date
have no calendar event. External calendars use their exclusive all-day end convention;
removing a date deletes the previously linked event during the existing sync flow.

Covered by `tests/task-schedule.test.mjs`: six scenarios verify modes/legacy persistence,
atomic validation and permissions, window overlap, rescheduling, reminder cancellation,
and a mocked Google all-day round trip/deletion. Real provider accounts are not changed in QA.

## Pure reads

Root mounts these permission-filtered GET handlers (private/no-store):

- `GET /api/v2/workflow/tasks?projectId=&from=&to=&assignee=&status=&phaseKey=&mine=&includeDeleted=&offset=&limit=` →
  `listTasks` (default 50, maximum 200). Optional `mine=true` matches primary or additional assignment;
  `includeDeleted=true` requires history access.
- `GET /api/v2/workflow/tasks/:id?projectId=&includeDeleted=` → `getTask`, including comments.
- `GET /api/v2/workflow/approvals?projectId=&offset=&limit=` → `listApprovals`.
- `GET /api/v2/workflow/approvals/:id?projectId=` → `getApproval`, including immutable revision history
  and votes visible to a user who can read the approval.
- `GET /api/v2/workflow/template-preview?projectId=&templateId=&templateVersion=` →
  `previewTemplateApplication`; `GET /api/v2/workflow/reschedule-preview?projectId=&newDate=&newTimeZone=` →
  `previewReschedule`. Both are pure reads and must be mounted before the React `TemplateApply` and
  `RescheduleDialog` controls are enabled.
- `GET /api/v2/workflow/budget-preview?projectId=&id=&revisionId=&optionId=&selectionId=&obligationId=` →
  `previewBudgetApplication`. The response contains current versions, current service/agreed amounts,
  paid total, new price, delta, conflict flag, `createsPayment:false`, and a digest. Apply must repeat the
  existing selection/obligation IDs and versions with `previewDigest` and `confirmed:true`; it never creates
  a payment or silently substitutes another financial record.

## Root integration hooks

Register `operations` before the generic entity handlers so specialized workflow operations own task,
approval, revision and comment mutations. Call `guardProjectDateEdit(db,user,command)` from the generic entity
handler before a project edit; it rejects `data.date` and forces the preview/apply path. Route legacy
project-date edits through `previewReschedule` / `project.reschedule.apply`; do not allow a generic project
edit to move the date. The preview already handles V2 anchored meetings; calendar may extend it only by
recomputing the final digest and preserving the all-or-nothing version check.

`taskBlueprints` and `taskPhases` live in the existing template `data`. The module exports
`DEFAULT_TASK_BLUEPRINTS` with the required 18 structural titles for a fresh template setup; root can seed
it while it owns template creation. Budget application only changes existing selection/obligation entities
in its command transaction and records `approval_budget_links`; it creates no movement or payment. The root
HTTP dispatcher must mount `getTask` and `previewBudgetApplication` from `integrationHooks` in addition to the
previous task/approval/template/reschedule reads.


### Open wedding dates (2026-10-11)

Projects and application briefs accept an omitted or empty `date`, persisted as `''`.
They remain current weddings; calendar/readiness do not invent a wedding event/date.
Seeded and manually edited relative tasks retain `dueMode:'relative'` and offsets,
but have empty `dueDate` until a wedding date is selected. Template preview/application
also accept an open wedding date without marking these tasks overdue.

Reschedule preview/apply accept explicit `newDate:''` to reopen a wedding date; clients
must preserve the empty query parameter. Selecting the first exact date or clearing it
updates only active relative tasks. Fixed, period, undated and completed tasks remain
unchanged. Clearing a date with wedding-anchored meetings returns409 with
`code:'anchored_meeting_requires_date'`; detach those meetings first. Existing versions,
permissions, digest checks and transaction rules apply.

`application.questionnaire` accepts optional `date` alongside answers; omission keeps
its existing date. `account.questionnaire` accepts optional `weddingDate` plus required
`projectVersion` when that field is present. The same approved account may leave an open
date or assign the first date. An already agreed wedding date cannot be overwritten
through the brief. Stale project versions return409 and retain the questionnaire draft.
Completion, first-date assignment and relative task changes are atomic, using the normal
permission-checked reschedule engine after unlocking the existing approved grant. Failure
rolls completion back. Existing clients omitting these fields keep their previous flow.
The submitted date is recorded in onboarding metadata, visible to authorized reviewers.
The existing external-calendar sync queue includes questionnaire submission.

### История задач (12 октября 2026)

`task.restore` принимает актуальные `projectId`, `entityId`, `version` и необязательный `auditId`. Без auditId требуется удалённая задача; с ним выбирается состояние before_json соответствующей записи истории (after_json для создания). Обязательны текущие read/edit/history для соответствующих полей/строки в одной допустимой области. Snapshot связывается с agency/entity/kind/project, версии и ссылки проверяются, циклы и незавершённые зависимости блокируют восстановление done. Относительные сроки считаются от текущей даты свадьбы. Статус завершения/фокус нормализуются; изменение фокуса остаётся доступным только сотрудникам с projects. Команда транзакционна/идемпотентна и вызывает обычную внешнюю календарную синхронизацию.

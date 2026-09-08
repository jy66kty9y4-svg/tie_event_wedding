# tie.event v2 — данные, API, зависимости и план реализации

Дата: 8 сентября 2026. Это проект контракта для разработчика. Названия новых файлов/команд ниже — целевые; их наличие в текущей версии не подразумевается. Продуктовые правила и приёмка находятся в [REQUIREMENTS.md](REQUIREMENTS.md).

## 1. Архитектурная основа

Сохранить React 19 + Vite 8, Node.js ≥22.13 с `node:sqlite`, существующие HTTP API, `entities`, журнал `audit`, `commands`, сессии и назначения прав. Для этих функций не требуется переход на другой backend или другую БД.

Проверенные места интеграции:

| Файл / функция | Что использовать / изменить |
|---|---|
| `server/db.mjs:openDatabase` | Добавить миграции после фактической последней версии (на момент чтения — 3) |
| `transaction`, `version`, `change`, `audit` | Единый путь транзакций, optimistic locking и истории |
| `server/auth.mjs:can`, `requireAccess` | Разрешение действия вместе с областью, строкой и полями |
| `server/service.mjs:execute`, `authorizeCommand`, `mutateEntity` | Диспетчер новых операций и запрет обхода через generic edit |
| `snapshot`, `filteredRow`, `visibleTable` | Серверные проекции без лишних данных |
| `server/model.mjs:initialTemplate`, `validateRow`, `validateColumns` | Связанные таблицы, semantic mapping, защита типов |
| `financials`, `validateLedger`, `movement` | Единственный расчёт денег; согласования не создают второй журнал |
| `src/client.js:command`, `allowedOffline`, `syncQueue` | Сохранить идемпотентность, очередь и повторную авторизацию |
| `src/shared.js` | Дополнить статусы/labels; вынести календарные функции с явным часовым поясом |
| `src/main.jsx`, `src/ui/AppShell.jsx` | Маршрутизация и точки подключения новых экранов |

`publicInfo()` сейчас отдаёт общий объект настроек. До добавления закрытых настроек каналов заменить его явным списком публичных полей. SMTP/API-секреты не помещать в `agencies.settings`, которые могут попасть в существующий публичный ответ.

Текущий `members` зависит от приглашений/финансовых прав. Для назначения задач добавить отдельную безопасную выборку `assignableMembers: [{id,name}]`: только участники проекта, без email/телефонов/состава чужих проектов.

## 2. Источники истины

| Данные | Единственный источник |
|---|---|
| Суммы, остатки, оплаты | Существующие obligation + movement |
| Подрядчик свадьбы | Существующая selection с исходным vendorId и согласованными условиями |
| Человек в списке гостей | Существующая row таблицы гостей |
| Место гостя | Структурированное назначение в той же row; отдельной копии имени нет |
| Программа пары/команды | Существующие строки timing; представления не копируют события |
| Задача | Новая entity kind=task |
| Решение | Неизменяемая approvalRevision + голос конкретного пользователя |
| Публичные страницы | Опубликованный снимок с allowlist полей и публичными ресурсами |
| Обзор/календарь/проверки | Вычисляемые серверные проекции источников, не независимые записи |

Ссылки используют UUID, а не названия. Переименование гостя, стола, колонки или подрядчика не меняет его идентичность.

## 3. Предлагаемая схема

### 3.1. Новые и расширяемые entities

Общие поля остаются: `id, agency_id, project_id, kind, parent_id, data, version, deleted, updated_at`.

| kind / область | Минимальное содержание `data` |
|---|---|
| `task` / проект | title, description, phaseKey, status, assigneeUserId, participantUserIds, dueMode, fixedDate, offsetDays, dueDate, dependencyIds, priority, sourceTemplateId/version/key, completedAt, completedBy, skipReason, order |
| `approval` / проект | title, category, draft, currentRevisionId, state, sourceTaskId, dueDate |
| `approvalRevision` / проект, parent approval | number, approverUserIds, policy, options[], publishedAt, publishedBy, withdrawnAt/reason; содержимое после отправки неизменно |
| `comment` / проект, parent task/approval | text, authorId, createdAt, editedAt; разрешения наследуются от родителя |
| `meeting` / проект или агентство | title, startAt, endAt, timeZone, location, assignedUserIds, participantUserIds, dateAnchor, offsetDays, localStartTime, durationMinutes, conflictReason |
| `seatingPlan` / проект | name, widthM, heightM, zones[], guestTableId; один основной активный план |
| `seatingTable` / проект, parent seatingPlan | label, shape, xM, yM, widthM, heightM, rotationDeg, capacity |
| `microsite` / проект | shareId, draft, publishedRevisionId, status, rsvpDeadline, closesAt |
| `micrositeRevision` / проект | только публичные displayFields, schedule[], assetIds[], versionNumber, publishedAt |
| `publicCase` / агентство | slug, draft, publishedRevisionId, order |
| `servicePackage` / агентство | slug, draft, publishedRevisionId, order |
| `faq` / агентство | draft, publishedRevisionId, category, order |
| `publicRevision` / агентство, parent content | типизированный публичный снимок case/package/faq |
| `notification` / реальная область источника | recipientUserId, sourceKind, sourceId, sourceVersion, templateKey, createdAt, readAt, dedupeKey; текст формируется с учётом актуальных прав |

Обязательные расширения:

- `project.data.timeZone`, `readinessPolicy` (обязательность договора/брони/программы/рассадки), `leadOrganizerUserId`.
- `template.data.taskBlueprints` и `taskPhases`; прежние sections/tables/categories/offline сохраняются.
- `file.data.documentKind`, `verificationStatus`, `verifiedBy`, `verifiedAt`, `verificationNote`: явная отметка проверки файла, не автоматическое распознавание договора.
- `selection.data.bookingRequired`, `bookingStatus` (unknown/requested/confirmed/cancelled), `bookingVerifiedBy/At`, `bookingEvidenceFileId/Note`, `approvalRevisionId`, `approvalOptionId`.
- `table.data.semanticMap` для подключённых гостевых/тайминговых возможностей; версия схемы меняется при изменении mapping.
- `timing` semanticMap дополнить `dayOffset`, `startTime`, `endTime`, `required`, `assignedUserIds`. Названия старых текстовых «Ответственный» не использовать для расчёта занятости: требуется явная привязка к пользователю.

Новые типы не передавать бесконтрольному `entity.edit`: у ревизий, голосов, публикаций, мест и связанных колонок — собственные валидаторы и операции.

### 3.2. Таблицы для уникальности и безопасности

| Таблица | Ключи и назначение |
|---|---|
| `template_applications` | UNIQUE(project_id, template_id, template_version); применение версии ровно один раз |
| `approval_votes` | UNIQUE(revision_id,user_id); decision, option_id, comment, created_at, version |
| `approval_budget_links` | UNIQUE(revision_id,option_id); selection_id, obligation_id, applied_by/at |
| `guest_invites` | id, digest UNIQUE, agency_id, project_id, guest_table_id, expires_at, revoked_at, created_by, version |
| `guest_invite_rows` | PRIMARY KEY(invite_id,guest_row_id), is_plus_one; явная область ссылки |
| `guest_sessions` | digest PRIMARY KEY, invite_id, expires_at, invite_version; отдельны от users/sessions |
| `guest_commands` | UNIQUE(invite_id,command_id); payload_digest, result; безопасный повтор RSVP |
| `notification_outbox` | dedupe_key UNIQUE, recipient_id, source_id/version, occurrence_at, channel, status, attempts, retry_at, lease_until, generation |
| `readiness_snoozes` | UNIQUE(user_id,project_id,rule_key,source_id); until_at, reason; личное отложение |
| `published_assets` | id, owner/revision, mime, dimensions, content/storage_key, active; отдельны от private blobs |

На всех ссылках проверять agency_id/project_id, даже если SQLite FK проверяет существование ID. Пользователь из другого агентства не должен привязать существующий чужой объект.

Места не дублируются в отдельной writable-таблице. В транзакции `BEGIN IMMEDIATE` проверить все активные назначения данного стола, ожидаемые версии гостя/схемы/стола и вместимость. Если добавляется SQL-индекс назначений для скорости, он является производным индексом, обновляется в этой же транзакции и сверяется с исходными row.

### 3.3. Точные перечисления

```ts
type TaskStatus = 'todo' | 'doing' | 'done' | 'skipped';
type DueMode = 'fixed' | 'relative';
type ApprovalPolicy = 'any' | 'all';
type VoteDecision = 'approve' | 'request_changes';
type Rsvp = 'unanswered' | 'confirmed' | 'declined' | 'tentative';
type CheckState = 'pass' | 'warning' | 'unknown' | 'not_applicable';
```

Blocked/overdue — вычисления, не TaskStatus. Разные approved option при `all` дают вычисляемое «Нужно обсудить». Согласование выбирает один вариант, не произвольное множество. Личный snooze не меняет CheckState.

## 4. Права и безопасные проекции

Существующие действия `read/create/edit/delete/structure/finance/files/history` применяются к новым разделам проекта. Новые section IDs: `tasks`, `approvals`, `seating`, `microsite`, `calendar`, `readiness`. Гостевой реестр продолжает проверяться через фактический ID его таблицы.

Отдельные дополнительные действия: `publishWeddingSite`, `manageGuestInvites`, `publishAgencySite`, `viewTeamAvailability`. Решение согласования требует `edit` в approvals и включения текущего пользователя в approverUserIds; одного имени роли недостаточно.

| Действие | Couple по умолчанию | Organizer по умолчанию | Ограниченные роли |
|---|---|---|---|
| Содержимое/структура своего проекта | Да | Да, в своей области | По действующим назначениям |
| Публиковать свою страницу свадьбы | Да, после предпросмотра | Да | Явное разрешение |
| Создавать гостевые RSVP-ссылки своего проекта | Да | Да | Явное разрешение |
| Публиковать сайт агентства | Нет | Только если назначено | Явное разрешение агентства |
| Просмотр занятости команды вне текущего проекта | Нет | Отдельное разрешение агентства | Явное разрешение |
| Голос от имени другого участника | Нет | Нет | Нет |

Обновлять встроенные роли по стабильному `roles.key`; сохранить пользовательские изменения текущих разрешений. Миграция добавляет только новые целевые действия для admin/organizer/couple согласно таблице, не восстанавливает ранее удалённые старые действия. Пользовательские роли не расширять автоматически; показать новые флажки в существующем редакторе.

Право читать план зала не даёт права видеть имена гостей, если нет read для конкретных строк/полей таблицы гостей. Для `seating.assign` требуются edit и в seating, и в изменяемых guest-полях. Условия комбинировать в их собственных областях, не собирать разрешение из несвязанных проектов.

Dashboard проверяет каждую исходную запись и поля. Не отдавать «скрытую сумму» в JSON с маской только в HTML. Calendar source URLs, количество уведомлений, export и полнотекстовый поиск проходят ту же фильтрацию.

Для назначений и согласующих отдавать только `id/name`; email/телефоны по отдельным существующим правам. Семантика «Мне»/`assigneeUserId` не меняет ACL.

## 5. Операции API

### 5.1. Общий контракт

Сохранить `POST /api/command` и формат `{id,op,projectId?,entityId?,version?,data?...}`. Клиент создаёт UUID команды один раз и сохраняет при сетевом повторе. Изменив payload после конфликта, использует новый ID. Сервер связывает ключ с пользователем и digest тела; повтор с другим телом — конфликт.

Перед возвратом сохранённого результата команды повторно проверить текущий доступ к объектам результата. После отзыва прав нельзя получить приватный старый result из таблицы идемпотентности.

Ответ успешной мутации: `{result, affected:[{id,version}], warnings?}`. Действующий формат v1 не ломать; расширять обратно совместимо или ввести явную версию. Ошибки: 400 валидация, 401 нет сессии, 403 нет права, 404 нет/не виден объект, 409 конфликт, 413 слишком большой запрос, 429 лимит. В `details` только разрешённые данные и машинный `code`.

### 5.2. Чтение

| Endpoint | Ответ / ограничения |
|---|---|
| `GET /api/dashboard?project=ID` | Проектный обзор и readiness; без project — обзор агентства |
| `GET /api/tasks?project=&from=&to=&assignee=&status=&cursor=` | Разрешённые задачи; default limit 50, max 200 |
| `GET /api/approvals?project=&cursor=` | Темы; подробности ревизии отдельным ID |
| `GET /api/approvals/:id` | Текущая ревизия/история/голоса, только с правами |
| `GET /api/calendar?from=&to=&project=&assignee=&types=` | Период обязателен, максимум 93 календарных дня |
| `GET /api/notifications?cursor=&unread=` | Текущие разрешённые уведомления пользователя |
| `GET /api/projects/:id/assignable-members` | Минимальные участники проекта |
| `GET /api/public/w/:shareId` | Только активная публичная ревизия свадьбы |
| `GET /api/public/content/:kind/:slug` | Только опубликованный материал агентства |
| `GET /api/public/assets/:id` | Только ресурс активной публикации |

GET должен быть без побочных изменений. Просмотр уведомления не помечает его прочитанным до явного действия/команды UI. Cache-Control private/no-store для персональных ответов.

### 5.3. Команды

| Группа | Операции / существенный payload |
|---|---|
| Задачи | `task.create/edit/delete/restore`, `task.setStatus`; ожидаемая version, зависимости, scope |
| Шаблон | `taskTemplate.apply` с templateId/version/projectVersion; preview изменений перед применением |
| Перенос | `POST /api/preview/project-reschedule`, `project.reschedule.apply` с newDate, projectVersion, previewDigest, sourceVersions |
| Согласования | `approval.saveDraft/publish/withdraw/vote/applyToBudget`; revisionId, optionId, expected versions |
| Комментарии | `comment.create/edit/delete` с parentId и проверкой доступа к parent |
| Гости | `guestMapping.save`; явные column IDs + schemaVersion |
| Приглашения | `guestInvite.create/revoke/rotate` с guestRowIds, guestTableId, schemaVersion, expiry |
| Зал | `seatingPlan.save`, `seatingTable.create/edit/delete`, `seating.assign/unassign` |
| Встречи | `meeting.create/edit/delete` с start/end/timeZone/assignees, версиями |
| Сайт свадьбы | `microsite.saveDraft/publish/unpublish/rotateShareId` |
| Сайт агентства | `publicContent.saveDraft/publish/unpublish/archive` |
| Напоминания | `notification.read/readAll`, `notificationPreferences.save`, `readiness.snooze` |

Общие `entity.create/edit/delete/restore` не могут обойти эти специализированные операции. Это относится и к восстановлению истории: нельзя восстановить старую цену, место или опубликованный снимок в обход согласованности текущих данных.

### 5.4. Перенос и время

Preview возвращает новый срок, старый срок, причину переноса/пропуска для каждой затронутой записи, версии проекта/задач/привязанных встреч, digest. Apply заново вычисляет тот же план в транзакции и сравнивает digest/версии. Ничего не применять частично.

В этой версии относительный якорь задач — только дата свадьбы. Зависимости задач ограничивают завершение, но не образуют отдельный граф пересчёта сроков. Это намеренно уменьшает число скрытых изменений.

Для date-only арифметики использовать календарные компоненты `YYYY-MM-DD`; UTC-конструктор допустим как нейтральный календарный калькулятор. Не переводить дату проекта в локальные сутки устройства. `today(project.timeZone)` заменяет использование единственного глобального московского today для новых функций.

Встречи хранят абсолютные startAt/endAt в UTC и исходный IANA timezone. Для неоднозначного/несуществующего локального времени при DST пользователь выбирает допустимый вариант; не корректировать час молча. Привязанная встреча пересчитывается из offsetDays + localStartTime + durationMinutes с повторной проверкой DST. Старый timing без dayOffset при end < start требует явного указания следующего дня.

## 6. Согласования и финансовая транзакция

Публикация ревизии замораживает варианты, суммы и права видимости файлов в рамках parent-проекта. Удаление приватного файла, на который ссылается действующая ревизия, сначала показывает зависимость; доступ к нему всё равно проверяется по текущим правам при каждом запросе.

В `approval.vote` проверить: принадлежность проекта, право edit, currentRevisionId, участника в approverUserIds, состояние ревизии, допустимость optionId, отсутствие отзыва. Голос и обновление итогового состояния фиксируются одной транзакцией. При `any` первое final-решение закрывает ревизию; `request_changes` тоже final. При `all` требуется совпадение одного optionId у всех.

`approval.applyToBudget` проверяет revision approved, неизменность согласованного варианта и актуальные версии selection/obligation. Применение — с правом finance и правами редактируемых полей. Если есть оплата, необходим явный финансовый предпросмотр; сумма не ниже totalPaid, сохраняется тот же obligation ID. Если изменить оплаченный объект допустимо нельзя, действие блокируется с указанием ручного исправления существующего учёта. Новую доплату не создавать автоматически.

Результат записывается в approval_budget_links, но эта таблица не хранит второй баланс. Последующая правка текущей сметы не переписывает историю того, что было согласовано; интерфейс показывает расхождение и предлагает новую ревизию.

Голос после `approval.dueDate` допустим, если ревизия всё ещё текущая, опубликованная и открытая. Дедлайн влияет на вычисляемую просрочку, а не на право голосования.

## 7. RSVP: отдельная модель доступа

1. Создание приглашения требует `manageGuestInvites` и доступа к конкретным guest rows/полям. Генерировать 32 случайных байта, хранить SHA-256 digest. Raw token возвращается только при создании/перевыпуске; повторно показать его из БД нельзя.
2. Ссылка `/w/:shareId#invite=RAW_TOKEN` не передаёт fragment в HTTP URL. Клиент делает `POST /api/public/rsvp/exchange`, удаляет fragment через replaceState после успеха.
3. Сервер выдаёт отдельную HttpOnly Secure SameSite=Strict сессию `tie_guest_session` и CSRF-защиту гостевого API. Срок сессии — до 24 часов, но не позже expiry приглашения; свежая ссылка может продлить в пределах приглашения. Аккаунт организатора/пары не перезаписывается.
4. `GET /api/public/rsvp/context` выдаёт только разрешённую группу и whitelist полей. Никаких счетчиков/имён других семей.
5. `POST /api/public/rsvp/respond` принимает commandId, inviteVersion, schemaVersion, changes[{rowId,rowVersion,values}]. Ответ за группу применяется одной транзакцией.
6. Каждый запрос заново проверяет активность страницы, invite/version/expiry/revoked, row scope и типы полей. Ротация отзывается вместе со всеми guest_sessions прежней версии.
7. Ограничения частоты exchange/respond раздельны по IP и invite digest; нейтральные ошибки без подтверждения существования фамилии/телефона. Не использовать открытый поиск по имени как аутентификацию.

Эффективная доступность context: опубликованная страница AND активные invite/session нужной версии AND `now < min(invite.expires_at, session.expires_at, microsite.closesAt если задано)`. Возможность respond дополнительно требует `now < начало следующего календарного дня после rsvpDeadline в timezone проекта`. После дедлайна context возвращает `canRespond:false` и собственный ответ без разрешения записи. При продлении дедлайна все ограничения invite/session остаются прежними; при сокращении новый предел проверяется сразу. Изменение timezone/даты не продлевает токены и дедлайн автоматически.

Гостевой actor хранить как тип `guest_invite` и ID приглашения, без фальшивого userId сотрудника. Добавить `actor_type/actor_ref` в audit совместимо со старым actor_id; подписывать историю «Ответ гостя по приглашению». Raw token, CSRF, cookies и guest payload не выводить в access/error logs.

Плюс-один — заранее созданная placeholder-row со своим ID. Ответ может заполнить её имя и разрешённые поля, но не создать новый person за пределами разрешённого числа мест. При одновременных активных приглашениях на одну строку optimistic locking общий для всех.

## 8. Смысловые поля и места

Пакетное создание столов использует `seatingTable.createMany` с commandId, planId/expectedPlanVersion и 1–20 описаниями столов. Все проверки формы, вместимости, координат и доступа выполняются до фиксации одной транзакции. Ошибка любого элемента отклоняет всю группу. PNG формируется из того же разрешённого снимка плана, что печать; без сторонних картинок, приватных полей и панели управления.


Пример mapping (ID условные; действующие поля не переименовывать):

```json
{
  "guestName": "name",
  "rsvpStatus": "status",
  "rsvpValues": {"confirmed":"Подтвердил","declined":"Отказ","tentative":"Пока не знает","unanswered":"Нет ответа"},
  "diet": "meal",
  "allergies": "allergies",
  "transfer": "transport",
  "accommodation": "hotel",
  "seatingTable": "seating_table_id",
  "seatIndex": "seat_index"
}
```

Настроить mapping мастер-формой, не только JSON. Для существующих кастомных значений показывать preview соответствий. «Приглашён»/«Не отправлено» — состояния приглашения, не confirmed/declined; миграция сохраняет их как delivery/invitation state, а rsvp переводит в unanswered, если ответа не было.

Сейчас relation в `validateRow` ссылается на row. Для стола добавить явный `targetKind=seatingTable` с scoped validation; не ослаблять все relation до произвольного entity. `seatIndex` — целое 1…capacity. Название стола в обычной таблице — вывод по stable ID; изменения направляются в `seating.assign`.

При подключении semanticMap generic row.edit разрешает безопасные поля, но защищённые RSVP/seat поля проходят общий доменный путь с побочными изменениями. Например declined освобождает место и создаёт актуальное уведомление, независимо от того, кто менял статус: гость или организатор.

Удаление занятого стола: первый запрос возвращает 409 `requiresUnassignConfirmation` со списком разрешённых затронутых строк; подтверждённая команда с их версиями атомарно снимает назначения и удаляет стол. При изменении списка — новый preview. Полная история сохраняется.

## 9. Публикации, ресурсы и маршруты

`shareId` свадьбы — случайный идентификатор минимум 128 бит, не projectId/последовательное число. «По ссылке» не означает доступ только приглашённым: сам опубликованный текст доступен любому обладателю ссылки. Имена гостей/ответы/смета туда не входят.

Публикация формирует allowlist снимок и отдельные растровые public assets из разрешённых пользователем файлов. При загрузке проверять сигнатуру/тип/размер, декодировать и пересохранять изображения без EXIF; ограничить до 12MB на исходник и 40 мегапикселей. Не позволять произвольный HTML/SVG/script iframe в полях. Rich text — ограниченная безопасная разметка или обычный текст; URL только http(s), для кнопки звонка — отдельное проверяемое phone поле.

Публичные изображения создаются как отдельные производные ресурсы, не раскрывающие private fileId и не меняющие приватный оригинал. Для каждого URL проверяется связь с действующей опубликованной ревизией. При unpublish/rotation отозвать ресурсы старой ревизии; нельзя обещать удалить копию, уже скачанную посетителем. Для свадебных assets — no-store; для публичных кейсов кеш ограничен механизмом очистки/версии при снятии публикации.

На `/w/*`: robots meta + `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`. Новая вкладка карты/внешнего сайта не получает RSVP token. Черновой preview внутри авторизованного приложения, не анонимная угадываемая ссылка.

Предлагаемая клиентская маршрутизация через History API или совместимый router без смены стека:

```text
/app/today                         /app/tasks
/app/projects                      /app/calendar
/app/projects/:id/overview          /app/projects/:id/tasks/:taskId?
/app/projects/:id/approvals/:id?    /app/projects/:id/vendors
/app/projects/:id/finance/estimate /app/projects/:id/finance/payouts
/app/projects/:id/guests            /app/projects/:id/seating
/app/projects/:id/day/pair          /app/projects/:id/day/team
/app/projects/:id/site             /app/projects/:id/tables/:id?
/app/projects/:id/files            /app/projects/:id/history
/app/projects/:id/settings         /app/content/:kind/:id?
/stories/:slug                     /services
/faq                               /w/:shareId
```

Вложенные настройки имеют явные URL: `/app/projects/:id/settings/general`, `/app/projects/:id/settings/members`, `/app/projects/:id/settings/offline`. Голый `/settings` перенаправляет на `/settings/general`. «Ещё» ведёт на эти маршруты, вкладки участвуют в Back/Forward. При отсутствии прав на участников/приглашения соответствующее действие скрыто, а прямой URL проходит серверные проверки.

Маршруты `/app/applications`, `/app/vendors`, `/app/templates`, `/app/team`, `/app/agency-finance`, `/app/settings` дополняют существующие view IDs. На переходный период сопоставить прежние `project:*` view с URL, не менять все обработчики одновременно.

Node HTTP server отдаёт app shell только для зарегистрированных app routes, не для отсутствующего API/asset. Публичные страницы агентства — серверный HTML/prerender с текстом актуальной опубликованной ревизии; неизвестный slug даёт 404, архивный — 404/410. Robots и sitemap строятся по опубликованным entities, не обходом всех роутов.

## 10. Календарь, уведомления, проверки

Общий календарь соединяет доступные source records. Каждое событие содержит `{sourceKind,sourceId,sourceVersion,projectId,start,end,allDay,displayTimeZone,allowedOps}`. Для задачи dueDate allDay=true; на занятость она не влияет. Для строк timing с ответственным текстом без mapped userId не выдумывать busy user.

Проверки возвращают `{ruleKey,state,sourceRefs,summary,reason,actionUrl,snoozedUntil,checkedAt}`. Агрегаты строятся после авторизации. Unknown при недостатке источников нельзя преобразовывать в pass с `count=0`. Проверка брони относится только к выбранным услугам, проверка договора — к явно отмеченному проектному файлу.

Уведомление и outbox создаются вместе с доменной командой в одной транзакции. Обработчик запрашивает pending записи периодически (например раз в 30 секунд), берёт короткий lease, проверяет пользователя/права/sourceVersion/generation и делает идемпотентную запись in-app. Просроченный lease разрешает восстановление после сбоя.

`dedupe_key = sourceKind:sourceId:reminderType:sourceGeneration:recipientId:occurrence:channel`. Изменение срока/получателя повышает generation и отменяет старые задания. Источник завершён/оплачен/удалён — pending отменяется. Настройки и их версия входят в проверку актуальности.

В v2 нет произвольного набора напоминаний для отдельной встречи. Используются правила REQUIREMENTS.md: для встреч 24ч/1ч, для платежей 3д/1д/день срока, для задач 1д/одна просрочка. `notificationPreferences` содержит включённые типы/каналы, `dateOnlyReminderTime` (по умолчанию 09:00 в поясе проекта), version. Изменение настройки пересоздаёт будущие occurrence через generation. «Напомнить позже» относится к личной карточке readiness, а не переносит источник или добавляет повтор финансового напоминания.

Для in-app обеспечить один логический экземпляр на dedupe key. Для внешнего email невозможно гарантировать exactly-once при потере ответа провайдера без его idempotency API: использовать поддерживаемый ключ, отдельно маркировать uncertain delivery и не обещать в отчёте гарантию, которой нет. Никогда не слать email из HTTP-транзакции, удерживающей SQLite write lock.

Текущая выдача notification фильтруется по userId и глобальной области. Для новых project notification добавить реальный project_id и проверку read источника на каждом чтении. Старые уведомления мигрировать/фильтровать так, чтобы отзыв проекта применялся и к ним.

## 11. Офлайн, производительность, зависимости

Не включать новые чувствительные mutation-команды в offline allowlist. Можно явно подготовить read-only task/approval/seat данные в permission-filtered IndexedDB, но срок годности/очистка/изоляция identity прежние. Черновики публикации и RSVP токены туда не попадают. Новые labels показывают «Для изменения подключитесь к сети».

Специализированные столбцы гостевого реестра не должны попасть в офлайн-очередь обычной row edit, обходя RSVP/seat команды. Старая очередь проходит проверку при replay и получает объяснимый конфликт, если к её таблице подключён новый защищённый mapping.

Пагинация списков, загрузка ревизии по требованию, bounded date range календаря, индекс scope/kind и анализ запросов обязательны. Не отправлять все фотографии, истории и все проекты в каждую 15-секундную синхронизацию. Для больших таблиц использовать разумную пагинацию/виртуализацию только после измерения.

| Зависимость | Нужна для v2 | Решение |
|---|---|---|
| Существующие React/Vite/Node/SQLite | Да | Сохранить версии проекта, обновления отдельно от feature |
| SVG + Pointer Events | Да, встроено в браузер | Достаточно для 2D схемы; альтернатива drag через форму |
| Обработка растровых изображений | Да, для безопасной публикации | Выбрать поддерживаемую серверную библиотеку, закрепить версию и лимиты; проверить официальный API перед реализацией |
| Date/time библиотека | По выбору исполнителя | Допустима при проверке IANA/DST; календарные правила не менять |
| SMTP/email API | Нет для in-app; да для включённого email | Изолированный adapter и закрытая конфигурация |
| Redis/внешний брокер | Нет | SQLite outbox + lease достаточно для текущего масштаба |
| Google Maps/Yandex API | Нет | Проверенная внешняя ссылка; API-ключ не требуется |
| PDF-сервис | Нет | Печатный CSS + browser print/save PDF |
| Библиотека 3D/платный календарь | Нет | В объём не входят |

Не изменять общий `node_modules` другого проекта, если здесь используется симлинк. Для новых зависимостей сделать собственную установку в tie.event с lockfile; не запускать команду, меняющую целевой каталог чужого проекта.

## 12. План файлов и работа программистов

Рекомендуемые новые модули:

```text
server/tasks.mjs             server/approvals.mjs
server/guests.mjs            server/seating.mjs
server/publication.mjs       server/calendar.mjs
server/notifications.mjs     server/readiness.mjs
src/ui/ProjectOverview.jsx   src/ui/AgencyToday.jsx
src/ui/TaskWorkspace.jsx     src/ui/ApprovalWorkspace.jsx
src/ui/GuestWorkspace.jsx    src/ui/SeatingWorkspace.jsx
src/ui/CalendarWorkspace.jsx src/ui/NotificationCenter.jsx
src/ui/MicrositeEditor.jsx   src/ui/PublicContentEditor.jsx
src/public/WeddingPage.jsx   src/public/AgencyPages.jsx
```

Имена — навигация для реализации, не требование бессмысленно дробить любой код. Сложные валидаторы/правила тестировать вне JSX. Общие form fields, buttons, dialogs, empty/error states использовать из существующего UI или выделить единообразно.

| Исполнитель / поток | Разрешённая зона | Зависит от |
|---|---|---|
| Интегратор | миграции, permissions, service/http, маршруты, общие контракты | baseline и согласованный DTO |
| План/календарь | tasks, calendar, соответствующий UI/tests | права/время; далее outbox |
| Согласования | approvals, comparison UI/tests | файлы и текущая selection/obligation интеграция |
| Гости/рассадка | guests, seating, UI/tests | semanticMap, scoped guest access |
| Публикации | publication, публичные страницы/редакторы/tests | безопасные assets, финальный публичный DTO |
| Обзор/уведомления | readiness, notifications, overview UI/tests | все источники, разрешения и версии |

Интегратор мержит адаптеры центральных файлов после проверки; нельзя одновременно независимо переписывать `service.mjs`, `main.jsx` и `styles.css` из нескольких рабочих копий. Приложенные документы не разрешают стирать текущие незакоммиченные правки.

## 13. Миграция и сдача

1. До изменения схемы создать согласованную backup-копию собственной SQLite-БД; сохранить WAL корректно. На копии проверить исходные counts/ID/финансовые итоги.
2. Зафиксировать текущую схему и последнюю migration version; новая миграция атомарна и имеет метку завершения. Не пересоздавать `entities` с другими ID.
3. Добавить новые таблицы/метаданные с нейтральными default. Новые задачи в существующие свадьбы автоматически не создавать; применяет пользователь через preview.
4. Старые гостевые столы/статусы преобразовать только через явный мастер. Ошибочные значения остаются видимыми для исправления.
5. Старый публичный контент сохранить как действующий снимок, новые структуры импортировать в черновики. Не публиковать приватные изображения без подготовки.
6. Прогнать прежние domain/runtime/browser сценарии и соответствующие AC-01…47 из REQUIREMENTS.md. Проверить повторный запуск миграции.
7. Для отката подготовить совместимую пару «код + backup БД»; не запускать старую версию поверх изменённой БД без проверки совместимости.

Приёмка включает реальные операции в браузере: две отдельные сессии пары, координатор с ограниченными правами, анонимный RSVP, одновременное место/голос/перенос, offline regression, публикация и отзыв. Макет `prototype.html` служит только визуальным ориентиром и не заменяет эти проверки.

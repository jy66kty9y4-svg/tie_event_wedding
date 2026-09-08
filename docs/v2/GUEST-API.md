# Гости и рассадка — API v2

Модуль: `server/v2/guest/index.mjs`. Корень приложения вызывает `migrate(db)` в общей транзакции миграции и добавляет `operations` в центральный диспетчер через `executeModule`. Все команды работают только онлайн и возвращают синхронный JSON.

## Сопоставление реестра

`guestMapping.save` принимает `{ projectId, guestTableId, schemaVersion, data:{ semanticMap }, confirm }`. `semanticMap` хранится в `table.data.semanticMap`; это единственный источник связи RSVP и рассадки с полями существующей таблицы.

| Ключ | Значение |
| --- | --- |
| `guestName` | имя гостя |
| `rsvpStatus` | `unanswered`, `confirmed`, `declined`, `tentative`; `rsvpValues` хранит точные старые значения select/text |
| `diet`, `allergies`, `transfer`, `accommodation`, `contact`, `comment` | необязательные поля формы |
| `invitationStatus` | отдельный статус выдачи ссылки |
| `seatingTable` | relation с `targetKind: seatingTable` |
| `seatIndex` | целое место `1…capacity` |

`validateGuestSchemaMutation(beforeTable, afterTable, {confirm})` предназначен для корневого generic schema path. Он возвращает `guestMappingRebindRequired`, пока удаление/смена типа или новое сопоставление подключённого поля не подтверждено. `validateGuestRowMutation(table, before, after, changedKeys)` блокирует обычный `entity.edit` подключённых RSVP/seat-полей с `guestMappedFieldProtected`; root обязан применять его и на replay старой offline очереди. Для relation стола root расширяет `validateRow` только явным `targetKind='seatingTable'`, не ослабляя обычные relation.

## Авторизованные команды

- `guestInvite.create`: `{ guestTableId, schemaVersion, guestRowIds, plusOneRowIds?, expiresAt }`; raw token бывает только в результате создания.
- `guestInvite.revoke`: `{ inviteId, version }`; удаляет все guest sessions.
- `guestInvite.rotate`: тот же scope/версии, отзывает старый token и создаёт новый с теми же строками.
- `guest.rsvp.set`: рабочий специализированный путь для RSVP организатора; принимает `schemaVersion`, row version и `{values}`. `declined` снимает место в этой же транзакции.
- `seatingPlan.save`: создаёт/изменяет `{ name,widthM,heightM,scale,zones,guestTableId }`.
- `seatingTable.create`, `.createMany`, `.edit`, `.delete`: проверяют границы, вместимость 1–30, версии и атомарный delete-preview `requiresUnassignConfirmation`.
- `seating.assign` и `.unassign`: меняют только mapped row поля, не допускают declined и двойное место. Пересадка освобождает прежнее место в той же транзакции.
- `seating.legacyImport`: принимает явный preview старой текстовой колонки, подтверждённую вместимость каждого стола и актуальные версии строк. Создаёт tables/assignments атомарно и сохраняет первоначальные значения в `plan.data.legacyImport`; вместимость никогда не выводится молча из числа старых строк.

`guestList(db,user,projectId,guestTableId,{offset,limit,rsvp,invited})`, `guestInvites(db,user,projectId,guestTableId)`, `legacySeatingPreview(db,user,projectId,guestTableId,columnId)` и `seatingSnapshot(db,user,projectId,planId)` — чистые GET helpers. Каждый сначала перечитывает current user, затем применяет project/row/field checks; скрытые поля не попадают ни в `data`, ни в RSVP/seat/invite aggregates. Корень отдаёт их как `GET /api/v2/guests`, `/invites`, `/legacy-preview` и `/seating`.

## Публичный RSVP

Корень монтирует pure handlers:

1. `exchange(db,{shareId,token,ip})` принимает token только из URL fragment, создаёт отдельные 24h (не позже invite expiry) `tie_guest_session` + CSRF cookie. Установите HttpOnly, Secure, SameSite=Strict; raw token нельзя журналировать или хранить в browser storage.
2. `context(db,{shareId,sessionToken,csrfToken})` возвращает только строки `guest_invite_rows`, whitelist полей и `canRespond`.
3. `respond(db,{shareId,sessionToken,csrfToken,commandId,inviteVersion,schemaVersion,changes})` является одной SQLite транзакцией, проверяет актуальную публикацию, срок страницы/ссылки/RSVP, scope и optimistic row versions. Идемпотентность хранится в `guest_commands` на invite.
4. `revoke(db,user,body)` — оболочка авторизованного revoke.

Microsite из publication worker обязан быть доступен как project `microsite` entity с `{shareId,status:'published',publishedRevisionId,rsvpDeadline,closesAt}`. Неактивная публикация, отозванная/истекшая ссылка и закрытая страница дают нейтральную 404 без данных семьи. После RSVP deadline context остаётся read-only до invite expiry.

Для уведомления root вызывает `configureGuestHooks({onRespond})`. Хук выполняется **синхронно внутри той же RSVP transaction** с `(db, {actorType:'guest_invite',actorRef:inviteId,inviteId}, projectId, affectedRows, commandId)` и записывает durable outbox для `leadOrganizerUserId`; promise запрещён. Guest audit получает `actor_type='guest_invite'`, `actor_ref=inviteId`.

## Клиент

`src/v2/guest/Workspace.jsx` экспортирует `GuestMappingWizard`, `GuestWorkspace`, `SeatingWorkspace`, `PublicRsvp`. Компоненты принимают contract `{state, projectId, run, refresh, navigate}`; `run` сохраняет idempotent command ID на повтор. Стили локально префиксованы `v2-guest-`/`v2-seat-`/`v2-rsvp-`; canvas имеет button-first keyboard/mobile fallback, а печать исключает private RSVP fields.

# tie.event v2 — фактические заметки проверки

Дата проверки: 8 сентября 2026. Проверка выполнена локально на Node.js 24.19.0. Документ разделяет серверные доказательства и фактически записанный браузерный прогон; непроверенные действия не считаются выполненными.

## Миграция и чистая установка

`tests/v2-integration.test.mjs` открывает только временные SQLite-копии через `node:sqlite.backup()`. Исходные файлы `data/backups/v1-20260908-222859/*.sqlite` открываются read-only и после теста повторно сравниваются с исходным снимком.

| Копия | V1 до открытия | После миграций 4–6 | Повторное открытие |
|---|---:|---:|---:|
| `tie.sqlite` | 0 entities / 0 audit | 0 / 0 | 0 / 0 |
| `demo.sqlite` | 52 entities / 54 audit | 55 / 57 | 55 / 57 |

Три добавленные записи demo — ожидаемые черновики legacy public import и соответствующие audit-записи. Тест проверяет сохранение каждого исходного entity ID, родителя, области, версии, deletion state и каждого прежнего поля JSON; исходные audit-строки сравниваются целиком по прежним колонкам. Финансовые итоги по каждой свадьбе и агентству сравниваются до/после: agreed, planned, unknown, paid, due, custody, holders, income и expense. Второе `openDatabase()` не меняет counts, ID, ledger, audit или migration markers.

Новая временная база до bootstrap не содержит агентств. После bootstrap в ней есть только редактируемый шаблон и категории агентства; отсутствуют project, application, selection, obligation и movement. Все финансовые итоги равны нулю. Это автоматизированное доказательство AC-41 и AC-42; production-БД тест не изменяет.

## Сквозные серверные проверки

Новый интеграционный тест проходит через центральный `server/service.mjs:execute`, а не через обходные прямые operation maps:

- точечно разрешённый task DTO содержит `title`, но не description, dueDate или другие закрытые поля;
- повтор уже выполненного `task.setStatus` после отзыва grant снова проходит текущую авторизацию и получает 403;
- generic `entity.edit` даты свадьбы и restore старой даты получают 409 и требуют reschedule preview;
- `guestInvite.create` возвращает raw token только первому вызову, а `commands.result` хранит redacted результат без токена;
- `timing.configure` помечает draft сайта dirty, сохраняя прежний `publishedRevisionId` и неизменный публичный снимок.

## Фактический браузерный прогон

Полный серверный прогон `node --test tests/*.test.mjs`: **77/77 PASS**. Production build Vite: PASS. Повторно прошли четыре прежних Chrome-скрипта: `browser-test.mjs`, `ui-test.mjs`, `management-ui-test.mjs`, `offline-ui-test.mjs`. Они проверяют холодный офлайн-перезапуск, выплаты, синхронизацию, конфликты схемы/прав/устройств, изоляцию аккаунтов, таблицы и заявки.

`scripts/v2-browser-test.mjs`: **12/12 PASS**, `failures:[]`, `unexpectedBrowserErrors:[]`. Отдельные ожидаемые HTTP 409 и 403 записаны как проверяемые конфликты/отзыв. Артефакты: `test-results/v2/results.json`, `errors.json`, `seating-desktop-1440.png`, `seating-mobile-390.png`, `seating-print.pdf`, `seating-print-page-1.png`, `public-desktop.png`, `public-mobile-390.png`.

Фактически выполнены: выбор стола клавиатурой, посадка/снятие через UI, reload, пересадка той же строки в обычной таблице с `guest.row.edit` и актуальной `tableVersion`, Back/Forward, Tab внутри модального окна, Escape и возврат фокуса. Печать A4 создаёт PDF с планом и отдельным полным списком 500 гостей, повторяемым `thead`, датой/версией и без контактов. В интерфейсе доступны A4/A3. На схеме длинные имена сокращаются; в списке печатаются полностью.

Большой набор содержит 500 гостей, 60 столов, 300 задач и 101 согласование. Пагинация проверена; конкретные измеренные задержки чтения сохраняются в `results.json` (локальный прогон, не производственный SLA). При одновременном отображении 60 плотно расположенных столов подписи на небольшом холсте компактны: используйте масштаб/прокрутку и индивидуальные позиции. Экспорт и отдельный список сохраняют читаемые подписи.

`flow-report.json` дополнительно фиксирует сохранение задачи после reload, корректные заголовки основных проектных маршрутов и отсутствие overflow на 320, 390, 768 и 1280 px. `scripts/v2-entry-test.mjs`: **PASS**, отчёт `test-results/v2/entry-results.json` и снимок `dashboard-network-error.png`. Проверены переход из опубликованного контента через вход и сохранённую заявку, одобрение одного проекта, ошибку сети сводки и постоянное меню.

## Карта критериев приёмки

Статус «автотест» означает наличие конкретной серверной проверки. Он не заменяет визуальную или браузерную проверку там, где критерий описывает UI.

| AC | Доказательство | Фактическая граница |
|---|---|---|
| AC-01 | `domain.test.mjs`, `v2-workflow.test.mjs` | CRUD/structure/finance проверены сервером; UI отдельно |
| AC-02 | `domain.test.mjs`, `v2-integration.test.mjs` | Проектные, строковые и полевые ограничения без утечки |
| AC-03 | `v2-workflow.test.mjs` | Повтор версии шаблона не создаёт дубликаты |
| AC-04 | `v2-workflow.test.mjs` | Просроченная рассчитанная дата сохраняется |
| AC-05 | `v2-workflow.test.mjs`, `v2-integration.test.mjs` | Preview/apply и запрет generic date edit/restore |
| AC-06 | `v2-workflow.test.mjs` | Stale preview возвращает 409 без частичного применения |
| AC-07 | `v2-workflow.test.mjs` | Циклические зависимости отклоняются |
| AC-08 | `v2-workflow.test.mjs` | Блокирующие предшественники перечисляются |
| AC-09 | `v2-workflow.test.mjs` | `any` фиксирует один итог, конкурент получает 409/current |
| AC-10 | `v2-workflow.test.mjs` | Разные голоса `all` дают discussion, не approved |
| AC-11 | `v2-workflow.test.mjs` | Новая ревизия отделена от прежних голосов |
| AC-12 | `v2-workflow.test.mjs` | Apply-to-budget идемпотентен, payment не создаётся |
| AC-13 | `v2-workflow.test.mjs` | Цена ниже paid отклоняется, движения сохраняются |
| AC-14 | `v2-publishing.test.mjs`, `v2-guest.test.mjs` | Анонимно доступен только опубликованный snapshot/assets |
| AC-15 | `v2-publishing.test.mjs`, `v2-integration.test.mjs` | Timing/date помечают dirty, публикация неизменна |
| AC-16 | `v2-publishing.test.mjs`, `v2-guest.test.mjs` | Unpublish закрывает страницу/resources/guest input |
| AC-17 | `v2-guest.test.mjs`, browser `results.json` | Меняются только строки invitation membership; RSVP сохраняется после reload |
| AC-18 | `v2-guest.test.mjs` | Чужая строка/проект отклоняются без данных |
| AC-19 | `v2-guest.test.mjs`, `v2-calendar.test.mjs`, browser `results.json` | Rotate/revoke инвалидируют token/session |
| AC-20 | `v2-guest.test.mjs`, browser `results.json` | Command dedupe и stale RSVP 409 без overwrite |
| AC-21 | `v2-guest.test.mjs` | Semantic mapping использует column ID |
| AC-22 | `v2-guest.test.mjs`, `v2-timing.test.mjs` | Удаление/тип требуют явного rebind/disable |
| AC-23 | `v2-guest.test.mjs`, browser `results.json` | Две guest sessions не занимают одно место |
| AC-24 | `v2-guest.test.mjs` | Decline/delete освобождают; restore не отбирает место |
| AC-25 | `v2-guest.test.mjs`, `TableWorkspace.jsx` | Chrome: посадка, снятие и пересадка через обычный реестр с проверкой одной строки в обоих видах |
| AC-26 | `v2-guest.test.mjs` | Preview, вместимость и originalValues проверены |
| AC-27 | Chrome `results.json`, `seating-print.pdf` | PDF A4: большой план/список, повторяемый заголовок, версия/дата, без контактов; селектор A4/A3 |
| AC-28 | `v2-calendar.test.mjs` | Смежность, полночь/DST и UTC-зоны проверены |
| AC-29 | `v2-calendar.test.mjs` | Paid debt отменяет pending reminder/calendar projection |
| AC-30 | `v2-calendar.test.mjs` | Повтор scheduler/processor не дублирует notification |
| AC-31 | `v2-calendar.test.mjs`, `v2-integration.test.mjs` | Текущие grants проверяются до delivery/read/replay |
| AC-32 | `v2-calendar.test.mjs` | Email disabled/not configured; внешний provider не подключён |
| AC-33 | `v2-publishing.test.mjs` | Private file ID не входит в публичную ревизию |
| AC-34 | `domain.test.mjs`, `v2-publishing.test.mjs` | Source IDs и один project — сервер; вход/ввод/повторное открытие — `v2-entry-test.mjs` |
| AC-35 | `v2-publishing.test.mjs`, migration integration | Legacy import создаёт черновики и сохраняет published snapshot |
| AC-36 | `domain.test.mjs`, `runtime.test.mjs` | Старый offline scope и запрет V2 offline команд автоматизированы |
| AC-37 | `v2-calendar.test.mjs` и UI error states | Chrome перехват 503 для dashboard: видна ошибка, отсутствует ложное сообщение об отсутствии проблем |
| AC-38 | Source-route paths; browser `flow-report.json` | Save/reload, гостевой/проектные прямые URL, Back/Forward проверены; каждое возможное сочетание deep links не перебиралось |
| AC-39 | Browser `flow-report.json` | Overflow: 320/390/768/1280; рассадка без drag; Tab/Escape и возврат фокуса проверены Chrome |
| AC-40 | `v2-publishing.test.mjs`, `domain.test.mjs` | Escaping, URL и public asset validation проверены сервером/SSR |
| AC-41 | `v2-integration.test.mjs` | Реальные V1 backup-копии, IDs/ledger/history/reopen |
| AC-42 | `v2-integration.test.mjs` | Чистая установка без клиентов/проектов/денег |
| AC-43 | `v2-calendar.test.mjs` | Пустые проверки и unknown prices не дают ложный pass |
| AC-44 | `v2-calendar.test.mjs` | Snooze персонален, скрывает до срока и возвращает после |
| AC-45 | Browser screenshots и route headings | `v2-entry-test.mjs`: меню остаётся при agency → project; desktop/mobile screenshots |
| AC-46 | `v2-guest.test.mjs` | Новый RSVP deadline применяется без продления invite expiry |
| AC-47 | `domain.test.mjs`, `v2-integration.test.mjs` | Ограничения и отзыв действуют сразу; full couple role сохраняется |

## Внешние настройки и границы

Проверки выполнены локально на изолированных вымышленных данных и копиях V1. Домен, реальные публичные материалы агентства и внешняя email-доставка отдельно не настраивались. Публикация в интернете не выполнялась. Email остаётся `not_configured`, без ложного подтверждения отправки.

Формальное закрытие Orda не заявляется: неизменяемая квитанция гостевой ветки сохранила прежний merge SHA. Исходники всех веток интегрированы, проверки проведены независимо. Подробность и точные SHA — `knowledge/components/v2-runtime.md`; квитанции не подменялись.

# Сервер tie.event

Опубликовано 9 сентября 2026 (МСК): https://tie-event.cabinpxrn.ru/

- Сервер: `ssh ptitsa-plus`, IP `130.17.11.158`.
- DNS: `A tie-event → 130.17.11.158`, авторитетные серверы REG.RU.
- Приложение: `/opt/tie-event/compose.yaml`, контейнер `tie-event`, образ `tie-event:visual-ba84151`.
- Исходники релиза: `/opt/tie-event/releases/visual-ba84151`.
- Image digest: `sha256:9187a80e04056b0a5a5c7b525dbbdd962ed6b364a8a4e441e841e18b29a3b458`.
- SHA256 архива: `0fae998fd15e37f079c93fee31c5cebefcddc0ade3790ef1eec63e68c57b126d`.
- Данные: отдельный внешний Docker volume `tie-event-data`, SQLite `/data/tie.sqlite`. Первый администратор создан до открытия домена. Демонстрационные клиенты, проекты и деньги не переносились.
- Локальный файл доступа: `data/production-credentials.txt`, режим 0600, исключён из Git. Не копировать пароль в README, образ, логи или команды запуска.

## Изоляция и запуск

Контейнер работает от пользователя node, с read-only root filesystem, отдельным writable `/data`, временным `/tmp`, лимитом памяти 384 MB, без Linux capabilities. Внешний порт приложения не опубликован: Caddy обращается к `tie-event:4173` через существующую proxy-сеть.

Локальный `startServer()` по-прежнему слушает только localhost. Docker явно включает `TIE_ALLOW_REMOTE=1` и `HOST=0.0.0.0`. Это разрешение нужно только для внутреннего контейнерного порта.

Состояние и логи:

```sh
ssh ptitsa-plus
cd /opt/tie-event
docker compose ps
docker compose logs --tail=60 app
```

Перезапуск только приложения:

```sh
cd /opt/tie-event
docker compose up -d
```

Обновление: собрать новый уникальный image tag, проверить его отдельно, создать согласованный SQLite backup, заменить `TIE_IMAGE` в `/opt/tie-event/.env` и выполнить `docker compose up -d`. Не использовать `docker compose down -v`, не удалять volume и не перезаписывать файлы работающей SQLite.

## HTTPS и сохранение соседних сайтов

В общий Caddyfile добавлен только блок `deploy/Caddyfile.fragment`. Перед записью кандидат проверен `caddy validate` через stdin, сравнен текущий файл для защиты от параллельной правки; применён reload без остановки соседних контейнеров. TLS-сертификат получен у Let's Encrypt; проверены TLS 1.3 и полноценная проверка сертификата браузером/curl.

Действующий Caddyfile: `/opt/ptitsa-plus-releases/20260904T6f38c93/deploy/cloud/Caddyfile`.

Резервная копия до нового блока: `/opt/tie-event/backups/Caddyfile-20260908T205907Z`.

- SHA256 до: `91ef670cda8a4ede74900fb1f35dea624df6e36a59d5093b854428ed991b7e84`.
- SHA256 после: `01753bf88e4c74d6135b9fe9b33a627f7ee6e6a77d458db83371aa667e2785d0`.

Не восстанавливать эту копию поверх будущих изменений других сайтов. При откате маршрута сначала сравнить актуальный Caddyfile; удалить только блок tie.event, проверить кандидат и выполнить reload. Базу сохранить.

## Резервная копия и проверка

Первый согласованный backup через `node:sqlite.backup()`:
`/opt/tie-event/backups/tie-first-release.sqlite`, права 0600. Создан после запуска новой базы; live-файл не копировался отдельно от WAL.

`deploy/verify-live.mjs` проверяет реальный опубликованный домен: TLS, вход администратора через UI, Secure/HttpOnly cookie, существующие проекты, desktop-маршруты, цвета кнопок, геометрию и mobile 390/320px. Пароль читается из локального файла, не печатается. Артефакты: `test-results/live/verification.json`, `dashboard-1440.png`, `dashboard-390.png`, `dashboard-320.png` и скриншоты проектных маршрутов.

Соседние сайты до/после reload: `gutv.tech` 200, `event.gutv.tech` 200, `money.gutv.tech` 307, `admin.cabinpxrn.ru` 401, `pticaplus.tech` 200. Сервис tie-event: healthy, restart count 0 на момент сдачи.

Внешняя email-доставка не подключена. Приглашения передаются ссылками. Реальные материалы агентства публикуются через редактор после их добавления владельцем.

## Визуальное обновление 9 сентября 2026

Коммит приложения: `ba84151`. Релиз исправляет пять замечаний из визуальной проверки. Подробности: `docs/v2/VISUAL_FIXES_2026-09-09.md`.

Перед переключением создан согласованный backup `/opt/tie-event/backups/before-visual-ba84151.sqlite` с правами 0600. Новый образ отдельно проверен с временной базой, без сети и рабочего тома: health, защищённый API, HTML/assets и Sharp.

После запуска: healthy, 0 рестартов; HTTPS 200. Браузерная проверка настоящего входа, кнопок задач/согласований и существующего проекта прошла на 1440/390/320 px. Контрольные суммы всех 17 проверенных бизнес-таблиц совпали до/после; в `entities` сохранились 20 записей. Файл Caddy и ответы соседних сайтов совпадают с указанной выше базой.

Предыдущий рабочий образ для отката: `tie-event:v2-f80f40b`; предыдущая `.env`: `/opt/tie-event/backups/env-before-visual-ba84151`. Откат интерфейса выполняется переключением образа, без восстановления старой базы поверх новых пользовательских записей.

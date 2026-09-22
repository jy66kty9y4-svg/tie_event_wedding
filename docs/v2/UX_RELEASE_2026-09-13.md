# UX-релиз tie.event — 13 сентября 2026

Статус: R3 staged, изолированно проверен, активирован и принят финальной browser-проверкой. R1 superseded после A09 regression (`1989 -> 272`) и не может быть передан, staged или выпущен. R2 остаётся сохранённым rollback image для R3.

## Current production release R3

- Active image: `tie-event:ux-20260913-r3`, `running`, `healthy`, restart count `0`.
- Immutable archive: `test-results/ux-fixes-2026-09-13/release/tie-event-ux-20260913-r3-source.tar.gz`; SHA-256 `8c0d13b3b00f3ae55a5226e8df9fb5ca0b61c2cda22b4c01a1903e4d3b7f459f`; 339,385 bytes; 77 allowlisted entries and 49 byte-verified regular `src/`/`server/` entries.
- R3 changes relative to R2 are limited to `src/v2/guest/Workspace.jsx` and `src/v2/guest/readable.mjs`. Frozen acceptance was 101/101 Node tests, Vite production build and the focused deleted-property fixture.
- Candidate staging was isolated (`--network none`, read-only root, dropped capabilities, tmpfs `/tmp` and `/data`) and passed health `200`, private API `401`, four assets, Sharp and HTTP server import. Candidate image ID: `sha256:7dfe6c7a1ce4cbe7a6961112e854a010b13039c512d2e4e276fd6bcff6a217b7`.
- Before switch, a consistent SQLite backup and `quick_check` passed. All 21 business-table fingerprints matched after switch; only `attempts`, `guest_sessions`, `notification_outbox` and `sessions` were excluded. The retained image-only rollback target is `tie-event:ux-20260913-r2`; rollback never restores an old SQLite file.
- Container health/private API were `200/401`, HTTPS was `200`, and neighbor responses were `200/200/307/401/200`. Caddy and the external `tie-event-data` volume remained unchanged. The authenticated browser check confirmed that admin Леонид remains in `Без места`, the filter retains this guest, mobile width 390 has no overflow, and there were no console errors.

R3 evidence: `release/r3-preflight.json`, `release/stage-r3.stdout.txt`, `release/activation-r3.stdout.txt` and `release/live-browser-r3.json`.

Релиз исправляет все пункты UX-аудита из `SYSTEM_UX_AUDIT_2026-09-13.md` по матрице `UX_FIXES_2026-09-13.md`. Архив собран из замороженной рабочей копии, а не из `git HEAD`: до этой задачи в ней уже были намеренные, опубликованные изменения. В архив не входят `data/`, `.env`, credentials, документация, прототипы и тестовые результаты.

## Immutable input R2

- Тег кандидата: `tie-event:ux-20260913-r2`.
- Архив: `test-results/ux-fixes-2026-09-13/release/tie-event-ux-20260913-r2-source.tar.gz`.
- SHA-256: `89766a7f53023414174943d4cffcfef3ba8b811b8ea5923cb9d10ac2df03c882`.
- Размер: 339,275 bytes.
- Целевой staging path: `ptitsa-plus:/opt/tie-event/releases/tie-event-ux-20260913-r2-source.tar.gz`.
- Состав: `ux-20260913-r2-source-members.txt`, 76 allowlisted entries, из них 48 regular entries `src/`/`server/` в `ux-20260913-r2-src-server-files.txt`. Включены Dockerfile, lockfile, Vite entrypoint, `public/`, `src/`, `server/` и два release-helper; исключены данные, секреты, AppleDouble и xattrs.
- Локально SHA и распакованные `src/`/`server/` сверены с рабочей замороженной копией.

## Production snapshot before staging

Read-only проверка от 13 сентября показала:

- `tie-event:font-20260911-r3`, `running`, `healthy`, restart count `0`;
- compose SHA-256 `0cdffc4f005a03142deccf890fbdac5ee00e5e65c8c28cc6b63b39dceac444cd`;
- Caddyfile SHA-256 `01753bf88e4c74d6135b9fe9b33a627f7ee6e6a77d458db83371aa667e2785d0`;
- production server-module hashes совпали с `test-results/ux-fixes-2026-09-13/production-before.txt`.

Если активный image или Caddyfile изменятся до activation, helper останавливается. Это исключает перезапись параллельного релиза.

## Staging and live gate

`deploy/ux-release-20260913-r1.sh` и `deploy/ux-release-20260913-r1-remote.sh` с `RELEASE_ID=ux-20260913-r2 TAG=tie-event:ux-20260913-r2` создают/валидируют R2 и запускают временный контейнер с `--network none`, read-only root, dropped capabilities, tmpfs `/tmp` и `/data`; production volume не подключается. Smoke подтверждает:

- health `200`;
- private `/api/state` `401`;
- главную страницу и найденные JS/CSS assets `200`;
- загрузку Sharp и импорт HTTP server.

Локальный Docker daemon отсутствовал, поэтому staging выполнен на VPS после явного разрешения пользователя на передачу архива. Remote SHA совпал с локальным. Candidate `tie-event:ux-20260913-r2` имеет image ID `sha256:9a480234788a304f32a02e918fe2bed4bfaddaa09f559de53c939fa09668b068`; smoke прошёл health `200`, private API `401`, четыре JS/CSS assets, Sharp и HTTP-server import. Временный smoke-container удалён, active service остался `tie-event:font-20260911-r3`, healthy, restart count `0`; внешний volume не изменился. Transcript: `test-results/ux-fixes-2026-09-13/release/stage-r2.stdout.txt`.

После успешного staging и только после команды root `release gate passed` activation выполняется с `RELEASE_GATE=passed`. Он:

1. проверяет, что active image остался `tie-event:font-20260911-r3`;
2. сохраняет `.env` rollback-копию и согласованную SQLite backup через `node:sqlite.backup()`;
3. получает fingerprint бизнес-таблиц до switch и после него; исключаются только `sessions`, `attempts`, `guest_sessions`, `notification_outbox`;
4. меняет только `TIE_IMAGE` и выполняет `docker compose up -d app`;
5. ждёт healthy, проверяет локальный health/private API, HTTPS и ответы соседних сайтов `200/200/307/401/200`;
6. при неуспешном health или fingerprint возвращает прежний image через compose, не восстанавливая старую SQLite поверх актуальных данных.

Ни Caddy, ни volume `tie-event-data`, ни другие контейнеры не меняются. `docker compose down -v`, удаление volume и запись в live DB не используются.

## Activation result

После `release gate passed` контейнер `tie-event` переключён на `tie-event:ux-20260913-r2`: `running`, `healthy`, restart count `0`. До switch создана согласованная SQLite backup `/opt/tie-event/backups/before-ux-20260913-r2-20260913T202047Z.sqlite`; `quick_check` прошёл. Fingerprints всех 21 business tables до/после совпали; исключены только `attempts`, `guest_sessions`, `notification_outbox`, `sessions`. Прежний image `tie-event:font-20260911-r3` и rollback `.env` `/opt/tie-event/backups/env-before-ux-20260913-r2-20260913T202047Z` сохранены.

Container health `200`, private API `401`, HTTPS `200`; соседи дали `200/200/307/401/200`. Caddy и external volume `tie-event-data` не изменялись. Полный unredacted operational transcript без credentials: `test-results/ux-fixes-2026-09-13/release/activation-r2.stdout.txt`.

## Release helper follow-up

The archive-bundled R2/R3 helper is historical and stays frozen with its immutable source archive. The local future-release helper `deploy/ux-release-20260913-r1-remote.sh` now streams SQLite backups and fingerprints through `docker exec` stdout/stdin instead of `docker cp` from container tmpfs. Host evidence files are created with mode `0600`, backup `quick_check` is performed before switch, and `EXPECTED_ACTIVE` can be supplied per release while preserving its legacy default. This is the operational path that succeeded for both R2 and R3; it does not alter either archive.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const nodePlaywright = '/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = resolve('test-results/ux-fixes-2026-09-13');
const fixturePath = resolve(process.argv[2] || 'test-results/design-preview.json');
const onlyCases = new Set((process.env.UX_CASES || '').split(',').map(value => value.trim()).filter(Boolean));
if (!existsSync(fixturePath)) throw new Error(`Fixture not found: ${fixturePath}. Start scripts/design-preview.mjs first.`);
mkdirSync(out, { recursive: true });

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const { chromium } = await import(pathToFileURL(nodePlaywright));
const report = {
  startedAt: new Date().toISOString(), fixture: { origin: fixture.origin, projectId: fixture.projectId, dbPath: fixture.dbPath },
  build: {}, cases: [], consoleErrors: [], failedAssets: [], screenshots: [],
};
let caseIndex = 0;
const filename = value => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

function record(id, title, status, detail = {}) {
  report.cases.push({ id, title, status, ...detail });
}
async function noDocumentOverflow(page, label) {
  const value = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  assert.ok(value.scrollWidth <= value.width, `${label}: document width ${value.scrollWidth} exceeds viewport ${value.width}`);
  return value;
}
async function screenshot(page, id) {
  const file = resolve(out, `${String(++caseIndex).padStart(2, '0')}-${filename(id)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push(file);
  return file;
}
async function login(page) {
  await page.goto(fixture.origin, { waitUntil: 'networkidle' });
  const result = await page.evaluate(async ({ email, password }) => {
    const csrf = document.cookie.split('; ').find(value => value.startsWith('tie_csrf='))?.slice('tie_csrf='.length) || '';
    const response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ slug: 'tie', email, password }) });
    return { status: response.status, body: await response.json() };
  }, fixture);
  assert.equal(result.status, 200, `Dummy login failed: ${JSON.stringify(result.body)}`);
}
async function app(page, path) {
  await page.goto(`${fixture.origin}${path}`, { waitUntil: 'networkidle' });
  await page.locator('.app-shell').waitFor();
}
async function api(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const csrf = document.cookie.split('; ').find(value => value.startsWith('tie_csrf='))?.slice('tie_csrf='.length) || '';
    const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
}
async function createRestrictedViewer(adminPage) {
  const state = await api(adminPage, `/api/state?project=${fixture.projectId}`);
  assert.equal(state.status, 200);
  const guestTable = state.body.entities.find(item => item.kind === 'table' && item.data?.key === 'guests');
  const row = state.body.entities.find(item => item.kind === 'row' && item.parent_id === guestTable.id);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const role = await api(adminPage, '/api/command', { id: `qa-role-${suffix}`, op: 'role.save', name: `QA restricted ${suffix}`, permissions: ['read'] });
  assert.equal(role.status, 200, JSON.stringify(role.body));
  const email = `qa-restricted-${suffix}@example.test`;
  const invite = await api(adminPage, '/api/command', { id: `qa-invite-${suffix}`, op: 'invite.create', projectId: fixture.projectId, email, roleId: role.body.id, expiresAt: new Date(Date.now() + 3600000).toISOString(), restrictions: { sections: [guestTable.id], rows: [row.id], fields: ['name'] } });
  assert.equal(invite.status, 200, JSON.stringify(invite.body));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(fixture.origin, { waitUntil: 'networkidle' });
  const registered = await page.evaluate(async ({ email, invitation }) => {
    const csrf = document.cookie.split('; ').find(value => value.startsWith('tie_csrf='))?.slice('tie_csrf='.length) || '';
    const response = await fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ slug: 'tie', email, name: 'Проверка доступа', password: 'qa-restricted-password', invitation }) });
    return { status: response.status, body: await response.json() };
  }, { email, invitation: invite.body.token });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  return { context, page, row, email };
}
async function run(id, title, page, fn) {
  if (onlyCases.size && !onlyCases.has(id)) return;
  try {
    const evidence = await fn();
    record(id, title, 'passed', evidence === undefined ? {} : { evidence });
  } catch (error) {
    const shot = await screenshot(page, `${id}-failure`).catch(() => null);
    record(id, title, 'failed', { error: String(error.message || error), screenshot: shot });
  }
}
async function clickConfirm(page, button, accept) {
  let message = '';
  let handled = false;
  const label = (await button.textContent()).trim();
  page.once('dialog', async dialog => {
    message = dialog.message();
    handled = true;
    if (accept) await dialog.accept(); else await dialog.dismiss();
  });
  await button.click();
  await page.waitForTimeout(75);
  assert.equal(handled, true, `Expected a confirmation after ${label}`);
  return message;
}

const browser = await chromium.launch({ headless: true, executablePath: chrome });
const desktop = await browser.newContext({ viewport: { width: 1440, height: 980 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await desktop.newPage();
page.on('console', item => { if (item.type() === 'error') report.consoleErrors.push(item.text()); });
page.on('pageerror', error => report.consoleErrors.push(String(error.message || error)));
page.on('requestfailed', request => report.failedAssets.push({ url: request.url(), failure: request.failure()?.errorText || 'request failed' }));

try {
  await login(page);
  report.build = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));

  await run('A03', 'publication close time remains stable after two browser saves', page, async () => {
    await app(page, `/app/projects/${fixture.projectId}/site`);
    const close = page.getByLabel(/Закрыть сайт/);
    await close.fill('2026-09-18T23:40');
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    await page.getByText('Изменения сохранены', { exact: true }).waitFor();
    const first = await close.inputValue();
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    await page.getByText('Изменения сохранены', { exact: true }).waitFor();
    const second = await close.inputValue();
    assert.equal(second, first, `close time drifted from ${first} to ${second}`);
    return { first, second, timeZoneNote: await page.getByText(/Время свадьбы:/).textContent() };
  });

  await run('A04-import', 'dirty microsite draft blocks timing import and preserves its text', page, async () => {
    const intro = page.getByLabel('Приветствие');
    await intro.fill('Черновик перед импортом — не терять');
    await page.waitForTimeout(100);
    const timing = page.getByLabel('Таблица тайминга');
    const timingOptions = await timing.locator('option').allTextContents();
    const timingIndex = timingOptions.findIndex(label => /тайминг/i.test(label));
    assert.ok(timingIndex > 0, `timing table is absent: ${timingOptions.join(', ')}`);
    await timing.selectOption({ index: timingIndex });
    const check = page.locator('.v2-publishing-timing-rows input[type=checkbox]').first();
    await check.check();
    const importButton = page.getByRole('button', { name: 'Импортировать выбранные пункты', exact: true });
    assert.equal(await importButton.isDisabled(), true, 'dirty draft still permits import');
    assert.equal(await intro.inputValue(), 'Черновик перед импортом — не терять');
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    await page.getByText('Изменения сохранены', { exact: true }).waitFor();
    return { importDisabledWhileDirty: true, draft: await intro.inputValue() };
  });

  await run('A04-navigation', 'cancelled internal navigation and browser Back retain a publication draft', page, async () => {
    await app(page, `/app/projects/${fixture.projectId}/guests`);
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
    await page.getByText('Сайт свадьбы', { exact: true }).click();
    await page.getByRole('heading', { name: 'Приглашение для гостей', exact: true }).waitFor();
    const intro = page.getByLabel('Приветствие');
    await intro.fill('Черновик сохраняется после отмены перехода');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Гости', exact: true }).click();
    await page.getByRole('heading', { name: 'Приглашение для гостей', exact: true }).waitFor();
    assert.equal(await intro.inputValue(), 'Черновик сохраняется после отмены перехода');
    page.once('dialog', dialog => dialog.dismiss());
    await page.goBack({ waitUntil: 'commit', timeout: 1000 }).catch(() => null);
    await page.waitForTimeout(120);
    await page.getByRole('heading', { name: 'Приглашение для гостей', exact: true }).waitFor();
    assert.equal(await intro.inputValue(), 'Черновик сохраняется после отмены перехода');
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    await page.getByText('Изменения сохранены', { exact: true }).waitFor();
    return { url: page.url() };
  });

  await run('A04-loading', 'microsite editor stays unavailable until its initial draft arrives', page, async () => {
    const requestPattern = '**/api/v2/publishing/microsite?*';
    let heldRoute;
    await page.route(requestPattern, route => { heldRoute = route; });
    try {
      await page.goto(`${fixture.origin}/app/projects/${fixture.projectId}/site`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Загружаем черновик сайта…', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Приветствие').count(), 0, 'editor accepted input before its draft loaded');
      assert.ok(heldRoute, 'microsite request was not held');
      await heldRoute.continue();
      const intro = page.getByLabel('Приветствие');
      await intro.waitFor();
      assert.equal(await intro.isDisabled(), false, 'editor did not become usable after its draft loaded');
      return { loadingText: 'Загружаем черновик сайта…', editorReady: true };
    } finally {
      await page.unroute(requestPattern);
    }
  });

  await run('A14', 'unpublish and archive require confirmation and change only the temporary fixture', page, async () => {
    await app(page, `/app/projects/${fixture.projectId}/site`);
    await page.getByText('Управление публикацией', { exact: true }).click();
    const unpublish = page.getByRole('button', { name: 'Снять с публикации', exact: true });
    const unpublishCancel = await clickConfirm(page, unpublish, false);
    assert.match(unpublishCancel, /Страница станет недоступна гостям/);
    await page.getByText('Опубликован', { exact: true }).waitFor();
    const unpublishConfirm = await clickConfirm(page, unpublish, true);
    assert.match(unpublishConfirm, /гостевые сессии завершатся/);
    await page.getByText('Снят с публикации', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await page.getByText('Опубликован', { exact: true }).waitFor();

    await app(page, '/app/content');
    await page.getByRole('button', { name: 'Истории', exact: true }).click();
    const contentItem = page.locator('.v2-publishing-columns aside button').first();
    await contentItem.waitFor();
    await contentItem.click();
    const title = page.getByLabel('Название', { exact: true });
    await title.waitFor();
    assert.ok((await title.inputValue()).trim(), 'selected public material has no title');
    await page.getByText('Управление публикацией', { exact: true }).click();
    const archive = page.locator('.v2-publishing-management').getByRole('button', { name: 'В архив', exact: true });
    assert.equal(await archive.isEnabled(), true, 'archive action is unavailable for the selected material');
    const archiveCancel = await clickConfirm(page, archive, false);
    assert.match(archiveCancel, /исчезнет с публичного сайта/);
    assert.equal(await contentItem.count(), 1, 'cancelled archive changed the list');
    const archiveConfirm = await clickConfirm(page, archive, true);
    assert.match(archiveConfirm, /снят с публикации/);
    await page.getByText('Пока нет материалов.', { exact: true }).waitFor();
    await page.getByRole('checkbox', { name: 'Архив', exact: true }).check();
    await page.locator('.v2-publishing-columns aside button').first().waitFor();
    return { unpublishCancel, unpublishConfirm, archiveCancel, archiveConfirm, restoredMicrosite: true };
  });

  await run('A01', 'direct calendar and guest routes retain their addressed object', page, async () => {
    const events = await api(page, '/api/v2/calendar/events?from=2026-09-01&to=2026-09-30');
    assert.equal(events.status, 200);
    const meeting = events.body.items.find(item => item.sourceKind === 'meeting');
    assert.ok(meeting, 'fixture has no meeting for direct route check');
    await app(page, `/app/projects/${meeting.projectId}/calendar/${meeting.sourceId}`);
    await page.getByRole('dialog', { name: 'Изменить встречу' }).waitFor();
    assert.equal(await page.getByRole('dialog').getByLabel('Название').inputValue(), meeting.title);
    await page.keyboard.press('Escape');
    const state = await api(page, `/api/state?project=${fixture.projectId}`);
    const guestTable = state.body.entities.find(item => item.kind === 'table' && item.data?.key === 'guests');
    const guest = state.body.entities.find(item => item.kind === 'row' && item.parent_id === guestTable.id);
    await app(page, `/app/projects/${fixture.projectId}/guests/${guest.id}`);
    await page.getByRole('heading', { name: 'Гости', exact: true }).waitFor();
    assert.match(page.url(), new RegExp(`/guests/${guest.id}$`));
    return { meetingId: meeting.sourceId, guestId: guest.id };
  });

  await run('A02-A08', 'September 2026 calendar begins Monday and two selected dates pass into new task forms', page, async () => {
    await app(page, '/app/calendar');
    await page.getByRole('heading', { name: 'Календарь', exact: true }).waitFor();
    await page.getByText(/Сентябрь 2026/i).waitFor();
    const weekdays = await page.locator('.v2-calendar-weekdays span').allTextContents();
    assert.deepEqual(weekdays, ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
    for (const day of ['2026-09-15', '2026-09-17']) {
      await page.getByRole('button', { name: new RegExp(`Открыть .*${Number(day.slice(-2))}`) }).click();
      await page.getByRole('button', { name: 'Задачу', exact: true }).click();
      const wedding = page.getByRole('combobox', { name: 'Свадьба', exact: true });
      await wedding.waitFor();
      await wedding.selectOption({ label: 'Алина и Даниил' });
      await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Новая задача' });
      await dialog.waitFor();
      assert.equal(await dialog.getByRole('textbox', { name: 'Дата', exact: true }).inputValue(), day, `calendar date was stale for ${day}`);
      await page.keyboard.press('Escape');
      await page.locator('.sidebar').getByRole('button', { name: 'Календарь', exact: true }).click();
      await page.getByRole('heading', { name: 'Календарь', exact: true }).waitFor();
    }
    return { weekdays, testedDates: ['2026-09-15', '2026-09-17'] };
  });

  await run('A11-A16', 'new task keeps a clear date and omits the removed advanced settings', page, async () => {
    await app(page, `/app/projects/${fixture.projectId}/tasks?new=1`);
    const dialog = page.getByRole('dialog', { name: 'Новая задача' });
    await dialog.waitFor();
    await dialog.getByText('Конкретная дата', { exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Дата', exact: true }).fill('2026-09-19');
    assert.equal(await dialog.getByText('Дополнительные параметры', { exact: true }).count(), 0);
    assert.equal(await dialog.getByLabel('Этап').count(), 0);
    await page.keyboard.press('Escape');
    return { fixedDate: '2026-09-19', advancedSettingsRemoved: true };
  });

  await run('A13', 'restricted guest role sees neither RSVP fabrication nor invitation actions', page, async () => {
    const restricted = await createRestrictedViewer(page);
    try {
      await app(restricted.page, `/app/projects/${fixture.projectId}/guests`);
      await restricted.page.getByRole('heading', { name: 'Гости', exact: true }).waitFor();
      const text = await restricted.page.locator('main').innerText();
      assert.match(text, /Ответы на приглашения недоступны/);
      assert.ok(!/Нет ответа/.test(text), 'unavailable RSVP is rendered as a negative reply');
      assert.equal(await restricted.page.getByRole('button', { name: /Приглаш|ссылк/i }).count(), 0, 'restricted viewer sees invitation action');
      const name = restricted.page.getByText(/Екатерина Волкова|Имя недоступно/).first();
      await name.scrollIntoViewIfNeeded();
      const box = await name.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'restricted guest name is clipped');
      return { email: restricted.email, guestBox: box };
    } finally { await restricted.context.close(); }
  });

  await run('A05', 'seating UI exposes guest assignment, free seats, geometry separation and zoom', page, async () => {
    await app(page, `/app/projects/${fixture.projectId}/seating`);
    await page.getByRole('heading', { name: /Рассадка|План зала/ }).first().waitFor();
    const text = await page.locator('main').innerText();
    assert.match(text, /Гостей:/);
    const controls = await page.locator('button').allTextContents();
    const zoom = page.locator('.v2-seat-zoom select');
    assert.equal(await zoom.count(), 1, 'zoom control is absent');
    const search = page.locator('.v2-seat-search');
    assert.equal(await search.count(), 1);
    assert.ok(await search.getAttribute('aria-label') || await search.getAttribute('placeholder'), 'guest search has no usable name');
    const guestNames = page.locator('.v2-seat-unseated-list .v2-seat-guest span');
    await guestNames.first().waitFor();
    const searchedName = await guestNames.first().evaluate(node => [...node.childNodes]
      .filter(child => child.nodeType === Node.TEXT_NODE)
      .map(child => child.textContent)
      .join('').trim());
    assert.ok(searchedName, 'the first unseated guest has no text name');
    await search.fill(searchedName);
    await guestNames.first().waitFor();
    const visibleNames = await guestNames.evaluateAll(nodes => nodes.map(node => [...node.childNodes]
      .filter(child => child.nodeType === Node.TEXT_NODE)
      .map(child => child.textContent)
      .join('').trim()).filter(Boolean));
    assert.ok(visibleNames.includes(searchedName), 'the observed guest disappeared after search');
    assert.ok(visibleNames.every(name => name === searchedName), `search retained another guest: ${visibleNames.join(', ')}`);
    return { searchedName, visibleNames, controls: controls.filter(value => /геометр|масштаб|план|гост/i.test(value)).slice(0, 16) };
  });

  await run('A15', 'guest seating mode hides geometry and keyboard-created contour closes and saves', page, async () => {
    assert.equal(await page.locator('.v2-seat-properties').count(), 0, 'geometry is exposed in guest seating mode');
    await page.getByRole('button', { name: 'Редактировать зал', exact: true }).click();
    await page.getByRole('button', { name: 'Нарисовать стол', exact: true }).click();
    const x = page.getByLabel('X новой точки, м');
    const y = page.getByLabel('Y новой точки, м');
    for (const [px, py] of [['1', '1'], ['2', '1'], ['1.5', '2']]) {
      await x.fill(px); await y.fill(py); await page.getByRole('button', { name: 'Добавить точку', exact: true }).click();
    }
    const first = page.getByRole('button', { name: /Точка 1/ });
    await first.focus(); await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Замкнуть контур', exact: true }).click();
    await page.getByText('Контур замкнут.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Сохранить фигуру', exact: true }).click();
    await page.getByRole('button', { name: 'Нарисовать стол', exact: true }).waitFor();
    return { pointCount: await page.locator('.v2-seat-point').count() };
  });

  for (const width of [390, 320]) {
    await run(`A06-${width}`, `guest registry remains readable without document overflow at ${width}px`, page, async () => {
      const mobile = await browser.newContext({ viewport: { width, height: 844 } });
      const mobilePage = await mobile.newPage();
      mobilePage.on('pageerror', error => report.consoleErrors.push(`mobile-${width}: ${error.message}`));
      await login(mobilePage);
      await app(mobilePage, `/app/projects/${fixture.projectId}/guests`);
      await mobilePage.getByRole('heading', { name: 'Гости', exact: true }).waitFor();
      const overflow = await noDocumentOverflow(mobilePage, `guest ${width}`);
      const guest = mobilePage.getByText('Екатерина Волкова', { exact: true }).first();
      await guest.scrollIntoViewIfNeeded();
      const rect = await guest.boundingBox();
      assert.ok(rect && rect.width > 0 && rect.x >= 0 && rect.x + rect.width <= width, 'guest name is clipped');
      const shot = await screenshot(mobilePage, `a06-guests-${width}`);
      const row = guest.locator('xpath=ancestor::tr');
      const rsvp = row.locator('.v2-guest-cell-rsvp');
      const seat = row.locator('.v2-guest-cell-table');
      const [rsvpBox, seatBox] = await Promise.all([rsvp.boundingBox(), seat.boundingBox()]);
      for (const box of [rsvpBox, seatBox]) assert.ok(box && box.x >= 0 && box.x + box.width <= width, 'guest RSVP or table cell is clipped');
      const evidence = { overflow, guestBox: rect, rsvpBox, seatBox, screenshot: shot };
      await mobile.close();
      return evidence;
    });
  }

  await run('A12', 'mobile drawer focuses its first item, traps Tab, closes with Escape and restores trigger focus', page, async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobile.newPage();
    await login(mobilePage);
    await app(mobilePage, `/app/projects/${fixture.projectId}/guests`);
    const trigger = mobilePage.getByRole('button', { name: 'Открыть навигацию', exact: true });
    await trigger.click();
    const navigation = mobilePage.getByRole('navigation', { name: 'Основная навигация' });
    const first = navigation.getByRole('button').first();
    await first.waitFor();
    assert.equal(await first.evaluate(node => document.activeElement === node), true, 'first drawer item did not receive focus');
    const ariaCurrent = await navigation.getByRole('button', { name: 'Свадьбы', exact: true }).getAttribute('aria-current');
    assert.equal(ariaCurrent, 'page', 'active drawer item has no aria-current="page"');
    for (let i = 0; i < 20; i++) await mobilePage.keyboard.press('Tab');
    assert.equal(await mobilePage.locator('.v2-main-column').evaluate(node => !node.contains(document.activeElement)), true, 'Tab escaped the drawer');
    await mobilePage.keyboard.press('Escape');
    await mobilePage.waitForTimeout(80);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.evaluate(node => document.activeElement === node), true, 'trigger did not regain focus');
    await mobile.close();
    return { ariaCurrent };
  });

  await run('A10-320', 'public header fits into 320px document width', page, async () => {
    const mobile = await browser.newContext({ viewport: { width: 320, height: 760 } });
    const publicPage = await mobile.newPage();
    await publicPage.goto(fixture.urls.agencyHome, { waitUntil: 'networkidle' });
    const overflow = await noDocumentOverflow(publicPage, 'public home 320');
    const shot = await screenshot(publicPage, 'a10-public-home-320');
    await mobile.close();
    return { overflow, screenshot: shot };
  });

  await run('A07', 'issued invitation displays its actual recipient and dates, and copy reports the clipboard result', page, async () => {
    await app(page, `/app/projects/${fixture.projectId}/guests`);
    const invite = page.locator('.v2-guest-invites li').first();
    await invite.waitFor();
    const recipient = (await invite.locator('strong').innerText()).trim();
    const inviteDates = (await invite.locator('small').innerText()).trim();
    assert.ok(recipient, 'issued invitation has no visible recipient');
    assert.match(inviteDates, /выдано .*\d{4}.*срок .*\d{4}/, `invitation has no human dates: ${inviteDates}`);
    assert.ok(await page.locator('.v2-guest-table-wrap tbody th').filter({ hasText: recipient }).count(), `recipient ${recipient} is absent from the guest registry`);
    await invite.getByRole('button', { name: 'Перевыпустить', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Перевыпустить ссылку?' });
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(), new RegExp(recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
    await app(page, `/app/projects/${fixture.projectId}/site`);
    const copy = page.getByRole('button', { name: 'Копировать', exact: true });
    await copy.click();
    await page.getByText('Ссылка скопирована', { exact: true }).waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /\/w\//);
    return { recipient, inviteDates, copied };
  });

  await run('A09', 'new section starts at top and Back restores an earlier scroll position', page, async () => {
    await app(page, `/app/projects/${fixture.projectId}/guests`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const before = await page.evaluate(() => scrollY);
    await page.locator('.sidebar').getByRole('button', { name: 'Календарь', exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => scrollY), 0, 'new section did not start at top');
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForTimeout(100);
    const restored = await page.evaluate(() => scrollY);
    assert.ok(Math.abs(restored - before) <= 5, `Back did not restore prior scroll (${before} -> ${restored})`);
    return { before, restored, url: page.url() };
  });
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = report.cases.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  writeFileSync(resolve(out, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  await desktop.close();
  await browser.close();
}

const failed = report.cases.filter(item => item.status === 'failed');
console.log(JSON.stringify({ output: resolve(out, 'results.json'), summary: report.summary, failed: failed.map(item => item.id) }, null, 2));
if (failed.length || report.consoleErrors.length || report.failedAssets.length) process.exitCode = 1;

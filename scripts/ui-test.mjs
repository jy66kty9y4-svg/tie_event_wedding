import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHttpServer } from '../server/http.mjs';

const bundledPlaywrightPath = '/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE_PATH) return import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE_PATH)));
  try { return await import('playwright'); }
  catch { return import(pathToFileURL(bundledPlaywrightPath)); }
}

class ApiClient {
  constructor(origin) { this.origin = origin; this.cookies = new Map(); }
  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(this.origin + path, { ...options, headers });
    for (const value of response.headers.getSetCookie()) {
      const first = value.split(';', 1)[0];
      const at = first.indexOf('=');
      this.cookies.set(first.slice(0, at), decodeURIComponent(first.slice(at + 1)));
    }
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: ${response.status} ${body?.error || body}`);
    return body;
  }
  get(path) { return this.request(path); }
  async post(path, body) {
    if (!this.cookies.get('tie_csrf')) await this.get('/api/public?agency=tie');
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': this.cookies.get('tie_csrf') },
      body: JSON.stringify(body),
    });
  }
  command(op, body = {}) { return this.post('/api/command', { id: crypto.randomUUID(), op, ...body }); }
}

const { chromium } = await loadPlaywright();
const temporary = mkdtempSync(join(tmpdir(), 'tie-ui-'));
const server = createHttpServer({ dbPath: join(temporary, 'ui.sqlite'), distDir: resolve('dist') });
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
const adminApi = new ApiClient(origin);
const browserErrors = [];
let browser;

function watch(page, name) {
  page.on('pageerror', error => browserErrors.push(`${name} pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`${name} console: ${message.text()}`); });
}

async function openPage(context, name) {
  const page = await context.newPage();
  watch(page, name);
  await page.goto(origin);
  await page.waitForLoadState('networkidle');
  await page.getByText(/Ваша история|Сегодня|Все проекты|Входящие обращения/).first().waitFor();
  return page;
}

async function loginUi(page, email, password) {
  await page.goto(`${origin}/app?login=1`);
  const dialog = page.getByRole('dialog', { name: 'Войти в tie' });
  await dialog.waitFor();
  await dialog.getByLabel('Почта', { exact: true }).fill(email);
  await dialog.getByLabel('Пароль', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

async function openProjectFromList(page, name) {
  const heading = page.getByRole('heading', { name, exact: true });
  if (await heading.isVisible().catch(() => false)) return;
  const card = page.locator('.project-card').filter({ hasText: name });
  await card.getByRole('button').filter({ hasText: name }).click();
  await heading.waitFor();
}

async function openCustomTable(page, tableName) {
  const card = page.locator('.vendor-card').filter({ hasText: tableName });
  await card.getByRole('button', { name: `Открыть ${tableName}`, exact: true }).click();
  await page.getByRole('heading', { name: tableName, exact: true }).waitFor();
}

try {
  await adminApi.get('/api/public?agency=tie');
  await adminApi.post('/api/setup', {
    slug: 'tie', agencyName: 'UI Test Agency', name: 'UI Administrator',
    email: 'admin-ui@example.test', password: 'admin-ui-password',
  });
  const project = await adminApi.command('project.create', { data: {
    name: 'Couple UI Project', date: '2027-07-17', location: 'Test Hall', limit: 5000000,
  } });
  const invitation = await adminApi.command('invite.create', {
    projectId: project.id, email: 'couple-ui@example.test',
  });
  const coupleApi = new ApiClient(origin);
  await coupleApi.post('/api/register', {
    slug: 'tie', name: 'UI Couple', email: 'couple-ui@example.test',
    password: 'couple-ui-password', invitation: invitation.token,
  });

  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const coupleContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const couplePage = await openPage(coupleContext, 'couple');
  await loginUi(couplePage, 'couple-ui@example.test', 'couple-ui-password');
  await couplePage.getByRole('heading', { name: 'Couple UI Project', exact: true }).waitFor();

  await couplePage.goto(`${origin}/app/projects/${project.id}/guests`);
  await couplePage.getByRole('heading', { name: 'Гости', exact: true }).waitFor();
  await couplePage.getByRole('button', { name: 'Добавить гостя' }).click();
  await couplePage.locator('.guest-sheet-new').getByLabel('ФИО').fill('Алина Гость UI');
  await couplePage.locator('.guest-sheet-new').getByLabel('Контакт').fill('+7 999 123-45-67');
  await couplePage.getByRole('button', { name: 'Сохранить гостя' }).click();
  const newGuest = couplePage.getByRole('textbox', { name: 'ФИО: Алина Гость UI' });
  await newGuest.waitFor();
  await couplePage.locator('.guest-sheet-new').getByLabel('ФИО').waitFor();
  await newGuest.fill('Алина Исправлено UI');
  await newGuest.press('Tab');
  await couplePage.getByRole('textbox', { name: 'ФИО: Алина Исправлено UI' }).waitFor();
  await couplePage.getByRole('combobox', { name: 'Ответ RSVP: Алина Исправлено UI' }).selectOption('confirmed');
  await couplePage.waitForFunction(() => document.querySelector('select[aria-label="Ответ RSVP: Алина Исправлено UI"]')?.value === 'confirmed');
  await couplePage.reload();
  await couplePage.getByRole('textbox', { name: 'ФИО: Алина Исправлено UI' }).waitFor();
  assert.equal(await couplePage.getByRole('combobox', { name: 'Ответ RSVP: Алина Исправлено UI' }).inputValue(), 'confirmed');
  await couplePage.getByRole('searchbox', { name: 'Поиск' }).fill('Исправлено');
  assert.equal(await couplePage.locator('.guest-sheet-table tbody tr').count() >= 1, true);
  await couplePage.getByRole('searchbox', { name: 'Поиск' }).fill('');
  if (process.env.TIE_GUEST_SCREENSHOT) await couplePage.screenshot({ path: process.env.TIE_GUEST_SCREENSHOT, fullPage: true });
  await couplePage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await couplePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await couplePage.getByRole('textbox', { name: 'ФИО: Алина Исправлено UI' }).waitFor();
  await couplePage.setViewportSize({ width: 1280, height: 900 });

  await couplePage.getByRole('button', { name: 'Колонки', exact: true }).click();
  const columnEditor = couplePage.locator('.guest-sheet-column-editor');
  await columnEditor.getByRole('button', { name: /Добавить колонку/ }).click();
  await columnEditor.locator('input[aria-label^="Название колонки"]').last().fill('Подтверждение UI');
  await columnEditor.locator('select[aria-label^="Тип колонки"]').last().selectOption('boolean');
  const columnRows = columnEditor.locator('.guest-sheet-column-list > div');
  await columnRows.last().locator('.guest-sheet-column-drag').dragTo(columnRows.nth(1));
  assert.equal(await columnRows.nth(1).locator('input[aria-label^="Название колонки"]').inputValue(), 'Подтверждение UI');
  await columnEditor.getByRole('button', { name: 'Сохранить колонки', exact: true }).click();
  await couplePage.getByRole('columnheader', { name: 'Подтверждение UI', exact: true }).waitFor();
  await couplePage.getByRole('button', { name: 'Добавить гостя' }).click();
  const newGuestForm = couplePage.locator('.guest-sheet-new');
  await newGuestForm.getByLabel('ФИО').fill('Борис Флажок UI');
  await newGuestForm.getByLabel('Подтверждение UI', { exact: true }).check();
  await newGuestForm.getByRole('button', { name: 'Сохранить гостя', exact: true }).click();
  await couplePage.getByRole('checkbox', { name: 'Подтверждение UI: Борис Флажок UI', exact: true }).waitFor();
  assert.equal(await couplePage.getByRole('checkbox', { name: 'Подтверждение UI: Борис Флажок UI', exact: true }).isChecked(), true);
  await couplePage.getByRole('button', { name: 'Колонки', exact: true }).click();
  const reopenedColumns = couplePage.locator('.guest-sheet-column-editor');
  assert.equal(await reopenedColumns.getByRole('button', { name: 'Удалить колонку ФИО', exact: true }).isDisabled(), true);
  assert.equal(await reopenedColumns.getByRole('button', { name: 'Удалить колонку Приглашение', exact: true }).isDisabled(), true);
  couplePage.once('dialog', dialog => dialog.accept());
  await reopenedColumns.getByRole('button', { name: 'Удалить колонку Подтверждение UI', exact: true }).click();
  await reopenedColumns.getByRole('button', { name: 'Сохранить колонки', exact: true }).click();
  await couplePage.getByRole('columnheader', { name: 'Подтверждение UI', exact: true }).waitFor({ state:'detached' });
  await couplePage.reload();
  assert.equal(await couplePage.getByRole('columnheader', { name: 'Подтверждение UI', exact: true }).count(), 0);
  await couplePage.getByRole('button', { name: 'Колонки', exact: true }).click();
  const mappedColumns = couplePage.locator('.guest-sheet-column-editor');
  couplePage.once('dialog', dialog => dialog.accept());
  await mappedColumns.getByRole('button', { name: 'Удалить колонку Пищевые аллергии', exact: true }).click();
  await mappedColumns.getByRole('button', { name: 'Сохранить колонки', exact: true }).click();
  await couplePage.getByRole('columnheader', { name: 'Пищевые аллергии', exact: true }).waitFor({ state:'detached' });

  await couplePage.goto(`${origin}/app/projects/${project.id}/more`); await couplePage.getByRole('button', { name: /Все таблицы/ }).click();
  await couplePage.getByRole('heading', { name: 'Все рабочие таблицы', exact: true }).waitFor();
  await couplePage.getByRole('button', { name: '+ Раздел', exact: true }).click();
  let dialog = couplePage.getByRole('dialog', { name: 'Новый раздел' });
  await dialog.getByLabel('Название', { exact: true }).fill('День свадьбы UI');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await couplePage.getByRole('heading', { name: 'День свадьбы UI', exact: true }).waitFor();

  await couplePage.locator('.page-header').getByRole('button', { name: 'Таблица', exact: true }).click();
  dialog = couplePage.getByRole('dialog', { name: 'Таблица и колонки' });
  await dialog.getByLabel('Название', { exact: true }).fill('Расходы дня UI');
  await dialog.getByLabel('Раздел').selectOption({ label: 'День свадьбы UI' });
  await dialog.getByRole('button', { name: '+ Колонка', exact: true }).click();
  await dialog.getByLabel('Название колонки 2', { exact: true }).fill('Стоимость UI');
  await dialog.getByLabel('Тип колонки 2', { exact: true }).selectOption('money');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await couplePage.getByRole('heading', { name: 'Расходы дня UI', exact: true }).waitFor();
  await openCustomTable(couplePage, 'Расходы дня UI');
  await couplePage.getByRole('button', { name: 'Строка', exact: true }).click();
  const customRow = couplePage.locator('tbody tr').first();
  await customRow.getByRole('button', { name: 'Изменить', exact: true }).click();
  await customRow.getByRole('textbox', { name: 'Название' }).fill('Декор стола UI');
  await customRow.getByRole('spinbutton', { name: 'Стоимость UI' }).fill('123.45');
  await customRow.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await customRow.getByText(/123,45/).waitFor();

  let coupleState = await coupleApi.get(`/api/state?project=${project.id}`);
  const customTable = coupleState.entities.find(item => item.kind === 'table' && item.data.name === 'Расходы дня UI');
  assert(customTable, 'the table created through UI was not persisted');
  const moneyColumn = customTable.data.columns.find(item => item.name === 'Стоимость UI');
  const persistedRow = coupleState.entities.find(item => item.kind === 'row' && item.parent_id === customTable.id);
  assert.equal(persistedRow.data[moneyColumn.id], 12345);

  await couplePage.goto(`${origin}/app/projects/${project.id}/finance/estimate`);
  await couplePage.getByRole('button', { name: 'Смета пары', exact: true }).waitFor();
  if (process.env.TIE_BUDGET_SCREENSHOT) await couplePage.screenshot({path:process.env.TIE_BUDGET_SCREENSHOT,fullPage:true});
  const banquetName = couplePage.getByRole('textbox', { name: 'Название раздела Банкет' });
  await banquetName.fill('Банкет и площадка UI');
  await banquetName.press('Tab');
  const venueEstimate = couplePage.getByRole('textbox', { name: 'Предполагаемые: Аренда площадки' });
  await venueEstimate.fill('1000.50');
  await venueEstimate.press('Tab');
  const budgetSearch=couplePage.getByRole('searchbox',{name:'Поиск по смете'});
  await budgetSearch.fill('Диджей');
  await couplePage.getByRole('textbox',{name:'Название статьи Диджей'}).waitFor();
  assert.equal(await couplePage.getByRole('textbox',{name:'Название статьи Аренда площадки'}).count(),0);
  await couplePage.getByRole('button',{name:'Сбросить поиск'}).click();
  const banquetRow=couplePage.getByRole('textbox',{name:'Название раздела Банкет и площадка UI'}).locator('xpath=ancestor::tr');
  await banquetRow.getByRole('button',{name:'Добавить статью'}).click();
  await couplePage.getByPlaceholder('Название статьи').fill('Новая статья UI');
  await couplePage.getByRole('button',{name:'Добавить',exact:true}).click();
  await couplePage.getByRole('textbox',{name:'Название статьи Новая статья UI'}).waitFor();
  await couplePage.getByRole('button',{name:'Добавить раздел'}).click();
  await couplePage.getByPlaceholder('Название раздела').fill('После свадьбы UI');
  await couplePage.getByRole('button',{name:'Добавить',exact:true}).click();
  const newSection=couplePage.getByRole('textbox',{name:'Название раздела После свадьбы UI'});
  await newSection.waitFor();
  await newSection.fill('После торжества UI');
  await newSection.press('Tab');
  const afterRow=couplePage.getByRole('textbox',{name:'Название раздела После торжества UI'}).locator('xpath=ancestor::tr');
  await afterRow.getByRole('button',{name:'Добавить статью'}).click();
  await couplePage.getByPlaceholder('Название статьи').fill('Альбом UI');
  await couplePage.getByRole('button',{name:'Добавить',exact:true}).click();
  await couplePage.getByRole('textbox',{name:'Название статьи Альбом UI'}).waitFor();
  const albumActual=couplePage.getByRole('textbox',{name:'Фактические: Альбом UI'});
  await albumActual.fill('900');await albumActual.press('Tab');
  const albumPrepaid=couplePage.getByRole('textbox',{name:'Предоплата: Альбом UI'});
  await albumPrepaid.fill('200');await albumPrepaid.press('Tab');
  await couplePage.getByRole('textbox',{name:'Название статьи Альбом UI'}).locator('xpath=ancestor::tr').getByText('700',{exact:true}).waitFor();
  await couplePage.getByRole('button', { name: 'Реестр выплат', exact: true }).click();
  await couplePage.getByRole('heading', { name: 'Смета и выплаты', exact: true }).waitFor();
  await couplePage.locator('.page-header').getByRole('button', { name: 'Статья', exact: true }).click();
  dialog = couplePage.getByRole('dialog', { name: 'Новая статья сметы' });
  await dialog.getByLabel('За что платим', { exact: true }).fill('Фотограф UI');
  await dialog.getByLabel('Стоимость для пары, ₽', { exact: true }).fill('1000.50');
  await dialog.getByLabel('Оценка для пары, ₽', { exact: true }).fill('1000.50');
  await dialog.getByLabel('Дата выплаты', { exact: true }).fill('2027-07-17');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await couplePage.getByText('Фотограф UI', { exact: true }).waitFor();

  await couplePage.locator('.page-header').getByRole('button', { name: 'Движение', exact: true }).click();
  await couplePage.getByRole('dialog').waitFor();
  dialog = couplePage.getByRole('dialog', { name: 'Новое движение средств' });
  assert.equal(await dialog.getByRole('heading').textContent(), 'Новое движение средств');
  await dialog.getByLabel('Тип').selectOption('payment');
  await dialog.getByLabel('Сумма, ₽', { exact: true }).fill('250.25');
  await dialog.getByLabel('Дата', { exact: true }).fill('2027-07-17');
  await dialog.getByLabel('Описание', { exact: true }).fill('Первый платёж UI');
  await dialog.getByLabel('Статья сметы').selectOption({ label: 'Фотограф UI' });
  await dialog.getByLabel('Контур денег').selectOption('direct');
  await dialog.getByRole('button', { name: 'Сохранить движение', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const movementRow = couplePage.locator('.data-row.static').filter({ hasText: 'Первый платёж UI' });
  await movementRow.waitFor();
  await movementRow.getByRole('button', { name: 'Изменить', exact: true }).click();
  dialog = couplePage.getByRole('dialog', { name: 'Изменить движение' });
  assert.equal(await dialog.getByLabel('Тип').inputValue(), 'payment');
  await dialog.getByLabel('Сумма, ₽', { exact: true }).fill('300.75');
  await dialog.getByLabel('Описание', { exact: true }).fill('Исправленный платёж UI');
  await dialog.getByRole('button', { name: 'Сохранить движение', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await couplePage.getByText('Исправленный платёж UI', { exact: true }).waitFor();
  await couplePage.reload();
  await couplePage.waitForLoadState('networkidle');
  await openProjectFromList(couplePage, 'Couple UI Project');
  await couplePage.goto(`${origin}/app/projects/${project.id}/finance/estimate`);
  await couplePage.getByRole('button', { name: 'Реестр выплат', exact: true }).click();
  await couplePage.getByText('Исправленный платёж UI', { exact: true }).waitFor();

  coupleState = await coupleApi.get(`/api/state?project=${project.id}`);
  const budget=coupleState.entities.find(item=>item.kind==='coupleBudget')?.data;
  assert.equal(budget.names[8],'Банкет и площадка UI');
  assert.equal(budget.estimated[9],100050);
  assert.equal(budget.extraItems[8][0].name,'Новая статья UI');
  assert.equal(budget.names[budget.extraSections[0].row],'После торжества UI');
  const albumId=budget.extraSections[0].items[0].row;
  assert.equal(budget.actual[albumId]-budget.prepaid[albumId],70000);
  const photographer = coupleState.entities.find(item => item.kind === 'obligation' && item.data.title === 'Фотограф UI');
  const payments = coupleState.entities.filter(item => item.kind === 'movement' && item.data.obligationId === photographer.id);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].data.amount, 30075);
  assert.equal(coupleState.financials.paid[photographer.id], 30075);

  await couplePage.setViewportSize({ width: 390, height: 844 });
  await couplePage.goto(`${origin}/app/projects/${project.id}/more`);
  await couplePage.getByRole('button', { name: /Все таблицы/ }).click();
  await openCustomTable(couplePage, 'Расходы дня UI');
  const mobileRow = couplePage.locator('tbody tr').first();
  await mobileRow.getByRole('button', { name: 'Изменить', exact: true }).click();
  await mobileRow.getByRole('spinbutton', { name: 'Стоимость UI' }).fill('321.09');
  await mobileRow.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await mobileRow.getByText(/321,09/).waitFor();
  assert.equal(await couplePage.locator('body').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'mobile page has body-level horizontal overflow');

  const applicantContext = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const applicantPage = await openPage(applicantContext, 'applicant');
  await applicantPage.getByRole('button', { name: 'Оставить заявку', exact: true }).first().click();
  dialog = applicantPage.getByRole('dialog', { name: 'Создать аккаунт' });
  await dialog.getByLabel('Ваше имя', { exact: true }).fill('Applicant UI');
  await dialog.getByLabel('Почта', { exact: true }).fill('applicant-ui@example.test');
  await dialog.getByLabel('Пароль', { exact: true }).fill('applicant-ui-password');
  await dialog.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await applicantPage.getByRole('button', { name: 'Заполнить анкету' }).click();
  const questionnaire = applicantPage.locator('form.questionnaire-form');
  await questionnaire.locator('input[type="date"]').fill('2027-09-09');
  await questionnaire.locator('input[placeholder="Как с вами связаться"]').fill('@applicant-ui');
  await questionnaire.locator('input[placeholder="Как вас зовут?"]').fill('Заявка UI');
  for (const answer of await questionnaire.locator('textarea').all()) await answer.fill('Ответ для проверки интерфейса');
  await questionnaire.locator('.questionnaire-image-options input[type="checkbox"]').first().check();
  await questionnaire.getByRole('button', { name: /Отправить анкету и заявку/ }).click();
  await applicantPage.getByRole('heading', { name: 'Спасибо, мы получили вашу заявку.', exact: true }).waitFor();

  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adminPage = await openPage(adminContext, 'admin');
  await loginUi(adminPage, 'admin-ui@example.test', 'admin-ui-password');
  await adminPage.getByRole('button', { name: 'Сегодня', exact: true }).waitFor();
  await adminPage.goto(`${origin}/app/applications`);
  let applicationRow = adminPage.locator('.application-row').filter({ hasText: 'Заявка UI' });
  await applicationRow.getByRole('button', { name: 'Рассмотреть', exact: true }).click();
  dialog = adminPage.getByRole('dialog', { name: 'Рассмотреть заявку' });
  await dialog.getByLabel('Решение').selectOption('clarification');
  await dialog.getByLabel('Причина или сообщение').fill('Уточните формат церемонии');
  await dialog.getByRole('button', { name: 'Сохранить решение', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await adminPage.getByRole('tab', { name: /Обработанные/ }).click();
  await applicationRow.getByText(/Нужно уточнение/).waitFor();

  await applicantPage.reload();
  await applicantPage.waitForLoadState('networkidle');
  await applicantPage.getByRole('heading', { name: 'Организатор ждёт вашего ответа.', exact: true }).waitFor();
  await applicantPage.getByText('Уточните формат церемонии').waitFor();
  await applicantPage.getByRole('button', { name: 'Уточнить заявку', exact: true }).click();
  dialog = applicantPage.getByRole('dialog', { name: 'Уточнить заявку' });
  await dialog.getByLabel('Как к вам обращаться', { exact: true }).fill('Заявка UI уточнена');
  await dialog.getByLabel('Что уточнили').fill('Церемония на открытом воздухе');
  await dialog.getByRole('button', { name: 'Отправить уточнение', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await applicantPage.getByRole('heading', { name: 'Спасибо, мы получили вашу заявку.', exact: true }).waitFor();

  await adminPage.reload();
  await adminPage.waitForLoadState('networkidle');
  await adminPage.goto(`${origin}/app/applications`);
  applicationRow = adminPage.locator('.application-row').filter({ hasText: 'Заявка UI уточнена' });
  await applicationRow.getByRole('button', { name: 'Рассмотреть', exact: true }).click();
  dialog = adminPage.getByRole('dialog', { name: 'Рассмотреть заявку' });
  await dialog.getByLabel('Решение').selectOption('approved');
  await dialog.getByRole('button', { name: 'Сохранить решение', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await adminPage.getByRole('tab', { name: /Обработанные/ }).click();
  await applicationRow.getByText(/Одобрена/).waitFor();

  await applicantContext.close();
  const coldApplicantContext = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const coldApplicantPage = await openPage(coldApplicantContext, 'cold-applicant');
  await loginUi(coldApplicantPage, 'applicant-ui@example.test', 'applicant-ui-password');
  await coldApplicantPage.getByRole('heading', { name: 'Заявка UI уточнена', exact: true }).waitFor();
  const applicantApi = new ApiClient(origin);
  await applicantApi.post('/api/login', { slug: 'tie', email: 'applicant-ui@example.test', password: 'applicant-ui-password' });
  const applicantState = await applicantApi.get('/api/state');
  assert.equal(applicantState.projects.length, 1);
  assert.equal(applicantState.projects[0].data.name, 'Заявка UI уточнена');

  const finalCoupleState = await coupleApi.get(`/api/state?project=${project.id}`);
  assert.equal(finalCoupleState.entities.find(item => item.id === persistedRow.id).data[moneyColumn.id], 32109);
  const expectedConsoleError = /status of 401 \(Unauthorized\)/;
  assert.deepEqual(browserErrors.filter(message => !expectedConsoleError.test(message)), []);
  console.log('Production UI: couple structure/table/money/payment persistence, clarification approval, cold login, and 390px editing: OK');
} catch (error) {
  console.error('Captured browser errors:', browserErrors.length ? browserErrors : '(none)');
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

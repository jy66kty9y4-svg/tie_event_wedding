import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHttpServer } from '../server/http.mjs';

const playwrightPath = '/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import(pathToFileURL(playwrightPath));

class ApiClient {
  constructor(origin) { this.origin = origin; this.cookies = new Map(); }
  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(this.origin + path, { ...options, headers });
    for (const item of response.headers.getSetCookie()) {
      const [pair] = item.split(';', 1), at = pair.indexOf('=');
      this.cookies.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1)));
    }
    const body = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(`${options.method || 'GET'} ${path}: ${response.status} ${body?.error || body}`);
    return body;
  }
  get(path) { return this.request(path); }
  async post(path, body) {
    if (!this.cookies.get('tie_csrf')) await this.get('/api/public?agency=tie');
    return this.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': this.cookies.get('tie_csrf') }, body: JSON.stringify(body) });
  }
  command(op, body = {}) { return this.post('/api/command', { id: crypto.randomUUID(), op, ...body }); }
}

const root = mkdtempSync(join(tmpdir(), 'tie-v2-entry-'));
const server = createHttpServer({ dbPath: join(root, 'entry.sqlite'), distDir: resolve('dist') });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const adminApi = new ApiClient(origin);
let browser;

async function login(page, email, password, openedByCta = false) {
  const dialog = page.getByRole('dialog', { name: 'Войти в tie' });
  if (!openedByCta) await page.locator('#root').getByRole('button', { name: 'Войти', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByLabel('Почта', { exact: true }).fill(email);
  await dialog.getByLabel('Пароль', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

try {
  await adminApi.post('/api/setup', { slug: 'tie', agencyName: 'Entry evidence', name: 'Entry admin', email: 'entry-admin@example.test', password: 'entry-admin-password' });
  let story = await adminApi.command('publicContent.saveDraft', { data: { kind: 'case', draft: { title: 'Свадьба у озера', slug: 'lake-wedding', summary: 'Опубликованный кейс для проверки источника' } } });
  story = await adminApi.command('publicContent.publish', { entityId: story.id, version: story.version, data: { kind: 'case' } });
  let service = await adminApi.command('publicContent.saveDraft', { data: { kind: 'package', draft: { title: 'Координация дня', slug: 'day-coordination', summary: 'Опубликованный пакет для проверки источника' } } });
  service = await adminApi.command('publicContent.publish', { entityId: service.id, version: service.version, data: { kind: 'package' } });
  const visitorApi = new ApiClient(origin);
  await visitorApi.post('/api/register', { slug: 'tie', name: 'Источник CTA', email: 'entry-visitor@example.test', password: 'entry-visitor-password' });

  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  // AC34: both published CTA links carry their immutable owner IDs into the login flow.
  const packageVisitor = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const packagePage = await packageVisitor.newPage();
  await packagePage.goto(`${origin}/services?agency=tie`);
  await packagePage.getByRole('link', { name: 'Обсудить этот формат', exact: true }).click();
  await packagePage.waitForURL(new RegExp(`/app\\?sourcePackageId=${service.id}$`));
  await packagePage.getByRole('dialog', { name: 'Войти в tie' }).waitFor();
  await packageVisitor.close();
  const visitor = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await visitor.newPage();
  await page.goto(`${origin}/stories/lake-wedding?agency=tie`);
  await page.getByRole('link', { name: 'Обсудить похожую свадьбу', exact: true }).click();
  await page.waitForURL(new RegExp(`/app\\?sourceCaseId=${story.id}$`));
  await login(page, 'entry-visitor@example.test', 'entry-visitor-password', true);
  let application = page.getByRole('dialog', { name: 'Заявка на свадьбу' });
  await application.getByLabel('Как к вам обращаться', { exact: true }).fill('Источник CTA');
  await application.getByLabel('Дата свадьбы', { exact: true }).fill('2027-10-10');
  await application.getByLabel('Почта или телефон', { exact: true }).fill('source@example.test');
  await application.getByLabel('Что для вас важно', { exact: true }).fill('Сохранить этот текст заявки');
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tie:application-draft'))), {
    name: 'Источник CTA', date: '2027-10-10', contact: 'source@example.test', message: 'Сохранить этот текст заявки', sourceCaseId: story.id,
  });
  page.once('dialog', dialog => dialog.accept());
  await application.getByRole('button', { name: 'Отмена', exact: true }).click();
  await application.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Оставить заявку', exact: true }).click();
  application = page.getByRole('dialog', { name: 'Заявка на свадьбу' });
  await application.waitFor();
  assert.match(await application.textContent(), /Расскажите самое важное/, 'application draft did not reopen as an editable form');
  assert.equal(await application.locator('textarea').inputValue(), 'Сохранить этот текст заявки');
  assert.equal(await application.locator('input[type="date"]').inputValue(), '2027-10-10');
  await application.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  await application.getByText('Заявка отправлена', { exact: false }).waitFor();

  const submitted = await adminApi.get('/api/state');
  const sourceApplication = submitted.applications.find(item => item.data?.contact === 'source@example.test');
  assert(sourceApplication, 'CTA application was not created');
  assert.equal(sourceApplication.data.sourceCaseId, story.id, 'case source was not persisted with the application');
  assert.equal(sourceApplication.data.sourcePackageId, undefined, 'package source leaked into the case application');

  // AC34 approval and AC45 agency-to-project navigation use the staff UI and create one project only.
  const staff = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const staffPage = await staff.newPage();
  await staffPage.goto(`${origin}/app?agency=tie`);
  await login(staffPage, 'entry-admin@example.test', 'entry-admin-password');
  await staffPage.goto(`${origin}/app/applications?agency=tie`);
  const applicationRow = staffPage.locator('.application-row').filter({ hasText: 'source@example.test' });
  await applicationRow.getByRole('button', { name: 'Рассмотреть', exact: true }).click();
  application = staffPage.getByRole('dialog', { name: 'Рассмотреть заявку' });
  await application.locator('select').selectOption('approved');
  await application.getByRole('button', { name: 'Сохранить решение', exact: true }).click();
  await application.waitFor({ state: 'detached' });
  await staffPage.getByRole('button', { name: 'Свадьбы', exact: true }).click();
  await staffPage.locator('.project-card').filter({ hasText: 'Источник CTA' }).waitFor();
  assert.equal(await staffPage.locator('.project-card').count(), 1, 'one approved application must create exactly one project');
  await staffPage.getByRole('button', { name: 'Финансы агентства', exact: true }).click();
  await staffPage.getByRole('heading', { name: 'Собственный бюджет', exact: true }).waitFor();
  await staffPage.getByRole('button', { name: 'Свадьбы', exact: true }).click();
  const projectCard = staffPage.locator('.project-card').filter({ hasText: 'Источник CTA' });
  await projectCard.getByRole('button').filter({ hasText: 'Источник CTA' }).click();
  await staffPage.waitForURL(/\/app\/projects\/[^/]+\/overview/);
  await staffPage.getByRole('heading', { name: 'Источник CTA', exact: true }).waitFor();
  assert.equal(await staffPage.getByRole('button', { name: 'Финансы агентства', exact: true }).count(), 1, 'agency sidebar must remain available inside a project');

  // AC37: an actual dashboard request failure must be visible as an error, never an all-clear state.
  await staffPage.route('**/api/v2/dashboard**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Проверка dashboard временно недоступна' }) }));
  await staffPage.getByRole('button', { name: 'Сегодня', exact: true }).click();
  const alert = staffPage.getByRole('alert');
  await alert.waitFor();
  await assert.match(await alert.textContent(), /dashboard временно недоступна/);
  assert.equal(await staffPage.getByText('В доступных данных срочных действий не найдено.', { exact: true }).count(), 0);
  mkdirSync('test-results/v2', { recursive: true });
  await staffPage.screenshot({ path: 'test-results/v2/dashboard-network-error.png', fullPage: true });
  writeFileSync('test-results/v2/entry-results.json', JSON.stringify({
    timestamp: new Date().toISOString(), passed: true,
    checks: { ac34: 'published case/package CTA source, login, typed draft preservation, and one-project approval', ac37: 'dashboard network failure renders an alert without all-clear', ac45: 'persistent agency sidebar supports agency finance to project navigation' },
    screenshot: 'test-results/v2/dashboard-network-error.png',
  }, null, 2) + '\n');

  await visitor.close();
  await staff.close();
  console.log('V2 entry evidence: published CTA source + typed draft preservation, one-project approval, dashboard failure, and persistent agency sidebar: PASS');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}

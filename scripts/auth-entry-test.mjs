import {markLegacyAccount} from '../tests/fixtures/account.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHttpServer } from '../server/http.mjs';
import { bootstrap, execute, register } from '../server/service.mjs';

const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH || '/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import(pathToFileURL(playwrightPath));
const temporary = mkdtempSync(join(tmpdir(), 'tie-auth-entry-'));
const screenshots = process.env.TIE_AUTH_SCREENSHOTS;
if (screenshots) mkdirSync(screenshots, { recursive: true });
const server = createHttpServer({ dbPath: join(temporary, 'auth.sqlite'), distDir: resolve('dist') });
const errors = [];
let browser;

try {
  const { user: admin } = bootstrap(server.db, { slug: 'tie', agencyName: 'Студия событий', name: 'Организатор', email: 'admin-auth@example.test', password: 'admin-auth-password' });
  const run = (op, body = {}) => execute(server.db, admin, { id: randomUUID(), op, ...body });
  const draft = run('publicSite.saveMainDraft', { data: { draft: { heroTitle: 'Лендинг не должен появиться', heroText: 'Текст опубликованной главной' } } });
  run('publicSite.publishMain', { version: draft.version });
  const project = run('project.create', { data: { name: 'Свадьба для проверки входа', date: '2027-06-12' } });
  const invitation = run('invite.create', { projectId: project.id, email: 'couple-auth@example.test' });
  register(server.db, { slug: 'tie', name: 'Пара', email: 'couple-auth@example.test', phone: '+79990000001', password: 'couple-auth-password', invitation: invitation.token });
  markLegacyAccount(server.db,server.db.prepare('SELECT id FROM users WHERE email=?').get('couple-auth@example.test').id);
  const newInvitation = run('invite.create', { projectId: project.id, email: 'new-auth@example.test' });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  // Watch every rendered frame so even a brief flash of the landing fails acceptance.
  await page.addInitScript(() => {
    window.landingAppeared = false;
    new MutationObserver(() => {
      if (document.querySelector('.ui-public-home, .ui-ph-hero') || document.body?.innerText.includes('Лендинг не должен появиться')) window.landingAppeared = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(origin);
  const login = page.getByRole('region', { name: 'Войти в tie' });
  await login.waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await login.getByLabel('Номер телефона', { exact: true }).count(), 1);
  assert.equal(await login.getByRole('group', { name: 'Способ входа' }).count(), 1);
  assert.equal(await login.getByLabel('Пароль', { exact: true }).count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await login.isVisible(), true, 'Escape must not dismiss the entry page');
  if (screenshots) await page.screenshot({ path: join(screenshots, 'login-desktop.png'), fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (screenshots) await page.screenshot({ path: join(screenshots, `login-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  // Both fields appear immediately; invalid identifiers never reach authentication.
  let loginRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/login') loginRequests += 1; });
  await login.getByRole('button', { name: 'Войти', exact: true }).click();
  assert.equal(loginRequests, 0);
  await login.getByLabel('Номер телефона', { exact: true }).fill('123');
  await login.getByLabel('Пароль', { exact: true }).fill('wrong-auth-password');
  await login.getByRole('button', { name: 'Войти', exact: true }).click();
  assert.equal(await login.getByLabel('Номер телефона', { exact: true }).evaluate(input => input.validity.patternMismatch), true);
  assert.equal(loginRequests, 0);
  await login.getByRole('button', { name: 'Почта', exact: true }).click();
  assert.equal(await login.getByRole('alert').count(), 0);
  assert.equal(await login.getByLabel('Пароль', { exact: true }).inputValue(), 'wrong-auth-password');
  await login.getByLabel('Почта', { exact: true }).fill('admin-auth@example.test');
  await login.getByRole('button', { name: 'Телефон', exact: true }).click();
  assert.equal(await login.getByLabel('Номер телефона', { exact: true }).inputValue(), '+7 (123) ');
  await login.getByRole('button', { name: 'Почта', exact: true }).click();
  assert.equal(await login.getByLabel('Почта', { exact: true }).inputValue(), 'admin-auth@example.test');
  await login.getByRole('checkbox', { name: 'Сохранить вход' }).uncheck();
  await login.getByRole('button', { name: 'Показать пароль' }).click();
  assert.equal(await login.getByLabel('Пароль', { exact: true }).getAttribute('type'), 'text');
  await login.getByRole('button', { name: 'Скрыть пароль' }).click();
  const failedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/login');
  await login.getByRole('button', { name: 'Войти', exact: true }).click();
  assert.equal((await failedResponse).status(), 401);
  await login.getByRole('alert').waitFor();
  assert.equal(loginRequests, 1);
  assert.equal(await login.getByLabel('Почта', { exact: true }).inputValue(), 'admin-auth@example.test');
  assert.equal(await login.getByLabel('Пароль', { exact: true }).inputValue(), 'wrong-auth-password');
  assert.equal(await page.getByRole('dialog', { name: 'Забыли пароль?' }).count(), 0);
  const secondFailure = page.waitForResponse(response => new URL(response.url()).pathname === '/api/login');
  await login.getByRole('button', { name: 'Войти', exact: true }).click();
  assert.equal((await secondFailure).status(), 401);
  const passwordHelp = page.getByRole('dialog', { name: 'Забыли пароль?' });
  await passwordHelp.waitFor();
  assert.equal(await passwordHelp.getByText('Свяжитесь с организатором вашей свадьбы, чтобы восстановить доступ.').count(), 1);
  await page.keyboard.press('Escape');
  await passwordHelp.waitFor({ state: 'detached' });
  await login.getByLabel('Пароль', { exact: true }).fill('admin-auth-password');
  await login.getByRole('button', { name: 'Войти', exact: true }).click();
  await login.waitFor({ state: 'detached' });
  const cookie = (await context.cookies()).find(item => item.name === 'tie_session');
  assert.equal(cookie.expires, -1, 'unchecked remember option must create a session cookie');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await login.waitFor();
  assert.equal(await page.evaluate(() => window.landingAppeared), false);
  assert.equal(await login.getByLabel('Пароль', { exact: true }).count(), 1);
  // Registration stays on the same page and the back arrow returns to login.
  await login.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  const signup = page.getByRole('region', { name: 'Создать аккаунт' });
  await signup.waitFor();
  await signup.getByRole('button', { name: 'Назад ко входу' }).click();
  await login.waitFor();
  // Signup requires both contacts; equivalent Russian formats sign in.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phonePage = await phoneContext.newPage();
  phonePage.on('pageerror', error => errors.push(error.message));
  await phonePage.goto(origin);
  await phonePage.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  const phoneSignup = phonePage.getByRole('region', { name: 'Создать аккаунт' });
  assert.equal(await phoneSignup.getByRole('group').count(), 0);
  assert.equal(await phoneSignup.getByLabel('Почта', { exact: true }).getAttribute('required'), '');
  assert.equal(await phoneSignup.getByLabel('Номер телефона').getAttribute('required'), '');
  await phoneSignup.getByLabel('Ваше имя').fill('Телефонная пара');
  await phoneSignup.getByLabel('Почта', { exact: true }).fill('phone-auth@example.test');
  await phoneSignup.getByLabel('Номер телефона').fill('8 (999) 123-45-67');
  assert.equal(await phoneSignup.getByLabel('Номер телефона').inputValue(), '+7 (999) 123-45-67');
  await phoneSignup.getByLabel('Номер телефона').press('End');
  await phoneSignup.getByLabel('Номер телефона').pressSequentially('890');
  assert.equal(await phoneSignup.getByLabel('Номер телефона').inputValue(), '+7 (999) 123-45-67');
  await phoneSignup.getByLabel('Пароль', { exact: true }).fill('phone-auth-password');
  if (screenshots) await phonePage.screenshot({ path: join(screenshots, 'register-phone.png'), fullPage: true });
  await phoneSignup.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await phonePage.getByRole('heading', { name: 'Ждём подтверждения администратора.' }).waitFor();
  for (const identifier of ['9991234567', '+7 999 123 45 67']) {
    await phonePage.getByRole('button', { name: 'Выйти', exact: true }).click();
    await phonePage.waitForURL('**/app/projects');
    const phoneLogin = phonePage.getByRole('region', { name: 'Войти в tie' });
    await phoneLogin.getByLabel('Номер телефона', { exact: true }).fill(identifier);
    assert.equal(await phoneLogin.getByLabel('Номер телефона', { exact: true }).inputValue(), '+7 (999) 123-45-67');
    await phoneLogin.getByLabel('Пароль', { exact: true }).fill('phone-auth-password');
    await phoneLogin.getByRole('button', { name: 'Войти', exact: true }).click();
    await phonePage.getByRole('heading', { name: 'Ждём подтверждения администратора.' }).waitFor();
  }
  await phoneContext.close();
  // Couple invitations still bind email, but new accounts wait for administrator approval.
  await page.goto(`${origin}/?invite=${newInvitation.token}`);
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await signup.getByLabel('Ваше имя').fill('Новая пара');
  await signup.getByLabel('Почта').fill('new-auth@example.test');
  await signup.getByLabel('Номер телефона').fill('89990000002');
  await signup.getByLabel('Пароль', { exact: true }).fill('new-auth-password');
  await signup.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.getByRole('heading', { name: 'Ждём подтверждения администратора.', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('invite'), false);
  // Login after a private deep link returns to that exact wedding section.
  const deepContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const deepPage = await deepContext.newPage();
  deepPage.on('pageerror', error => errors.push(error.message));
  const deepPath = `/app/projects/${project.id}/files`;
  await deepPage.goto(origin + deepPath);
  const deepLogin = deepPage.getByRole('region', { name: 'Войти в tie' });
  await deepLogin.getByRole('button', { name: 'Почта', exact: true }).click();
  await deepLogin.getByLabel('Почта', { exact: true }).fill('couple-auth@example.test');
  await deepLogin.getByLabel('Пароль', { exact: true }).fill('couple-auth-password');
  await deepLogin.getByRole('button', { name: 'Войти', exact: true }).click();
  await deepPage.getByRole('heading', { name: 'Документы', exact: true }).waitFor();
  assert.equal(new URL(deepPage.url()).pathname, deepPath);
  assert.equal((await deepContext.cookies()).find(item => item.name === 'tie_session').expires > Date.now() / 1000, true);
  assert.deepEqual(errors, []);
  console.log('Account entry: no landing flash, one-screen phone/email/password, two-failure help dialog, mandatory dual-contact signup, strict mask, invitation/deep link, 390/320px: OK');
  if (screenshots) console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}

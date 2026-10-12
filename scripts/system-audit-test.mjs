import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHttpServer } from '../server/http.mjs';
import { bootstrap, execute } from '../server/service.mjs';
import { entities } from '../server/db.mjs';
import { questionnaireQuestions } from '../src/questionnaire.js';

// Audit writes are confined to a newly created SQLite database.
const output = resolve(process.env.TIE_AUDIT_OUTPUT || 'test-results/audit-2026-10-10');
mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), cases: [], runtimeErrors: [], consoleErrors: [], failedRequests: [] };
const only = process.env.TIE_AUDIT_ONLY ? new RegExp(process.env.TIE_AUDIT_ONLY) : null;
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH || '/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const root = mkdtempSync(join(tmpdir(), 'tie-system-audit-'));
const server = createHttpServer({ dbPath: join(root, 'audit.sqlite'), distDir: resolve('dist') });
const db = server.db;
const { user: admin } = bootstrap(db, { slug: 'tie', agencyName: 'Системный аудит', name: 'Аудитор', email: 'audit@example.test', password: 'audit-test-password' });
const send = (op, body = {}) => execute(db, admin, { id: randomUUID(), op, ...body });
const first = send('project.create', { data: { name: 'Аудит Анна и Иван', date: '2027-10-10', location: 'Москва' } });
const second = send('project.create', { data: { name: 'Аудит Мария и Пётр', date: '2027-11-10', location: 'Казань' } });
const tables = entities(db, admin.agency_id, first.id, 'table');
const guests = tables.find(item => item.data.key === 'guests');
const timing = tables.find(item => item.data.key === 'timing');
const guest = send('entity.create', { projectId: first.id, kind: 'row', parentId: guests.id, schemaVersion: guests.version, data: { name: 'Аудит Гость', contact: 'audit-guest@example.test' } });
send('entity.create', { projectId: first.id, kind: 'row', parentId: timing.id, schemaVersion: timing.version, data: { title: 'Аудит Церемония', time: '15:00', audience: 'Общее' } });
send('task.create', { projectId: first.id, data: { title: 'Аудит задача', dueMode: 'relative', offsetDays: -10, assigneeUserId: admin.id } });
send('microsite.saveDraft', { projectId: first.id, data: { rsvpDeadline: '2099-10-01', draft: { coupleNames: 'Анна и Иван', title: 'Аудит приглашение' } } });
const coupleRole = db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='couple'").get(admin.agency_id);
send('user.create', { name: 'Аудит пара', email: 'audit-couple@example.test', password: 'audit-couple-password', roleId: coupleRole.id, projectId: first.id });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(8000);
page.on('pageerror', error => report.runtimeErrors.push({ url: page.url(), message: error.message }));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ url: page.url(), message: message.text() }); });
page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
const shot = async name => { const filename = name.replace(/[^a-z0-9-]+/gi, '-').slice(0,120) + '.png'; await page.screenshot({ path: join(output, filename), fullPage: true }); return filename; };
async function check(name, work) {
  if (only && !only.test(name)) return;
  const started = Date.now();
  try { report.cases.push({ name, ok: true, detail: await work(), durationMs: Date.now()-started }); }
  catch (error) { report.cases.push({ name, ok: false, error: error.message, screenshot: await shot('failure-'+name).catch(() => null), durationMs: Date.now()-started }); }
  writeFileSync(join(output, 'extended-audit.json'), JSON.stringify(report, null, 2));
  console.log(`${report.cases.at(-1).ok ? 'PASS' : 'FAIL'} ${name}`);
}
async function login(target, email = 'audit@example.test', password = 'audit-test-password') {
  await target.goto(origin);
  const form = target.getByRole('region', { name: 'Войти в tie' });
  await form.getByRole('button', { name: 'Почта', exact: true }).click();
  await form.getByLabel('Почта', { exact: true }).fill(email);
  await form.getByLabel('Пароль', { exact: true }).fill(password);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await target.locator('.app-shell').waitFor();
}
async function open(path) { await page.goto(origin + path); await page.locator('.app-shell').waitFor(); await page.locator('.v2-main-column').waitFor(); await page.waitForTimeout(100); }
const agencyRoutes = ['today','projects','applications','tasks','calendar','vendors','templates','team','finance','content','settings','notifications','profile'];
const projectRoutes = ['overview','tasks','approvals','vendors','finance/estimate','finance/payouts','guests','seating','day/pair','day/team','site','tables',`tables/${timing.id}`,'files','history','settings','calendar','more','members','offline'];
try {
  await login(page);
  for (const width of [1440,768,390,320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [...agencyRoutes.map(route => '/app/'+route), ...projectRoutes.map(route => `/app/projects/${first.id}/${route}`)]) {
      await check(`route-${width}-${path.replaceAll('/','-')}`, async () => {
        await open(path);
        const state = await page.evaluate(() => ({ path: location.pathname, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, headings: [...document.querySelectorAll('main h1,main h2')].map(node=>node.textContent), contentLength: document.querySelector('.v2-main-column')?.textContent?.length || 0, emptyTables: document.querySelectorAll('table').length, overflowElements: [...document.querySelectorAll('main *')].filter(node=>node.getBoundingClientRect().right>innerWidth+2&&getComputedStyle(node).position!=='fixed').slice(0,8).map(node=>({ tag:node.tagName, class:node.className, right:node.getBoundingClientRect().right })) }));
        assert.equal(state.path, path, `Unexpected redirect to ${state.path}`);
        assert.ok(state.contentLength > 30, 'Empty main content');
        assert.ok(state.scrollWidth <= width+1, `Document overflow: ${state.scrollWidth}px at ${width}px; ${JSON.stringify(state.overflowElements)}`);
        if (['overview','guests','seating','finance/estimate','calendar','site'].some(route=>path.endsWith('/'+route)) && [1440,390,320].includes(width)) state.screenshot = await shot(`screen-${width}-${path.replaceAll('/','-')}`);
        return state;
      });
    }
  }
  await page.setViewportSize({ width:1440, height:900 });
  await check('sidebar-project-tabs-history-reload', async()=>{
    await open(`/app/projects/${first.id}/finance/estimate`);
    const tabs=page.locator('.v2-project-tabs');
    for (const label of ['Смета','Площадка','Тайминг','Подрядчики','Документы','Гости','Рассадка','План','Календарь','Ещё']) { await tabs.getByRole('button',{name:label,exact:true}).click(); await page.waitForTimeout(80); }
    const last=page.url();await page.goBack();assert.ok(page.url().endsWith('/more'));await page.goForward();assert.equal(page.url(),last);await page.reload();await page.getByRole('heading',{name:first.data.name,exact:true}).waitFor();
    for(const [label,path] of [['Задачи','tasks'],['Календарь','calendar'],['Финансы агентства','finance'],['Настройки','settings'],['Свадьбы','projects'],['Сегодня','today']]){await page.locator('.sidebar').getByRole('button',{name:label,exact:true}).click();await page.waitForURL(origin+'/app/'+path);}
  });
  await check('guest-deep-link-retains-target',async()=>{await open(`/app/projects/${first.id}/guests/${guest.id}`);await page.locator('tr.is-addressed').waitFor();assert.ok((await page.locator('tr.is-addressed input').evaluateAll(nodes=>nodes.map(node=>node.value))).includes('Аудит Гость'));assert.ok(page.url().endsWith('/'+guest.id));});
  await check('navigation-resets-scroll-and-history-restores-it',async()=>{
    await page.setViewportSize({width:1440,height:900});await open(`/app/projects/${first.id}/finance/estimate`);await page.getByRole('searchbox',{name:'Поиск по смете'}).waitFor();await page.evaluate(()=>window.scrollTo(0,600));await page.waitForTimeout(150);const saved=await page.evaluate(()=>scrollY);assert.ok(saved>400);
    await page.locator('.sidebar').getByRole('button',{name:'Свадьбы',exact:true}).click();await page.waitForURL('**/app/projects');assert.equal(await page.evaluate(()=>scrollY),0);await page.goBack();await page.waitForURL('**/finance/estimate');await page.waitForFunction(value=>Math.abs(scrollY-value)<3,saved);return{restoredScroll:saved};
  });
  await check('dashboard-server-failure-is-visible',async()=>{
    await page.route('**/api/v2/dashboard**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тестовая недоступность данных аудита'})}));
    try{await open('/app/today');await page.getByRole('alert').filter({hasText:'Тестовая недоступность данных аудита'}).waitFor();assert.equal(await page.getByText('В доступных данных срочных действий не найдено.',{exact:true}).count(),0);}finally{await page.unroute('**/api/v2/dashboard**');}
  });
  await check('calendar-new-meeting-create-and-label',async()=>{
    await page.setViewportSize({width:1440,height:900});await open(`/app/projects/${first.id}/calendar`);await page.getByRole('button',{name:'Встреча',exact:true}).click();const modal=page.getByRole('dialog');await modal.waitFor();const title=await modal.getAttribute('aria-label'),deleteButtons=await modal.getByRole('button',{name:'Удалить',exact:true}).count();
    await modal.getByLabel('Название',{exact:true}).fill('Аудит новой встречи');await modal.locator('select[multiple]').first().selectOption(admin.id);const saved=page.waitForResponse(response=>response.url().endsWith('/api/command')&&response.request().method()==='POST');await modal.getByRole('button',{name:'Сохранить встречу',exact:true}).click();const response=await saved;assert.equal(response.status(),200,JSON.stringify(await response.json()));await modal.waitFor({state:'detached'});assert.equal(entities(db,admin.agency_id,first.id,'meeting').filter(item=>item.data.title==='Аудит новой встречи').length,1);
    assert.equal(title,'Новая встреча',`New meeting was saved, but dialog title=${title}, delete buttons=${deleteButtons}`);assert.equal(deleteButtons,0);return{created:true};
  });
  await check('publication-unsaved-back-cancel-and-accept',async()=>{
    await open(`/app/projects/${first.id}/more`);await page.getByRole('button',{name:/Сайт свадьбы/}).click();await page.getByLabel('Имена пары',{exact:true}).fill('Несохранённый аудит');
    let message='';page.once('dialog',async dialog=>{message=dialog.message();await dialog.dismiss();});await page.goBack();await page.waitForURL('**/site');assert.ok(message,'No unsaved changes dialog');assert.equal(await page.getByLabel('Имена пары',{exact:true}).inputValue(),'Несохранённый аудит');
    page.once('dialog',dialog=>dialog.accept());await page.goBack();await page.waitForURL('**/more');
  });
  await check('mobile-menu-keyboard-focus-and-escape',async()=>{
    await page.setViewportSize({width:390,height:844});await open('/app/today');const button=page.getByRole('button',{name:'Открыть личное меню'});await button.click();await page.waitForTimeout(100);assert.equal(await page.locator('.v2-main-column').evaluate(node=>node.inert),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.sidebar')),true);await page.keyboard.press('Escape');assert.equal(await button.getAttribute('aria-expanded'),'false');assert.equal(await button.evaluate(node=>document.activeElement===node),true);
  });
  await check('modal-keyboard-focus-and-escape',async()=>{
    await page.setViewportSize({width:1440,height:900});await open('/app/projects');const trigger=page.locator('.page-header').getByRole('button',{name:'Новая свадьба',exact:true});await trigger.click();const modal=page.getByRole('dialog',{name:'Новая свадьба'});await modal.waitFor();assert.equal(await page.locator('.app-shell').evaluate(node=>node.inert),true);await page.keyboard.press('Tab');assert.equal(await modal.evaluate(node=>node.contains(document.activeElement)),true);await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await trigger.evaluate(node=>document.activeElement===node),true);
  });
  await check('couple-forbidden-project-and-agency-isolation',async()=>{
    const restricted=await browser.newContext();const p=await restricted.newPage();await login(p,'audit-couple@example.test','audit-couple-password');
    for(const path of [`/api/state?project=${second.id}`,'/api/state']){const response=await restricted.request.get(origin+path);if(path.includes('?'))assert.equal(response.status(),403);else {const state=await response.json();assert.equal(state.projects.some(item=>item.id===second.id),false);assert.equal(state.user.email,'audit-couple@example.test');}}
    await p.goto(origin+`/app/projects/${second.id}/finance/estimate`);await p.locator('.app-shell').waitFor();assert.equal(await p.getByRole('heading',{name:second.data.name,exact:true}).count(),0);await restricted.close();
  });
  await check('registration-approval-questionnaire-full-ui-lifecycle',async()=>{
    const signupContext=await browser.newContext({viewport:{width:390,height:844}});const p=await signupContext.newPage();
    try {
      await p.goto(origin);await p.getByRole('button',{name:'Создать аккаунт',exact:true}).click();const form=p.getByRole('region',{name:'Создать аккаунт'});await form.getByLabel('Ваше имя').fill('Новая пара');await form.getByLabel('Почта',{exact:true}).fill('audit-new@example.test');await form.getByLabel('Номер телефона').fill('+79998887755');await form.getByLabel('Пароль',{exact:true}).fill('audit-new-password');await form.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
      await p.getByRole('heading',{name:'Ждём подтверждения администратора.'}).waitFor();assert.equal(await p.getByRole('button',{name:'Заполнить анкету',exact:true}).count(),0);
      assert.equal((await signupContext.request.get(origin+`/api/state?project=${first.id}`)).status(),403);
      await page.setViewportSize({width:1440,height:900});await open('/app/settings');await page.getByRole('tab',{name:'Доступ',exact:true}).click();const row=page.locator('.user-management-row').filter({hasText:'audit-new@example.test'});await row.getByRole('button',{name:'Подтвердить',exact:true}).click();const approval=page.getByRole('dialog',{name:'Подтвердить аккаунт'});await approval.getByLabel('Свадьба').selectOption(first.id);await approval.getByRole('button',{name:'Подтвердить и назначить свадьбу'}).click();await approval.waitFor({state:'detached'});
      await p.getByRole('button',{name:'Проверить подтверждение',exact:true}).click();await p.getByRole('heading',{name:'Ваша история начинается здесь.'}).waitFor();
      const fields=await p.locator('.questionnaire-field input[required],.questionnaire-field textarea[required]').all();
      assert.equal(fields.length,questionnaireQuestions.length-1);
      for(let index=0;index<fields.length;index++)await fields[index].fill(index===0?'Новая пара':`Ответ на вопрос ${index}`);
      await p.getByRole('checkbox',{name:'закат/рассвет'}).check();const pending=p.waitForResponse(response=>response.url().endsWith('/api/command')&&response.request().method()==='POST');await p.getByRole('button',{name:'Отправить анкету и открыть кабинет'}).click();const response=await pending;
      assert.equal(response.status(),200,JSON.stringify(await response.json()));await p.getByRole('heading',{name:first.data.name,exact:true}).waitFor();assert.ok(p.url().includes(first.id));await p.reload();await p.getByRole('heading',{name:first.data.name,exact:true}).waitFor();
      await page.reload();await page.getByRole('tab',{name:'Доступ',exact:true}).click();await row.getByRole('button',{name:'Анкета',exact:true}).click();await page.getByRole('dialog',{name:'Анкета — Новая пара'}).waitFor();await page.keyboard.press('Escape');
      const state=await (await signupContext.request.get(origin+'/api/state')).json();assert.equal(state.onboarding.status,'complete');return {status:state.onboarding.status,requiredAnswers:fields.length};
    } finally {await signupContext.close();}
  });
  await check('rapid-project-switch-last-click-wins',async()=>{
    await page.setViewportSize({width:1440,height:900});await open('/app/projects');
    await page.route('**/api/state?project=*',async route=>{const id=new URL(route.request().url()).searchParams.get('project');await new Promise(done=>setTimeout(done,id===first.id?800:40));await route.continue();});
    await page.locator('.project-card').filter({hasText:first.data.name}).locator('.project-open').click();
    await page.locator('.project-card').filter({hasText:second.data.name}).locator('.project-open').click();
    await page.waitForTimeout(1400);await page.unroute('**/api/state?project=*');assert.equal(new URL(page.url()).pathname,`/app/projects/${second.id}/finance/estimate`,'A slower earlier request replaced the last selected wedding');
  });
  await check('same-network-same-browser-independent-sessions',async()=>{
    const a=await browser.newContext({userAgent:'TieSystemAudit/IndependentDevices'}),b=await browser.newContext({userAgent:'TieSystemAudit/IndependentDevices'});
    try {
      for(const device of [a,b]){await device.request.get(origin+'/api/public');const csrf=(await device.cookies(origin)).find(cookie=>cookie.name==='tie_csrf').value;const response=await device.request.post(origin+'/api/login',{headers:{'x-csrf-token':csrf},data:{email:'audit@example.test',password:'audit-test-password'}});assert.equal(response.status(),200);}
      const firstStatus=(await a.request.get(origin+'/api/state')).status(),secondStatus=(await b.request.get(origin+'/api/state')).status();
      assert.equal(secondStatus,200);assert.equal(firstStatus,200,`Independent cookie jars with the same IP/User-Agent: first=${firstStatus}, second=${secondStatus}`);
    } finally {await a.close();await b.close();}
  });
  await check('api-invalid-payload-does-not-crash',async()=>{
    const response=await context.request.post(origin+'/api/command',{headers:{'content-type':'application/json'},data:'{bad json'});assert.ok([400,403].includes(response.status()));assert.equal((await context.request.get(origin+'/api/state')).status(),200);
  });
  await check('missing-static-asset-is-404',async()=>{const response=await context.request.get(origin+'/assets/nonexistent-audit.js');assert.equal(response.status(),404,`Missing JS returned ${response.status()} with ${response.headers()['content-type']}`);});
  await check('source-maps-not-served-publicly',async()=>{const manifest=JSON.parse(readFileSync('dist/.vite/manifest.json','utf8'));const entry=Object.values(manifest).find(item=>item.isEntry&&item.src==='index.html');const response=await context.request.get(origin+'/'+entry.file+'.map');assert.ok([403,404].includes(response.status()),`Application source map returned ${response.status()}`);});
  await check('sqlite-integrity-after-scenarios',async()=>{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);});
  await check('no-uncaught-browser-errors',async()=>assert.deepEqual(report.runtimeErrors,[]));
} finally {
  await browser.close();await new Promise(done=>server.close(done));
  report.finishedAt=new Date().toISOString();report.summary={total:report.cases.length,passed:report.cases.filter(item=>item.ok).length,failed:report.cases.filter(item=>!item.ok).length};
  writeFileSync(join(output,'extended-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));
  process.exitCode=report.summary.failed?1:0;
}

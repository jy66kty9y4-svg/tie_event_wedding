import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHttpServer } from '../server/http.mjs';

const bundledPlaywrightPath = '/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE_PATH) return import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE_PATH)));
  try { return await import('playwright'); }
  catch { return import(pathToFileURL(bundledPlaywrightPath)); }
}
const { chromium } = await loadPlaywright();
const root = mkdtempSync(join(tmpdir(), 'tie-browser-'));
const dist = join(root, 'dist');
const profiles = Object.fromEntries(['admin-a', 'admin-b', 'contractor', 'outsider', 'switch'].map(name => [name, join(root, name)]));
mkdirSync(dist);
for (const profile of Object.values(profiles)) mkdirSync(profile);
copyFileSync(resolve('src/client.js'), join(dist, 'client.js'));
copyFileSync(resolve('public/sw.js'), join(dist, 'sw.js'));
copyFileSync(resolve('public/icon.svg'), join(dist, 'icon.svg'));
copyFileSync(resolve('public/manifest.webmanifest'), join(dist, 'manifest.webmanifest'));
writeFileSync(join(dist, 'test-app.js'), `
  import * as client from '/client.js';
  window.tie = client;
  try {
    await client.initClient();
    await navigator.serviceWorker.ready;
    window.ready = true;
  } catch (error) {
    window.bootError = { message: error.message, stack: error.stack };
    window.ready = 'error';
  }
`);
writeFileSync(join(dist, 'index.html'), '<!doctype html><meta charset="utf-8"><title>tie offline test</title><main id="shell">offline shell</main><script type="module" src="/test-app.js"></script>');

const server = createHttpServer({ dbPath: join(root, 'browser.sqlite'), distDir: dist });
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
const contexts = new Set();
const browserErrors = [];

function watchPage(page) {
  page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
}

async function openDevice(profile, offline = false) {
  const context = await chromium.launchPersistentContext(profile, { executablePath: chromePath, headless: true });
  contexts.add(context);
  await context.setOffline(offline);
  const page = context.pages()[0] || await context.newPage();
  watchPage(page);
  await page.goto(origin);
  await page.waitForFunction(() => window.ready !== undefined);
  const boot = await page.evaluate(() => ({ ready: window.ready, error: window.bootError }));
  assert.equal(boot.ready, true, boot.error?.stack || boot.error?.message);
  return { context, page };
}

async function closeDevice(device) {
  if (!device) return;
  contexts.delete(device.context);
  await device.context.close();
}

async function login(page, email, password) {
  await page.evaluate(({ email, password }) => window.tie.api('/api/login', {
    method: 'POST', body: { slug: 'tie', email, password },
  }), { email, password });
  return page.evaluate(() => window.tie.loadState());
}

try {
  let adminA = await openDevice(profiles['admin-a']);
  const seeded = await adminA.page.evaluate(async () => {
    await window.tie.api('/api/setup', { method: 'POST', body: {
      slug: 'tie', agencyName: 'Browser Tie', name: 'Browser Admin',
      email: 'browser@example.test', password: 'browser-test-password',
    } });
    const project = await window.tie.command({ op: 'project.create', data: {
      name: 'Offline Pair', date: '2027-06-20', limit: 10000000,
    } });
    const state = await window.tie.loadState(project.id);
    const timing = state.entities.find(row => row.kind === 'table' && row.data.key === 'timing');
    const row = await window.tie.command({
      op: 'entity.create', projectId: project.id, kind: 'row', parentId: timing.id, schemaVersion: timing.version,
      data: { time: '12:00', end: '13:00', title: 'Ceremony', place: 'Garden', audience: 'Общее', people: 'All', responsible: 'Admin', done: false },
    });
    const obligation = await window.tie.command({
      op: 'entity.create', projectId: project.id, kind: 'obligation',
      data: { title: 'Contractor payout', priceKind: 'amount', agreed: 12345, planned: 12345, dueDate: '2027-06-20', fee: false },
    });
    await window.tie.prepareProject(project.id);
    const cacheUrls = (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat();
    return { projectId: project.id, timingId: timing.id, rowId: row.id, obligationId: obligation.id, cacheUrls };
  });
  assert(seeded.cacheUrls.some(url => url.endsWith('/test-app.js')));
  assert(seeded.cacheUrls.some(url => url.endsWith('/client.js')), 'transitive module was not precached');
  assert.equal(seeded.cacheUrls.some(url => new URL(url).pathname.startsWith('/api/')), false);
  await closeDevice(adminA);

  adminA = await openDevice(profiles['admin-a'], true);
  const firstOffline = await adminA.page.evaluate(async ids => {
    const dashboard = await window.tie.loadState();
    const state = await window.tie.loadState(ids.projectId);
    const row = state.entities.find(value => value.id === ids.rowId);
    const table = state.entities.find(value => value.id === row.parent_id);
    const obligation = state.entities.find(value => value.id === ids.obligationId);
    const edit = await window.tie.command({ op: 'entity.edit', projectId: ids.projectId, entityId: row.id, version: row.version, schemaVersion: table.version, data: { done: true } });
    const payment = await window.tie.command({
      op: 'movement.save', projectId: ids.projectId, obligationVersion: obligation.version,
      data: { type: 'payment', amount: 12345, date: '2027-06-20', description: 'Full contractor payout', source: 'direct', obligationId: obligation.id },
    });
    return { dashboardProjects: dashboard.projects.length, edit, payment, status: await window.tie.getOfflineStatus(ids.projectId) };
  }, seeded);
  assert.equal(firstOffline.dashboardProjects, 1);
  assert.match(firstOffline.edit.id, /^[0-9a-f-]{36}$/);
  assert.match(firstOffline.payment.id, /^[0-9a-f-]{36}$/);
  assert.equal(firstOffline.status.pending, 2);
  await closeDevice(adminA);

  adminA = await openDevice(profiles['admin-a'], true);
  const durable = await adminA.page.evaluate(async ids => {
    const state = await window.tie.loadState(ids.projectId);
    const row = state.entities.find(value => value.id === ids.rowId);
    const obligation = state.entities.find(value => value.id === ids.obligationId);
    return { shell: document.querySelector('#shell').textContent, done: row.data.done, paid: obligation.data.paid, due: obligation.data.due, status: await window.tie.getOfflineStatus(ids.projectId) };
  }, seeded);
  assert.deepEqual({ shell: durable.shell, done: durable.done, paid: durable.paid, due: durable.due, pending: durable.status.pending }, {
    shell: 'offline shell', done: true, paid: 12345, due: 0, pending: 2,
  });
  const syncTab = await adminA.context.newPage();
  watchPage(syncTab);
  await syncTab.goto(origin);
  await syncTab.waitForFunction(() => window.ready === true);
  await adminA.context.setOffline(false);
  const [firstSync, lockedSync] = await Promise.all([
    adminA.page.evaluate(() => window.tie.syncQueue()),
    syncTab.evaluate(() => window.tie.syncQueue()),
  ]);
  const replayed = await adminA.page.evaluate(async ids => {
    const repeated = await window.tie.syncQueue();
    const state = await window.tie.loadState(ids.projectId);
    return {
      repeated,
      payments: state.entities.filter(value => value.kind === 'movement' && value.data.obligationId === ids.obligationId).map(value => value.data.amount),
      paid: state.financials.paid[ids.obligationId],
    };
  }, seeded);
  assert.equal(firstSync.pending, 0);
  assert.equal(firstSync.conflicts.length, 0);
  assert.equal(lockedSync.pending, 0);
  assert.equal(replayed.repeated.pending, 0);
  assert.deepEqual(replayed.payments, [12345]);
  assert.equal(replayed.paid, 12345);
  await syncTab.close();

  const conflictSeed = await adminA.page.evaluate(async ids => {
    const obligation = await window.tie.command({
      op: 'entity.create', projectId: ids.projectId, kind: 'obligation',
      data: { title: 'Final settlement', priceKind: 'amount', agreed: 6789, planned: 6789, dueDate: '2027-06-20', fee: false },
    });
    await window.tie.prepareProject(ids.projectId);
    return { ...ids, conflictObligationId: obligation.id, conflictObligationVersion: obligation.version };
  }, seeded);

  const adminB = await openDevice(profiles['admin-b']);
  await login(adminB.page, 'browser@example.test', 'browser-test-password');
  await adminB.page.evaluate(projectId => window.tie.prepareProject(projectId), seeded.projectId);
  await adminA.context.setOffline(true);
  await adminB.context.setOffline(true);
  const paymentCommand = {
    op: 'movement.save', projectId: conflictSeed.projectId, obligationVersion: conflictSeed.conflictObligationVersion,
    data: { type: 'payment', amount: 6789, date: '2027-06-20', description: 'Full settlement', source: 'direct', obligationId: conflictSeed.conflictObligationId },
  };
  const [deviceACommand, deviceBCommand] = await Promise.all([
    adminA.page.evaluate(command => window.tie.command(command), paymentCommand),
    adminB.page.evaluate(command => window.tie.command(command), paymentCommand),
  ]);
  assert.notEqual(deviceACommand.id, deviceBCommand.id);
  await adminA.context.setOffline(false);
  assert.equal((await adminA.page.evaluate(() => window.tie.syncQueue())).pending, 0);
  await adminB.context.setOffline(false);
  const deviceBStatus = await adminB.page.evaluate(() => window.tie.syncQueue());
  assert.equal(deviceBStatus.pending, 0);
  assert.equal(deviceBStatus.conflicts.length, 1);
  assert.equal(deviceBStatus.conflicts[0].status, 409);
  assert.equal(deviceBStatus.conflicts[0].details.current.id, conflictSeed.conflictObligationId);
  const serverSettlement = await adminA.page.evaluate(async ids => {
    const state = await window.tie.loadState(ids.projectId);
    return state.entities.filter(value => value.kind === 'movement' && value.data.obligationId === ids.conflictObligationId).map(value => value.data.amount);
  }, conflictSeed);
  assert.deepEqual(serverSettlement, [6789]);
  await adminB.page.evaluate(id => window.tie.discardCommand(id), deviceBStatus.conflicts[0].id);

  const schemaSeed = await adminA.page.evaluate(async ids => {
    const state = await window.tie.loadState(ids.projectId);
    const timing = state.entities.find(value => value.id === ids.timingId);
    const table = await window.tie.command({
      op: 'entity.edit', projectId: ids.projectId, entityId: timing.id, version: timing.version,
      data: { columns: [...timing.data.columns, { id: 'offline_note', name: 'Offline note', type: 'text' }] },
    });
    const row = await window.tie.command({
      op: 'entity.create', projectId: ids.projectId, kind: 'row', parentId: table.id, schemaVersion: table.version,
      data: { time: '14:00', title: 'Dinner', offline_note: 'Server value' },
    });
    return { ...ids, schemaTableVersion: table.version, schemaRowId: row.id, schemaRowVersion: row.version };
  }, conflictSeed);
  await adminB.page.evaluate(projectId => window.tie.prepareProject(projectId), seeded.projectId);
  await adminB.context.setOffline(true);
  const queuedSchemaEdit = await adminB.page.evaluate(ids => window.tie.command({
    op: 'entity.edit', projectId: ids.projectId, entityId: ids.schemaRowId,
    version: ids.schemaRowVersion, schemaVersion: ids.schemaTableVersion, data: { offline_note: 'Unsynced local value' },
  }), schemaSeed);
  await adminA.page.evaluate(async ids => {
    const state = await window.tie.loadState(ids.projectId);
    const timing = state.entities.find(value => value.id === ids.timingId);
    await window.tie.command({
      op: 'entity.edit', projectId: ids.projectId, entityId: timing.id, version: timing.version,
      data: { columns: timing.data.columns.filter(column => column.id !== 'offline_note'), confirmStructure: true },
    });
  }, schemaSeed);
  await adminB.context.setOffline(false);
  const schemaConflict = await adminB.page.evaluate(() => window.tie.syncQueue());
  const schemaItem = schemaConflict.conflicts.find(item => item.id === queuedSchemaEdit.id);
  assert.equal(schemaItem.status, 409);
  assert.equal(schemaItem.details.table.id, seeded.timingId);
  const preservedAfterRefresh = await adminB.page.evaluate(async ids => {
    await window.tie.prepareProject(ids.projectId);
    const state = await window.tie.loadState(ids.projectId);
    return state.entities.find(value => value.id === ids.schemaRowId).data.offline_note;
  }, schemaSeed);
  assert.equal(preservedAfterRefresh, 'Unsynced local value');
  await adminB.page.evaluate(id => window.tie.discardCommand(id), queuedSchemaEdit.id);

  const contractorSeed = await adminA.page.evaluate(async ids => {
    const role = await window.tie.command({ op: 'role.save', name: 'Offline editor', permissions: ['read', 'edit'] });
    const scoped = await window.tie.loadState(ids.projectId);
    const timing = scoped.entities.find(value => value.id === ids.timingId);
    const row = await window.tie.command({
      op: 'entity.create', projectId: ids.projectId, kind: 'row', parentId: timing.id, schemaVersion: timing.version,
      data: { time: '16:00', title: 'Contractor arrival', done: false },
    });
    const invitation = await window.tie.command({
      op: 'invite.create', projectId: ids.projectId, email: 'contractor@example.test', roleId: role.id,
      restrictions: { sections: [timing.id], rows: [row.id], fields: ['done'] },
    });
    const refreshed = await window.tie.loadState();
    const savedRole = refreshed.roles.find(value => value.id === role.id);
    return { ...ids, contractorRoleId: role.id, contractorRoleVersion: savedRole.version, contractorRowId: row.id, invitation: invitation.token };
  }, schemaSeed);

  const contractor = await openDevice(profiles.contractor);
  await contractor.page.evaluate(async values => {
    await window.tie.api('/api/register', { method: 'POST', body: {
      slug: 'tie', name: 'Offline Contractor', email: 'contractor@example.test', password: 'contractor-password', invitation: values.invitation,
    } });
    await window.tie.loadState();
    await window.tie.prepareProject(values.projectId);
  }, contractorSeed);
  await contractor.context.setOffline(true);
  const revokedEdit = await contractor.page.evaluate(async ids => {
    const state = await window.tie.loadState(ids.projectId);
    const row = state.entities.find(value => value.id === ids.contractorRowId);
    const table = state.entities.find(value => value.id === row.parent_id);
    return window.tie.command({
      op: 'entity.edit', projectId: ids.projectId, entityId: row.id,
      version: row.version, schemaVersion: table.version, data: { done: true },
    });
  }, contractorSeed);
  await adminA.page.evaluate(ids => window.tie.command({
    op: 'role.save', roleId: ids.contractorRoleId, version: ids.contractorRoleVersion,
    name: 'Offline viewer', permissions: ['read'],
  }), contractorSeed);
  await contractor.context.setOffline(false);
  const revokedStatus = await contractor.page.evaluate(() => window.tie.syncQueue());
  const revokedItem = revokedStatus.conflicts.find(item => item.id === revokedEdit.id);
  assert.equal(revokedItem.status, 403);
  assert.equal(revokedItem.command.data.done, true);
  const revokedPreserved = await contractor.page.evaluate(async ids => {
    await window.tie.prepareProject(ids.projectId);
    const state = await window.tie.loadState(ids.projectId);
    let deniedStatus = null;
    try {
      await window.tie.command({
        op: 'entity.edit', projectId: ids.projectId, entityId: ids.contractorRowId,
        version: state.entities.find(value => value.id === ids.contractorRowId).version,
        schemaVersion: state.entities.find(value => value.id === ids.timingId).version,
        data: { done: false },
      });
    } catch (error) { deniedStatus = error.status; }
    return { done: state.entities.find(value => value.id === ids.contractorRowId).data.done, permissions: state.grants.flatMap(grant => grant.permissions), deniedStatus };
  }, contractorSeed);
  assert.equal(revokedPreserved.done, true);
  assert.equal(revokedPreserved.permissions.includes('edit'), false);
  assert.equal(revokedPreserved.deniedStatus, 403);

  const outsider = await openDevice(profiles.outsider);
  await outsider.page.evaluate(() => window.tie.api('/api/register', { method: 'POST', body: {
    slug: 'tie', name: 'Outside User', email: 'outside@example.test', password: 'outside-user-password',
  } }));
  await closeDevice(outsider);

  const switching = await openDevice(profiles.switch);
  await login(switching.page, 'browser@example.test', 'browser-test-password');
  await switching.page.evaluate(projectId => window.tie.prepareProject(projectId), seeded.projectId);
  const secondTab = await switching.context.newPage();
  watchPage(secondTab);
  await secondTab.goto(origin);
  await secondTab.waitForFunction(() => window.ready === true);
  await secondTab.evaluate(() => { window.clientEvents = []; window.stopClientEvents = window.tie.subscribe(event => window.clientEvents.push(event)); });
  await switching.page.evaluate(async () => {
    await window.tie.api('/api/login', { method: 'POST', body: { slug: 'tie', email: 'outside@example.test', password: 'outside-user-password' } });
    await window.tie.loadState();
  });
  await secondTab.waitForFunction(() => window.clientEvents.some(event => event.type === 'identity'));
  const switched = await secondTab.evaluate(async () => ({ state: await window.tie.loadState(), status: await window.tie.getOfflineStatus(), events: window.clientEvents }));
  assert.equal(switched.state.user.email, 'outside@example.test');
  assert.equal(switched.state.projects.length, 0);
  assert.equal(switched.status.projects.length, 0);
  assert(switched.events.some(event => event.type === 'identity'));

  await switching.context.setOffline(true);
  await switching.page.evaluate(() => window.tie.logout());
  await secondTab.waitForFunction(() => window.clientEvents.some(event => event.type === 'logout'));
  const crossTabLogout = await secondTab.evaluate(async () => {
    let status;
    try { await window.tie.loadState(); status = 200; } catch (error) { status = error.status; }
    return { status, offline: await window.tie.getOfflineStatus(), events: window.clientEvents };
  });
  assert.equal(crossTabLogout.status, 401);
  assert.equal(crossTabLogout.offline.projects.length, 0);
  assert(crossTabLogout.events.some(event => event.type === 'logout'));
  await switching.context.setOffline(false);
  const serverLogoutStatus = await secondTab.evaluate(async () => {
    try { await window.tie.loadState(); return 200; } catch (error) { return error.status; }
  });
  assert.equal(serverLogoutStatus, 401);
  const expectedBrowserFailure = /ERR_INTERNET_DISCONNECTED|status of (?:401|403|409) \(/;
  assert.deepEqual(browserErrors.filter(message => !expectedBrowserFailure.test(message)), []);

  console.log('Browser offline cold restart, exact payouts, durable sync, device/schema/rights conflicts, and identity isolation: OK');
} finally {
  await Promise.allSettled([...contexts].map(context => context.close()));
  await new Promise(resolveClose => server.close(resolveClose));
}

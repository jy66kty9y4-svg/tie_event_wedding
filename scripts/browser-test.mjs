import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHttpServer } from '../server/http.mjs';

const playwrightPath = '/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import(pathToFileURL(playwrightPath));
const root = mkdtempSync(join(tmpdir(), 'tie-browser-'));
const dist = join(root, 'dist'); const profile = join(root, 'profile');
mkdirSync(dist); mkdirSync(profile);
copyFileSync(resolve('src/client.js'), join(dist, 'client.js'));
copyFileSync(resolve('public/sw.js'), join(dist, 'sw.js'));
copyFileSync(resolve('public/icon.svg'), join(dist, 'icon.svg'));
copyFileSync(resolve('public/manifest.webmanifest'), join(dist, 'manifest.webmanifest'));
writeFileSync(join(dist, 'test-app.js'), "import * as client from '/client.js'; window.tie=client; window.ready=true;");
writeFileSync(join(dist, 'index.html'), '<!doctype html><meta charset="utf-8"><title>tie offline test</title><main id="shell">offline shell</main><script type="module" src="/test-app.js"></script>');
const server = createHttpServer({ dbPath: join(root, 'browser.sqlite'), distDir: dist });
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath, headless: true });
  let page = context.pages()[0] || await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller && window.ready);
  await page.evaluate(async () => {
    await window.tie.api('/api/setup', { method: 'POST', body: { slug: 'tie', agencyName: 'Browser Tie', name: 'Browser Admin', email: 'browser@example.test', password: 'browser-test-password' } });
    const project = await window.tie.command({ op: 'project.create', data: { name: 'Offline Pair', date: '2027-06-20', limit: 10000000 } });
    window.projectId = project.id;
    const state = await window.tie.loadState(project.id);
    const timing = state.entities.find(row => row.kind === 'table' && row.data.key === 'timing');
    const row = await window.tie.command({ op: 'entity.create', projectId: project.id, kind: 'row', parentId: timing.id, schemaVersion: timing.version, data: { time: '12:00', end: '13:00', title: 'Ceremony', place: 'Garden', audience: 'Общее', people: 'All', responsible: 'Admin', done: false } });
    await window.tie.prepareProject(project.id);
    sessionStorage.setItem('projectId', project.id); sessionStorage.setItem('rowId', row.id);
  });
  const projectId = await page.evaluate(() => sessionStorage.getItem('projectId'));
  const rowId = await page.evaluate(() => sessionStorage.getItem('rowId'));
  await context.close(); context = null;

  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath, headless: true });
  await context.setOffline(true);
  page = context.pages()[0] || await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.ready);
  const offline = await page.evaluate(async ({ projectId, rowId }) => {
    const dashboard = await window.tie.loadState();
    const state = await window.tie.loadState(projectId);
    const row = state.entities.find(value => value.id === rowId);
    const table = state.entities.find(value => value.id === row.parent_id);
    const queued = await window.tie.command({ op: 'entity.edit', projectId, entityId: row.id, version: row.version, schemaVersion: table.version, data: { done: true } });
    const changed = await window.tie.loadState(projectId);
    return { shell: document.querySelector('#shell').textContent, projects: dashboard.projects.length, queued, done: changed.entities.find(value => value.id === rowId).data.done };
  }, { projectId, rowId });
  assert.deepEqual(offline, { shell: 'offline shell', projects: 1, queued: { queued: true, id: offline.queued.id }, done: true });
  assert.match(offline.queued.id, /^[0-9a-f-]{36}$/);
  await context.setOffline(false);
  const synced = await page.evaluate(() => window.tie.syncQueue());
  assert.equal(synced.pending, 0); assert.equal(synced.conflicts.length, 0);
  await context.setOffline(true);
  await page.evaluate(() => window.tie.logout());
  await context.setOffline(false);
  const logoutStatus = await page.evaluate(async () => { try { await window.tie.loadState(); return 200; } catch (error) { return error.status; } });
  assert.equal(logoutStatus, 401);
  console.log('Browser offline reload, durable queue, sync, and offline logout: OK');
} finally {
  if (context) await context.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer, startServer } from '../server/http.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tie-runtime-'));
  const dist = join(root, 'dist'); mkdirSync(dist);
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>tie runtime</title><main>shell</main>');
  writeFileSync(join(dist, 'asset.js'), 'export default true');
  mkdirSync(join(dist,'assets'));
  writeFileSync(join(dist,'assets','app-AbC_1234.js'),'export default true');
  const server = createHttpServer({ dbPath: ':memory:', distDir: dist });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (jar.size) headers.set('cookie', [...jar].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(base + path, { ...options, headers });
    for (const value of response.headers.getSetCookie()) {
      const first = value.split(';', 1)[0]; const at = first.indexOf('=');
      jar.set(first.slice(0, at), decodeURIComponent(first.slice(at + 1)));
    }
    return response;
  }
  async function json(path, options = {}) {
    const response = await request(path, options);
    return { response, body: await response.json() };
  }
  const post = (path, body, withCsrf = true) => json(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(withCsrf ? { 'x-csrf-token': jar.get('tie_csrf') || '' } : {}) }, body: JSON.stringify(body) });
  return { base, jar, request, json, post };
}

test('HTTP bootstrap, sessions, CSRF, SPA and private cache controls', async t => {
  const app = await fixture(t);
  let result = await app.json('/api/public?agency=tie');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.setup, true);
  assert.ok(app.jar.get('tie_csrf')?.length >= 20);

  result = await app.post('/api/setup', { slug: 'tie', agencyName: 'Tie Test', name: 'Ada Test', email: 'ada@example.test', password: 'long-test-password' }, false);
  assert.equal(result.response.status, 403);

  result = await app.post('/api/setup', { slug: 'tie', agencyName: 'Tie Test', name: 'Ada Test', email: 'ada@example.test', password: 'long-test-password' });
  assert.equal(result.response.status, 201);
  assert.ok(app.jar.get('tie_session'));
  assert.match(result.response.headers.getSetCookie().join(';'), /HttpOnly/);

  result = await app.post('/api/setup', { slug: 'other', agencyName: 'Other', name: 'Other User', email: 'other@example.test', password: 'long-test-password' });
  assert.equal(result.response.status, 409);
  const stateStartedAt = performance.now();
  result = await app.json('/api/state');
  const stateResponseMs = performance.now() - stateStartedAt;
  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.email, 'ada@example.test');
  assert.match(result.response.headers.get('cache-control'), /no-store/);
  assert.ok(stateResponseMs <= 600, `Интерфейсное состояние сформировано за ${stateResponseMs.toFixed(1)} мс вместо максимум 600 мс`);

  const shell = await app.request('/projects/not-a-file');
  assert.equal(shell.status, 200);
  assert.equal(await shell.text(), '<!doctype html><title>tie runtime</title><main>shell</main>');
  assert.equal(shell.headers.get('cache-control'), 'no-cache');
  const module=await app.request('/assets/app-AbC_1234.js');
  assert.equal(module.status,200);
  assert.equal(module.headers.get('cache-control'),'public, max-age=31536000, immutable');
  const publicFile=await app.request('/asset.js');
  assert.equal(publicFile.headers.get('cache-control'),'public, max-age=3600');
  const traversal = await app.request('/..%2Fpackage.json');
  assert.equal(traversal.status, 404);
});

test('login remembers the session only when requested, with persistence as the default', async t => {
  const app = await fixture(t);
  await app.json('/api/public');
  const credentials = { slug: 'tie', email: 'session@example.test', password: 'long-test-password' };
  await app.post('/api/setup', { ...credentials, agencyName: 'Tie', name: 'Session user' });
  for (const rememberSession of [false, true, undefined]) {
    await app.post('/api/logout', {});
    const result = await app.post('/api/login', { ...credentials, ...(rememberSession === undefined ? {} : { rememberSession }) });
    assert.equal(result.response.status, 200);
    const sessionCookie = result.response.headers.getSetCookie().find(value => value.startsWith('tie_session='));
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /SameSite=Strict/);
    if (rememberSession === false) assert.doesNotMatch(sessionCookie, /Max-Age|Expires/);
    else assert.match(sessionCookie, /Max-Age=604800/);
    assert.equal((await app.json('/api/state')).body.user.email, credentials.email);
  }
  const loggedOut = await app.post('/api/logout', {});
  assert.match(loggedOut.response.headers.getSetCookie().join(';'), /tie_session=.*Max-Age=0/);
  assert.equal((await app.json('/api/state')).response.status, 401);
});

test('phone registration and single-request login work through the HTTP API with CSRF and session cookies', async t => {
  const app = await fixture(t);
  await app.json('/api/public');
  await app.post('/api/setup', { slug: 'tie', agencyName: 'Tie', name: 'Owner', email: 'phone-owner@example.test', password: 'long-test-password' });
  await app.post('/api/logout', {});
  const account = { name: 'Phone user', email: 'phone-user@example.test', phone: '8 (999) 123-45-67', password: 'phone-http-password' };
  assert.equal((await app.post('/api/register', account, false)).response.status, 403);
  for (const field of ['email', 'phone']) {
    const incomplete = { ...account };
    delete incomplete[field];
    assert.equal((await app.post('/api/register', incomplete)).response.status, 400);
  }
  assert.equal((await app.post('/api/register', { ...account, phone: '+799912345678' })).response.status, 400);
  const registered = await app.post('/api/register', account);
  assert.equal(registered.response.status, 201);
  assert.equal(registered.body.user.phone, '+79991234567');
  assert.equal(registered.body.user.email, account.email);
  assert.equal('password' in registered.body.user, false);
  assert.match(registered.response.headers.getSetCookie().join(';'), /HttpOnly/);
  assert.equal((await app.json('/api/state')).body.user.id, registered.body.user.id);
  await app.post('/api/logout', {});
  assert.equal((await app.post('/api/register', { ...account, phone: '9991234567' })).response.status, 409);
  assert.equal((await app.post('/api/login', { identifier: '+7 999 123 45 67', password: 'wrong-password' })).response.status, 401);
  const loggedIn = await app.post('/api/login', { identifier: '9991234567', password: account.password, rememberSession: false });
  assert.equal(loggedIn.response.status, 200);
  assert.equal(loggedIn.body.user.id, registered.body.user.id);
  assert.doesNotMatch(loggedIn.response.headers.getSetCookie().find(value => value.startsWith('tie_session=')), /Max-Age|Expires/);
  assert.equal((await app.json('/api/state')).body.user.phone, '+79991234567');
});

test('commands, bounded uploads, authorized downloads and logout', async t => {
  const app = await fixture(t);
  await app.json('/api/public');
  await app.post('/api/setup', { slug: 'tie', agencyName: 'Tie Test', name: 'Ada Test', email: 'ada@example.test', password: 'long-test-password' });
  let result = await app.post('/api/command', { id: 'create-project-0001', op: 'project.create', data: { name: 'Demo Pair', date: '2027-06-10', limit: 10000000 } });
  assert.equal(result.response.status, 200);
  const projectId = result.body.id;
  result = await app.json(`/api/offline?project=${projectId}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.offline, true);
  assert.equal(result.body.entities.some(row => row.kind === 'table' && row.data.key === 'timing'), true);
  assert.equal(result.body.entities.some(row => row.kind === 'table' && row.data.key === 'guests'), false);

  result = await app.post(`/api/files?project=${projectId}`, { name: 'note.html', mime: 'text/html', content: Buffer.from('<script>alert(1)</script>').toString('base64') });
  assert.equal(result.response.status, 201);
  const file = await app.request(`/api/files/${result.body.id}`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /^attachment;/);
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.match(file.headers.get('cache-control'), /no-store/);

  result = await app.post('/api/logout', {});
  assert.equal(result.response.status, 200);
  result = await app.json('/api/state');
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, 'Войдите в аккаунт');
});

test('errors are JSON without stack traces and body size is bounded', async t => {
  const app = await fixture(t);
  await app.json('/api/public');
  let result = await app.post('/api/setup', { broken: true });
  assert.equal(result.response.status, 400);
  assert.equal('stack' in result.body, false);
  const response = await app.request('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': app.jar.get('tie_csrf') }, body: JSON.stringify({ padding: 'x'.repeat(12 * 1024 * 1024) }) });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /12 МБ/);
});

test('remote binding requires explicit deployment opt-in',async t=>{
 await assert.rejects(startServer({host:'0.0.0.0',port:0,dbPath:':memory:'}),/TIE_ALLOW_REMOTE/);
 const server=await startServer({host:'0.0.0.0',port:0,allowRemote:true,dbPath:':memory:'});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
});

test('XLSX downloads require a session and preserve Unicode attachment names with private cache controls',async t=>{
 const app=await fixture(t);
 assert.equal((await app.request('/api/export.xlsx?kind=agencyFinance')).status,401);
 await app.json('/api/public');await app.post('/api/setup',{slug:'tie',agencyName:'Тест экспорта',name:'Owner',email:'export-owner@example.test',password:'long-test-password'});
 const created=await app.post('/api/command',{id:crypto.randomUUID(),op:'project.create',data:{name:'Анна и Иван',date:'2027-06-12'}});assert.equal(created.response.status,200);
 const project=created.body.id,state=await app.json(`/api/state?project=${project}`),table=state.body.entities.find(row=>row.kind==='table');
 for(const kind of ['budget','table','financeSheet']){
  const response=await app.request(`/api/export.xlsx?project=${project}&kind=${kind}&table=${table.id}`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml/);assert.match(response.headers.get('content-disposition'),/filename\*=UTF-8''/);assert.match(response.headers.get('cache-control'),/no-store/);const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
 }
 assert.equal((await app.request('/api/export.xlsx?kind=agencyFinance')).status,200);
 assert.equal((await app.request(`/api/export.xlsx?project=${project}&kind=table&table=missing`)).status,404);
 await app.post('/api/logout',{});await app.post('/api/register',{name:'Pending',email:'export-pending@example.test',phone:'+79991234567',password:'pending-test-password'});
 assert.equal((await app.request(`/api/export.xlsx?project=${project}&kind=budget`)).status,403);
});

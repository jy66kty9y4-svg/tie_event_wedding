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
  result = await app.json('/api/state');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.user.email, 'ada@example.test');
  assert.match(result.response.headers.get('cache-control'), /no-store/);

  const shell = await app.request('/projects/not-a-file');
  assert.equal(shell.status, 200);
  assert.equal(await shell.text(), '<!doctype html><title>tie runtime</title><main>shell</main>');
  assert.equal(shell.headers.get('cache-control'), 'no-cache');
  const traversal = await app.request('/..%2Fpackage.json');
  assert.equal(traversal.status, 404);
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

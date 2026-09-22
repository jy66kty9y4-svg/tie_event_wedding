import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHttpServer } from '../server/http.mjs';

const secret = 'tie-control-test-secret-with-at-least-32-characters';
const controlHost = 'tie-event-control:4173';
const actor = 'test-owner';

function http(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject); if (body !== undefined) req.write(body); req.end();
  });
}
function json(response) { return response.text ? JSON.parse(response.text) : null; }
function firstCookie(headers, name) {
  const values = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']].filter(Boolean);
  return values.find(value => value.startsWith(`${name}=`))?.split(';')[0] || '';
}
function controlHeaders(method, path, raw = '', { requestId = randomUUID(), nonce = randomUUID(), badSignature = false } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = createHash('sha256').update(raw).digest('hex');
  const canonical = ['v1', method, path, timestamp, nonce, actor, requestId, bodyHash].join('\n');
  let signature = createHmac('sha256', secret).update(canonical).digest('hex');
  if (badSignature) signature = `${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`;
  return { Host: controlHost, 'Content-Type': 'application/json', 'X-Orbit-Timestamp': timestamp, 'X-Orbit-Nonce': nonce, 'X-Orbit-Actor': actor, 'X-Orbit-Request-Id': requestId, 'X-Orbit-Signature': signature };
}
async function control(port, method, path, body, options = {}) {
  const raw = method === 'GET' ? '' : JSON.stringify(body);
  const response = await http(port, path, { method, body: method === 'GET' ? undefined : raw, headers: controlHeaders(method, path, raw, options) });
  return { response, data: json(response) };
}
async function csrf(port) {
  const response = await http(port, '/api/health'); const cookie = firstCookie(response.headers, 'tie_csrf');
  return { cookie, value: decodeURIComponent(cookie.split('=')[1]) };
}
async function publicPost(port, path, body, csrfState, extra = {}) {
  const raw = JSON.stringify(body); return http(port, path, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', Cookie: csrfState.cookie, 'X-CSRF-Token': csrfState.value, ...extra } });
}

test('Orbitpanel control authenticates, revokes real tie.event sessions, and enforces bans', async () => {
  const oldSecret = process.env.ORBIT_TIE_HMAC_SECRET;
  const oldTrusted = process.env.ORBIT_TIE_TRUSTED_PROXY_IPS;
  process.env.ORBIT_TIE_HMAC_SECRET = secret;
  process.env.ORBIT_TIE_TRUSTED_PROXY_IPS = '127.0.0.1';
  const work = await mkdtemp(join(tmpdir(), 'tie-orbit-control-'));
  const server = createHttpServer({ dbPath: join(work, 'tie.sqlite'), distDir: join(work, 'dist') });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  try {
    const csrfState = await csrf(port);
    const setup = await publicPost(port, '/api/setup', { slug: 'tie', agencyName: 'Tie test', email: 'owner@example.test', name: 'Owner', password: 'correct-horse-battery' }, csrfState);
    assert.equal(setup.status, 201);
    const ownerCookie = firstCookie(setup.headers, 'tie_session');
    const registration = await publicPost(port, '/api/register', { slug: 'tie', email: 'member@example.test', name: 'Member', password: 'correct-horse-battery' }, csrfState, { 'X-Forwarded-For': '8.8.8.8', 'User-Agent': 'tie-control-test' });
    assert.equal(registration.status, 201);
    const firstSessionCookie = firstCookie(registration.headers, 'tie_session');
    const login = await publicPost(port, '/api/login', { slug: 'tie', email: 'member@example.test', password: 'correct-horse-battery' }, csrfState, { 'X-Forwarded-For': '8.8.8.8', 'User-Agent': 'tie-control-test' });
    assert.equal(login.status, 200);
    const secondSessionCookie = firstCookie(login.headers, 'tie_session');

    assert.equal((await http(port, '/api/internal/orbitpanel/summary')).status, 404);
    assert.equal((await http(port, '/api/internal/orbitpanel/summary', { headers: { Host: controlHost } })).status, 401);
    assert.equal((await control(port, 'GET', '/api/internal/orbitpanel/summary', undefined, { badSignature: true })).response.status, 401);
    const summary = await control(port, 'GET', '/api/internal/orbitpanel/summary'); assert.equal(summary.response.status, 200); assert.equal(summary.data.data.siteId, 'tie-event'); assert.equal(summary.data.data.activeBans, 0);
    const listed = await control(port, 'GET', '/api/internal/orbitpanel/users'); assert.equal(listed.response.status, 200);
    const owner = listed.data.data.find(row => row.protected); const member = listed.data.data.find(row => row.identity === 'member@example.test'); assert.ok(owner && member && member.access_allowed);
    const guestId=randomUUID(), inviteId=randomUUID(), guestDigest='guest-session-digest';
    const agencyId=server.db.prepare('SELECT agency_id FROM users WHERE id=?').get(member.id).agency_id;
    server.db.prepare('INSERT INTO guest_invites(id,digest,agency_id,project_id,guest_table_id,expires_at,revoked_at,created_by,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(inviteId,'invite-digest',agencyId,'guest-project','guest-table',Date.now()+86400000,null,owner.id,1,new Date().toISOString());
    server.db.prepare('INSERT INTO guest_sessions VALUES(?,?,?,?,?,?)').run(guestDigest,inviteId,Date.now()+86400000,1,'guest-csrf',new Date().toISOString());
    server.db.prepare('INSERT INTO orbit_guest_session_registry VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(guestId,guestDigest,inviteId,new Date().toISOString(),Date.now()+86400000,'8.8.8.8','guest-test',null,null,null,new Date().toISOString());
    const active = await control(port, 'GET', '/api/internal/orbitpanel/sessions?status=active'); const memberSessions = active.data.data.filter(row => row.user_id === member.id); assert.equal(memberSessions.length, 2); assert.ok(memberSessions.every(row => !JSON.stringify(row).includes('tie_session')));
    const guestSession=active.data.data.find(row=>row.id===guestId); assert.equal(guestSession.session_kind,'guest_invite'); assert.equal(guestSession.user_id,null);
    assert.equal((await control(port,'POST',`/api/internal/orbitpanel/sessions/${guestId}/terminate`,{reason:'Revoke guest RSVP session'})).response.status,200);
    assert.equal(server.db.prepare('SELECT count(*) AS count FROM guest_sessions WHERE digest=?').get(guestDigest).count,0);

    const one = await control(port, 'POST', `/api/internal/orbitpanel/sessions/${memberSessions[0].id}/terminate`, { reason: 'Close one active session' }); assert.equal(one.response.status, 200);
    const firstState = await http(port, '/api/state', { headers: { Cookie: firstSessionCookie } }); const secondState = await http(port, '/api/state', { headers: { Cookie: secondSessionCookie } });
    assert.deepEqual([firstState.status, secondState.status].sort(), [200, 401]);
    assert.ok(!(firstState.text + secondState.text).includes((firstSessionCookie.split('=')[1] || '').slice(0, 24)));
    const all = await control(port, 'POST', `/api/internal/orbitpanel/users/${member.id}/terminate-sessions`, { reason: 'Close all active sessions' }); assert.equal(all.response.status, 200); assert.equal(all.data.data.terminatedCount, 1);
    assert.equal((await http(port, '/api/state', { headers: { Cookie: firstState.status === 200 ? firstSessionCookie : secondSessionCookie } })).status, 401);

    const third = await publicPost(port, '/api/login', { slug: 'tie', email: 'member@example.test', password: 'correct-horse-battery' }, csrfState, { 'X-Forwarded-For': '8.8.8.8' }); assert.equal(third.status, 200); const thirdCookie = firstCookie(third.headers, 'tie_session');
    const disabled = await control(port, 'POST', `/api/internal/orbitpanel/users/${member.id}/set-enabled`, { enabled: false, reason: 'Security test block' }); assert.equal(disabled.response.status, 200); assert.equal(disabled.data.data.enabled, false);
    assert.equal((await http(port, '/api/state', { headers: { Cookie: thirdCookie, 'X-Forwarded-For': '8.8.8.8' } })).status, 401);
    assert.equal((await publicPost(port, '/api/login', { slug: 'tie', email: 'member@example.test', password: 'correct-horse-battery' }, csrfState)).status, 401);
    assert.equal((await control(port, 'POST', `/api/internal/orbitpanel/users/${member.id}/set-enabled`, { enabled: true, reason: 'Security test unblock' })).response.status, 200);
    assert.equal((await http(port, '/api/state', { headers: { Cookie: thirdCookie } })).status, 401);
    assert.equal((await publicPost(port, '/api/login', { slug: 'tie', email: 'member@example.test', password: 'correct-horse-battery' }, csrfState)).status, 200);

    assert.equal((await control(port, 'POST', `/api/internal/orbitpanel/users/${owner.id}/set-enabled`, { enabled: false, reason: 'Protected account check' })).response.status, 403);
    const replayId = randomUUID(); const replayNonce = randomUUID();
    assert.equal((await control(port, 'POST', `/api/internal/orbitpanel/users/${member.id}/terminate-sessions`, { reason: 'Replay check' }, { requestId: replayId, nonce: replayNonce })).response.status, 200);
    assert.equal((await control(port, 'POST', `/api/internal/orbitpanel/users/${member.id}/terminate-sessions`, { reason: 'Replay check' }, { requestId: replayId, nonce: replayNonce })).response.status, 409);
    assert.equal((await control(port, 'POST', `/api/internal/orbitpanel/users/${member.id}/terminate-sessions`, { reason: 'Replay check' }, { requestId: replayId })).response.status, 200);
    assert.equal((await control(port, 'POST', `/api/internal/orbitpanel/users/${member.id}/terminate-sessions`, { reason: 'Different reason' }, { requestId: replayId })).response.status, 409);

    const ban = await control(port, 'POST', '/api/internal/orbitpanel/ip-bans', { network: '8.8.8.8', reason: 'Test public IP restriction', expiresAt: null }); assert.equal(ban.response.status, 201); assert.equal(ban.data.data.network, '8.8.8.8');
    assert.equal((await http(port, '/api/state', { headers: { Cookie: ownerCookie, 'X-Forwarded-For': '8.8.8.8' } })).status, 403);
    process.env.ORBIT_TIE_TRUSTED_PROXY_IPS = '192.0.2.10';
    assert.equal((await http(port, '/api/state', { headers: { Cookie: ownerCookie, 'X-Forwarded-For': '8.8.8.8' } })).status, 200);
    process.env.ORBIT_TIE_TRUSTED_PROXY_IPS = '127.0.0.1';
    assert.equal((await control(port, 'GET', '/api/internal/orbitpanel/ip-bans?state=active')).response.status, 200);
    assert.equal((await control(port, 'POST', `/api/internal/orbitpanel/ip-bans/${ban.data.data.id}/revoke`, { reason: 'Test completed' })).response.status, 200);
    const ownerLogin = await publicPost(port, '/api/login', { slug: 'tie', email: 'owner@example.test', password: 'correct-horse-battery' }, csrfState); assert.equal(ownerLogin.status, 200);
    const ownerReloginCookie = firstCookie(ownerLogin.headers, 'tie_session');
    const beforeLogout = await control(port, 'GET', '/api/internal/orbitpanel/sessions?status=active'); const ownerActiveBefore = beforeLogout.data.data.filter(row => row.user_id === owner.id).length;
    assert.equal((await publicPost(port, '/api/logout', {}, csrfState, { Cookie: `${csrfState.cookie}; ${ownerReloginCookie}` })).status, 200);
    assert.equal((await http(port, '/api/state', { headers: { Cookie: ownerReloginCookie } })).status, 401);
    const afterLogout = await control(port, 'GET', '/api/internal/orbitpanel/sessions?status=active'); assert.equal(afterLogout.data.data.filter(row => row.user_id === owner.id).length, ownerActiveBefore - 1);
    const audit = await control(port, 'GET', '/api/internal/orbitpanel/audit'); assert.equal(audit.response.status, 200); assert.ok(audit.data.data.length >= 6);
  } finally {
    await new Promise(resolve => server.close(resolve)); await rm(work, { recursive: true, force: true });
    if (oldSecret === undefined) delete process.env.ORBIT_TIE_HMAC_SECRET; else process.env.ORBIT_TIE_HMAC_SECRET = oldSecret;
    if (oldTrusted === undefined) delete process.env.ORBIT_TIE_TRUSTED_PROXY_IPS; else process.env.ORBIT_TIE_TRUSTED_PROXY_IPS = oldTrusted;
  }
});

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { now, transaction, uid } from './db.mjs';

const SITE_ID = 'tie-event';
const PRIVATE_HOST = 'tie-event-control:4173';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_PREFIX = '/api/internal/orbitpanel/';

const hash = value => createHash('sha256').update(value).digest('hex');
const controlError = (status, code, message) => ({ status, body: { error: { code, message } } });
const success = (data, status = 200) => ({ status, body: { data } });
const iso = () => new Date().toISOString();
const validHeader = value => typeof value === 'string' && value.length >= 8 && value.length <= 120 && /^[\x21-\x7e]+$/.test(value);

export function privateControlHost(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProto = req.headers['x-forwarded-proto'];
  return host === PRIVATE_HOST && (!forwardedHost || forwardedHost === PRIVATE_HOST) && (!forwardedProto || forwardedProto === 'http');
}

function parseIpv4(value) {
  const pieces = value.split('.');
  if (pieces.length !== 4 || pieces.some(piece => !/^\d{1,3}$/.test(piece) || Number(piece) > 255)) return null;
  return Uint8Array.from(pieces.map(Number));
}
function ipv6Bytes(value) {
  let input = value.toLowerCase();
  const ipv4At = input.lastIndexOf(':');
  if (input.includes('.')) {
    const tail = parseIpv4(input.slice(ipv4At + 1)); if (!tail) return null;
    input = `${input.slice(0, ipv4At + 1)}${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`;
  }
  const double = input.indexOf('::');
  if (double !== input.lastIndexOf('::')) return null;
  const left = double < 0 ? input.split(':') : input.slice(0, double).split(':').filter(Boolean);
  const right = double < 0 ? [] : input.slice(double + 2).split(':').filter(Boolean);
  if (left.length + right.length > 8 || (double < 0 && left.length !== 8) || [...left, ...right].some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  const out = new Uint8Array(16); groups.forEach((part, index) => { const number = Number.parseInt(part, 16); out[index * 2] = number >> 8; out[index * 2 + 1] = number & 255; });
  return out;
}
function parsedIp(value) {
  const raw = String(value || '').trim().replace(/^\[|\]$/g, '');
  const kind = isIP(raw); if (!kind) return null;
  const bytes = kind === 4 ? parseIpv4(raw) : ipv6Bytes(raw);
  if (!bytes) return null;
  // Docker and Node may report an IPv4 peer as an IPv4-mapped IPv6 address.
  // Normalize both textual forms before applying trusted-peer or ban checks.
  if (kind === 6 && bytes.slice(0, 10).every(byte => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    const mapped = bytes.slice(12); return { kind: 4, bytes: mapped, text: [...mapped].join('.') };
  }
  return { kind, bytes, text: raw };
}
function network(value, { strict = false } = {}) {
  const raw = String(value || '').trim(); const match = raw.match(/^([^/]+?)(?:\/(\d{1,3}))?$/); if (!match) return null;
  const ip = parsedIp(match[1]); if (!ip) return null;
  // Orbitpanel currently exposes exact-address bans. This makes the control
  // scope explicit and avoids accidentally blocking a broad customer network.
  if (strict && match[2] !== undefined) return null;
  const prefix = match[2] === undefined ? ip.bytes.length * 8 : Number(match[2]);
  if (prefix < 0 || prefix > ip.bytes.length * 8) return null;
  const bytes = Uint8Array.from(ip.bytes); for (let bit = prefix; bit < bytes.length * 8; bit += 1) bytes[Math.floor(bit / 8)] &= ~(1 << (7 - (bit % 8)));
  const canonicalIp = ip.kind === 4 ? [...bytes].join('.') : ip.text;
  return { kind: ip.kind, bytes, prefix, canonical: match[2] === undefined ? canonicalIp : `${canonicalIp}/${prefix}` };
}
function contains(net, input) {
  const ip = parsedIp(input); if (!net || !ip || net.kind !== ip.kind) return false;
  for (let bit = 0; bit < net.prefix; bit += 1) if ((net.bytes[Math.floor(bit / 8)] & (1 << (7 - bit % 8))) !== (ip.bytes[Math.floor(bit / 8)] & (1 << (7 - bit % 8)))) return false;
  return true;
}
function publicNetwork(net) {
  if (net.kind === 4) {
    const [a, b] = net.bytes;
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 0 || b === 168)) && !(a === 198 && (b === 18 || b === 19));
  }
  const first = net.bytes[0], second = net.bytes[1];
  return first !== 0 && first !== 255 && (first & 0xfe) !== 0xfc && !(first === 0xfe && (second & 0xc0) === 0x80);
}
function configuredNetworks(name) {
  return String(process.env[name] || '').split(',').map(item => network(item.trim())).filter(Boolean);
}
function peerIp(req) { return parsedIp(req.socket?.remoteAddress)?.text || null; }
export function clientIp(req, { trustedProxyIps = configuredNetworks('ORBIT_TIE_TRUSTED_PROXY_IPS') } = {}) {
  const peer = peerIp(req); const trusted = peer && trustedProxyIps.some(item => contains(item, peer));
  if (!trusted) return peer;
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  return !forwarded.includes(',') && parsedIp(forwarded)?.text ? parsedIp(forwarded).text : peer;
}
export function activeIpBan(db, ip) {
  if (!ip) return null;
  const rows = db.prepare('SELECT * FROM orbit_ip_bans WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').all(iso());
  return rows.find(row => contains(network(row.network), ip)) || null;
}

function ensureRegistry(db) {
  const at = iso();
  for (const session of db.prepare('SELECT digest,user_id,expires FROM sessions').all()) {
    db.prepare(`INSERT OR IGNORE INTO orbit_session_registry(id,digest,user_id,issued_at,expires,last_activity_at,observed_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(uid(), session.digest, session.user_id, new Date(Number(session.expires) - 7 * 86400000).toISOString(), session.expires, null, null, at);
  }
}
function sessionStatus(row) { return row.revoked_at ? 'revoked' : Number(row.expires) <= Date.now() ? 'expired' : 'active'; }
function users(db) {
  ensureRegistry(db);
  return db.prepare('SELECT * FROM users ORDER BY name,id').all().map(user => ({
    site_id: SITE_ID, kind: 'portal_account', id: user.id, display_name: user.name, identity: user.email,
    enabled: !user.disabled, created_at: null, roles: db.prepare('SELECT COALESCE(r.key,r.name) AS role FROM grants g JOIN roles r ON r.id=g.role_id WHERE g.user_id=? ORDER BY role').all(user.id).map(row => row.role),
    active_session_count: Number(db.prepare('SELECT count(*) AS count FROM orbit_session_registry WHERE user_id=? AND revoked_at IS NULL AND expires>?').get(user.id, Date.now()).count),
    last_seen_at: db.prepare('SELECT max(last_activity_at) AS value FROM orbit_session_registry WHERE user_id=?').get(user.id).value || null,
    protected: !!user.protected, access_allowed: !user.disabled,
  }));
}
function sessions(db, status) {
  ensureRegistry(db);
  const accounts = db.prepare(`SELECT s.*,u.name AS display_name FROM orbit_session_registry s JOIN users u ON u.id=s.user_id ORDER BY coalesce(s.last_activity_at,s.issued_at) DESC`).all()
    .filter(row => status === 'all' || sessionStatus(row) === status).map(row => ({
      id: row.id, user_id: row.user_id, display_name: row.display_name, issued_at: row.issued_at, last_activity_at: row.last_activity_at,
      expires_at: new Date(Number(row.expires)).toISOString(), revoked_at: row.revoked_at, site_id: SITE_ID, client_ip: row.client_ip,
      user_agent: row.user_agent || '', observed_at: row.observed_at, status: sessionStatus(row), session_kind: 'account',
    }));
  const guests = db.prepare(`SELECT s.*,coalesce(json_extract(e.data,'$.name'),'RSVP приглашение') AS display_name FROM orbit_guest_session_registry s LEFT JOIN guest_invites i ON i.id=s.invite_id LEFT JOIN entities e ON e.id=i.project_id`).all()
    .filter(row => status === 'all' || sessionStatus(row) === status).map(row => ({id:row.id,user_id:null,display_name:row.display_name,issued_at:row.issued_at,last_activity_at:row.last_activity_at,expires_at:new Date(Number(row.expires)).toISOString(),revoked_at:row.revoked_at,site_id:SITE_ID,client_ip:row.client_ip,user_agent:row.user_agent||'',observed_at:row.observed_at,status:sessionStatus(row),session_kind:'guest_invite'}));
  return [...accounts,...guests].sort((a,b) => String(b.last_activity_at||b.issued_at).localeCompare(String(a.last_activity_at||a.issued_at)));
}
function auditRows(db) { return db.prepare('SELECT * FROM orbit_audit ORDER BY occurred_at DESC,id DESC LIMIT 200').all().map(row => ({ ...row, details: JSON.parse(row.details_json), details_json: undefined })); }
function banRow(row) { return { id: row.id, site_id: SITE_ID, network: row.network, reason: row.reason, created_by: row.created_by, created_at: row.created_at, expires_at: row.expires_at, revoked_at: row.revoked_at, revoked_by: row.revoked_by, revoke_reason: row.revoke_reason }; }
function bans(db, state) {
  const at = iso(); let rows = db.prepare('SELECT * FROM orbit_ip_bans ORDER BY created_at DESC,id DESC LIMIT 200').all();
  if (state === 'active') rows = rows.filter(row => !row.revoked_at && (!row.expires_at || row.expires_at > at));
  if (state === 'revoked') rows = rows.filter(row => !!row.revoked_at);
  return rows.map(banRow);
}
function writeAudit(db, actor, action, targetType, targetId, reason, outcome, requestId, details) {
  db.prepare('INSERT INTO orbit_audit VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid(), iso(), actor, action, targetType, targetId, reason, outcome, requestId, JSON.stringify(details));
}
function previousMutation(db, action, target, bodyHash, requestId) {
  const existing = db.prepare('SELECT * FROM orbit_idempotency WHERE request_id=?').get(requestId);
  if (!existing) return null;
  if (existing.action !== action || existing.target_id !== target || existing.body_sha256 !== bodyHash) return controlError(409, 'request_id_conflict', 'Идентификатор запроса уже использован для другой операции.');
  return { status: existing.status, body: JSON.parse(existing.response_json) };
}
function saveMutation(db, action, target, bodyHash, requestId, response) {
  db.prepare('INSERT INTO orbit_idempotency VALUES(?,?,?,?,?,?,?)').run(requestId, action, target, bodyHash, response.status, JSON.stringify(response.body), iso());
  return response;
}
function isFullAdmin(db, user) { return !!user.protected || !!db.prepare("SELECT 1 FROM grants g JOIN roles r ON r.id=g.role_id WHERE g.user_id=? AND r.key='admin' AND g.project_id IS NULL LIMIT 1").get(user.id); }
function enabledFullAdminCount(db) { return db.prepare("SELECT count(DISTINCT u.id) AS count FROM users u LEFT JOIN grants g ON g.user_id=u.id LEFT JOIN roles r ON r.id=g.role_id WHERE u.disabled=0 AND (u.protected=1 OR (r.key='admin' AND g.project_id IS NULL))").get().count; }
function revokeUserSessions(db, userId, revokedAt = iso()) {
  const current = db.prepare('SELECT digest FROM sessions WHERE user_id=? AND expires>?').all(userId, Date.now());
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
  db.prepare('UPDATE orbit_session_registry SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND revoked_at IS NULL AND expires>?').run(revokedAt, userId, Date.now());
  return current.length;
}
function revokeIpSessions(db, net, revokedAt) {
  ensureRegistry(db); const rows = db.prepare('SELECT digest,client_ip FROM orbit_session_registry WHERE revoked_at IS NULL AND expires>? AND client_ip IS NOT NULL').all(Date.now()).filter(row => contains(net, row.client_ip));
  for (const row of rows) db.prepare('DELETE FROM sessions WHERE digest=?').run(row.digest);
  if (rows.length) db.prepare(`UPDATE orbit_session_registry SET revoked_at=? WHERE digest IN (${rows.map(() => '?').join(',')})`).run(revokedAt, ...rows.map(row => row.digest));
  const guests=db.prepare('SELECT digest,client_ip FROM orbit_guest_session_registry WHERE revoked_at IS NULL AND expires>? AND client_ip IS NOT NULL').all(Date.now()).filter(row=>contains(net,row.client_ip));
  for(const row of guests) db.prepare('DELETE FROM guest_sessions WHERE digest=?').run(row.digest);
  if(guests.length) db.prepare(`UPDATE orbit_guest_session_registry SET revoked_at=? WHERE digest IN (${guests.map(()=>'?').join(',')})`).run(revokedAt,...guests.map(row=>row.digest));
  return rows.length+guests.length;
}
function parseBody(raw) { try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null; } catch { return null; } }
function reasonFrom(body) { const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''; return reason.length >= 3 && reason.length <= 500 ? reason : null; }

function authenticate(db, req, url, raw) {
  const secret = process.env.ORBIT_TIE_HMAC_SECRET || ''; const timestamp = String(req.headers['x-orbit-timestamp'] || ''); const nonce = String(req.headers['x-orbit-nonce'] || '');
  const actor = String(req.headers['x-orbit-actor'] || ''); const requestId = String(req.headers['x-orbit-request-id'] || ''); const signature = String(req.headers['x-orbit-signature'] || '');
  if (secret.length < 32 || !validHeader(nonce) || !validHeader(actor) || !validHeader(requestId) || !/^[0-9a-f]{64}$/i.test(signature) || !/^\d{1,12}$/.test(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 60) return controlError(401, 'authentication_failed', 'Подпись управляющего запроса не подтверждена.');
  const bodyHash = hash(raw); const canonical = ['v1', req.method, `${url.pathname}${url.search}`, timestamp, nonce, actor, requestId, bodyHash].join('\n');
  const expected = createHmac('sha256', secret).update(canonical).digest(); const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return controlError(401, 'authentication_failed', 'Подпись управляющего запроса не подтверждена.');
  db.prepare('DELETE FROM orbit_nonces WHERE expires<?').run(Math.floor(Date.now() / 1000));
  try { db.prepare('INSERT INTO orbit_nonces VALUES(?,?,?)').run(nonce, Math.floor(Date.now() / 1000) + 120, iso()); } catch { return controlError(409, 'replay_detected', 'Этот запрос уже был обработан.'); }
  return { actor, requestId, bodyHash };
}

export function handleOrbitControl(db, req, url, raw) {
  const tail = url.pathname.slice(CONTROL_PREFIX.length); const allowedGet = new Set(['summary', 'users', 'audit', 'ip-bans']);
  const allowedPost = /^sessions\/([0-9a-f-]{36})\/terminate$/i.test(tail) || /^users\/([0-9a-f-]{36})\/(terminate-sessions|set-enabled)$/i.test(tail) || tail === 'ip-bans' || /^ip-bans\/([0-9a-f-]{36})\/revoke$/i.test(tail);
  if (!((req.method === 'GET' && allowedGet.has(tail)) || (req.method === 'GET' && tail === 'sessions') || (req.method === 'POST' && allowedPost))) return controlError(400, 'invalid_id', 'Управляющий маршрут не найден.');
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return controlError(401, 'authentication_failed', 'Подпись управляющего запроса не подтверждена.');
  const auth = authenticate(db, req, url, raw); if (auth.status) return auth;
  if (req.method === 'GET') {
    if (tail === 'summary') { ensureRegistry(db); const active = sessions(db, 'active'); return success({ siteId: SITE_ID, totalUsers: Number(db.prepare('SELECT count(*) AS count FROM users').get().count), enabledUsers: Number(db.prepare('SELECT count(*) AS count FROM users WHERE disabled=0').get().count), activeUsers: new Set(active.filter(row=>row.user_id).map(row => row.user_id)).size, activeSessions: active.length, activeBans: bans(db, 'active').length, actionsToday: Number(db.prepare("SELECT count(*) AS count FROM orbit_audit WHERE occurred_at>=?").get(new Date(Date.now()-86400000).toISOString()).count), asOf: iso() }); }
    if (tail === 'users') return success(users(db));
    if (tail === 'audit') return success(auditRows(db));
    if (tail === 'sessions') { const status = url.searchParams.get('status') || 'all'; return ['all', 'active', 'expired', 'revoked'].includes(status) ? success(sessions(db, status)) : controlError(400, 'invalid_query', 'Неизвестный фильтр сессий.'); }
    const state = url.searchParams.get('state') || 'active'; return ['active', 'all', 'revoked'].includes(state) ? success(bans(db, state)) : controlError(400, 'invalid_query', 'Неизвестный фильтр блокировок.');
  }
  const body = parseBody(raw); const reason = reasonFrom(body); if (!body || !reason) return controlError(422, 'reason_required', 'Укажите причину операции.');
  if (tail.startsWith('sessions/')) {
    const id = tail.split('/')[1]; if (!UUID.test(id)) return controlError(400, 'invalid_id', 'Некорректный идентификатор сессии.'); const action = 'session.terminated', target = `${SITE_ID}:${id}`;
    return transaction(db, () => { const repeated = previousMutation(db, action, target, auth.bodyHash, auth.requestId); if (repeated) return repeated; ensureRegistry(db); const account = db.prepare('SELECT * FROM orbit_session_registry WHERE id=?').get(id); const guest = account ? null : db.prepare('SELECT * FROM orbit_guest_session_registry WHERE id=?').get(id); const row=account||guest;if (!row) return controlError(404, 'session_not_found', 'Сессия не найдена.'); const changed = !row.revoked_at && Number(row.expires) > Date.now(); const at = iso(); if (changed) { db.prepare(account?'DELETE FROM sessions WHERE digest=?':'DELETE FROM guest_sessions WHERE digest=?').run(row.digest); db.prepare(account?'UPDATE orbit_session_registry SET revoked_at=? WHERE id=?':'UPDATE orbit_guest_session_registry SET revoked_at=? WHERE id=?').run(at,id); } const data = { id, siteId: SITE_ID, status: changed ? 'terminated' : 'already_closed', terminatedAt: at }; writeAudit(db,auth.actor,action,'session',target,reason,changed?'succeeded':'noop',auth.requestId,{siteId:SITE_ID,before:sessionStatus(row),after:data.status,changed,terminatedCount:changed?1:0,sessionKind:account?'account':'guest_invite'}); return saveMutation(db,action,target,auth.bodyHash,auth.requestId,success(data)); });
  }
  if (tail.startsWith('users/')) {
    const [, id, operation] = tail.split('/'); if (!UUID.test(id)) return controlError(400, 'invalid_id', 'Некорректный идентификатор пользователя.'); const user = db.prepare('SELECT * FROM users WHERE id=?').get(id); if (!user) return controlError(404, 'user_not_found', 'Пользователь не найден.');
    if (operation === 'terminate-sessions') { const action = 'user.sessions_terminated', target = `${SITE_ID}:${id}`; return transaction(db, () => { const repeated = previousMutation(db,action,target,auth.bodyHash,auth.requestId); if (repeated) return repeated; const count = revokeUserSessions(db,id); const data={userId:id,siteId:SITE_ID,terminatedCount:count}; writeAudit(db,auth.actor,action,'user',target,reason,count?'succeeded':'noop',auth.requestId,{siteId:SITE_ID,before:'active',after:count?'terminated':'already_closed',changed:!!count,terminatedCount:count}); return saveMutation(db,action,target,auth.bodyHash,auth.requestId,success(data)); }); }
    if (typeof body.enabled !== 'boolean') return controlError(422, 'enabled_required', 'Укажите состояние доступа.'); const enabled = body.enabled, action = enabled ? 'user.enabled' : 'user.disabled', target = `${SITE_ID}:${id}`;
    return transaction(db, () => { const repeated=previousMutation(db,action,target,auth.bodyHash,auth.requestId); if(repeated)return repeated; if (!enabled && user.protected) return controlError(403,'protected_management_account','Системная управленческая учётная запись защищена.'); if (!enabled && isFullAdmin(db,user) && Number(enabledFullAdminCount(db)) <= 1) return controlError(403,'last_enabled_admin','Нельзя отключить последнего активного администратора.'); const changed = !!user.disabled === enabled; const terminated = enabled ? 0 : revokeUserSessions(db,id); if (changed) db.prepare('UPDATE users SET disabled=?,version=version+1 WHERE id=?').run(enabled ? 0 : 1,id); const data={userId:id,siteId:SITE_ID,enabled,changed,accessAllowed:enabled,terminatedCount:terminated}; writeAudit(db,auth.actor,action,'user',target,reason,changed?'succeeded':'noop',auth.requestId,{siteId:SITE_ID,before:!user.disabled,after:enabled,changed,terminatedCount:terminated}); return saveMutation(db,action,target,auth.bodyHash,auth.requestId,success(data)); });
  }
  if (tail === 'ip-bans') {
    if (typeof body.network !== 'string') return controlError(422,'invalid_network','Укажите публичный IP-адрес или узкую сеть.'); const net=network(body.network,{strict:true}); if(!net || !publicNetwork(net) || configuredNetworks('ORBIT_TIE_PROTECTED_NETWORKS').some(item=>item.kind===net.kind&&contains(item,net.canonical))) return controlError(422,'invalid_network','Можно блокировать только публичный IP-адрес или узкую сеть.'); let expiresAt=null; if(body.expiresAt!==null&&body.expiresAt!==undefined){const value=new Date(body.expiresAt);if(!Number.isFinite(+value)||+value<=Date.now()||+value>Date.now()+366*86400000)return controlError(422,'invalid_expiry','Срок должен быть в будущем и не более года.');expiresAt=value.toISOString();} const action='ip_ban.created',target=`${SITE_ID}:${net.canonical}`;
    return transaction(db,()=>{const repeated=previousMutation(db,action,target,auth.bodyHash,auth.requestId);if(repeated)return repeated;const at=iso(), row={id:uid(),network:net.canonical,reason,created_by:auth.actor,created_at:at,expires_at:expiresAt,revoked_at:null,revoked_by:null,revoke_reason:null};db.prepare('INSERT INTO orbit_ip_bans VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,row.network,row.reason,row.created_by,row.created_at,row.expires_at,row.revoked_at,row.revoked_by,row.revoke_reason);const terminatedCount=revokeIpSessions(db,net,at);writeAudit(db,auth.actor,action,'ip_ban',`${SITE_ID}:${row.id}`,reason,'succeeded',auth.requestId,{siteId:SITE_ID,network:net.canonical,changed:true,terminatedCount});return saveMutation(db,action,target,auth.bodyHash,auth.requestId,success(banRow(row),201));});
  }
  const id=tail.split('/')[1]; if(!UUID.test(id))return controlError(400,'invalid_id','Некорректный идентификатор блокировки.'); const action='ip_ban.revoked',target=`${SITE_ID}:${id}`;
  return transaction(db,()=>{const repeated=previousMutation(db,action,target,auth.bodyHash,auth.requestId);if(repeated)return repeated;const row=db.prepare('SELECT * FROM orbit_ip_bans WHERE id=?').get(id);if(!row)return controlError(404,'ban_not_found','Блокировка не найдена.');const changed=!row.revoked_at;if(changed)db.prepare('UPDATE orbit_ip_bans SET revoked_at=?,revoked_by=?,revoke_reason=? WHERE id=?').run(iso(),auth.actor,reason,id);const next=db.prepare('SELECT * FROM orbit_ip_bans WHERE id=?').get(id);writeAudit(db,auth.actor,action,'ip_ban',target,reason,changed?'succeeded':'noop',auth.requestId,{siteId:SITE_ID,before:changed?'active':'revoked',after:'revoked',changed});return saveMutation(db,action,target,auth.bodyHash,auth.requestId,success(banRow(next)));});
}

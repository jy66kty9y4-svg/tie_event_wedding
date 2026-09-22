import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { assert, uid } from './db.mjs';
import { permissions, projectPermissions } from '../src/shared.js';
export const digest = x => createHash('sha256').update(x).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function passwordHash(password) {
  assert(typeof password === 'string' && password.length >= 10 && password.length <= 256, 'Пароль: от 10 до 256 символов');
  const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function checkPassword(password, record) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, hash] = record.split(':'); return timingSafeEqual(Buffer.from(hash,'hex'), scryptSync(password,salt,64));
}
function observedAt() { return new Date().toISOString(); }
function registerSession(db, session, context = {}) {
  const at = observedAt(), issuedAt = new Date(Number(session.expires) - 7 * 86400000).toISOString();
  const clientIp = context.clientIp || null;
  const userAgent = String(context.userAgent || '').slice(0, 500);
  db.prepare(`INSERT OR IGNORE INTO orbit_session_registry
    (id,digest,user_id,issued_at,expires,client_ip,user_agent,last_activity_at,observed_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(uid(), session.digest, session.user_id, issuedAt, session.expires, clientIp, userAgent, at, at, at);
  db.prepare(`UPDATE orbit_session_registry SET client_ip=COALESCE(?,client_ip),
    user_agent=CASE WHEN ?<>'' THEN ? ELSE user_agent END,last_activity_at=?,observed_at=?
    WHERE digest=? AND revoked_at IS NULL`).run(clientIp, userAgent, userAgent, at, at, session.digest);
}
export function userSession(db, raw, context = {}) {
  if (!raw) return null;
  const session = db.prepare(`SELECT s.digest AS session_digest,s.user_id AS session_user_id,s.expires AS session_expires,u.*
    FROM sessions s JOIN users u ON s.user_id=u.id LEFT JOIN orbit_session_registry r ON r.digest=s.digest
    WHERE s.digest=? AND s.expires>? AND u.disabled=0 AND r.revoked_at IS NULL`).get(digest(raw),Date.now());
  if (!session) return null;
  registerSession(db, { digest: session.session_digest, user_id: session.session_user_id, expires: session.session_expires }, context);
  const { session_digest, session_user_id, session_expires, ...user } = session;
  return user;
}
export function createSession(db, user, context = {}) {
  const raw = token(), session = { digest: digest(raw), user_id: user.id, expires: Date.now()+7*86400000 };
  db.prepare('INSERT INTO sessions(digest,user_id,expires) VALUES(?,?,?)').run(session.digest,session.user_id,session.expires);
  registerSession(db, session, context);
  return raw;
}
export function publicUser(user) { const { password, ...safe } = user; return safe; }
export function grants(db, user) {
  return db.prepare('SELECT g.*,r.permissions,r.name AS role_name,r.key AS role_key FROM grants g JOIN roles r ON g.role_id=r.id WHERE g.user_id=? AND g.agency_id=? AND r.agency_id=?').all(user.id,user.agency_id,user.agency_id).map(g=>({...g,permissions:JSON.parse(g.permissions),restrictions:JSON.parse(g.restrictions)}));
}
export function can(db, user, action, project = null, section = undefined, row = undefined, field = undefined) {
  if (!user || user.disabled) return false;
  if (user.protected) return true;
  return grants(db,user).some(g => {
    const actions=Array.isArray(action)?action:[action];
    if (actions.some(required=>!g.permissions.includes(required))) return false;
    if (g.project_id !== null && g.project_id !== project) return false;
    if (project === null && g.project_id !== null) return false;
    const r = g.restrictions;
    if (r.sections?.length && (!section || !r.sections.includes(section))) return false;
    // `undefined` means the caller is checking a harmless container (for
    // example whether a table schema may be listed). `null` means the action
    // has no concrete row/field and must therefore not bypass an allow-list.
    if (r.rows?.length && row !== undefined && !r.rows.includes(row)) return false;
    if (r.fields?.length && field !== undefined) {
      const requested=Array.isArray(field)?field:[field];
      if (!requested.length || requested.some(key=>!r.fields.includes(key))) return false;
    }
    // Restricted roles cannot rewrite schemas, invite broader users, or access whole history.
    if ((r.rows?.length || r.fields?.length) && actions.some(required=>['structure','invite','history'].includes(required))) return false;
    return true;
  });
}
export function canHoldFunds(db,user,project) {
  if(user?.protected) return true;
  return grants(db,user).some(grant=>{
    if(grant.role_key==='couple'||!grant.permissions.includes('finance')) return false;
    if(grant.project_id!==null&&grant.project_id!==project) return false;
    const restrictions=grant.restrictions;
    if(restrictions.sections?.length&&!restrictions.sections.includes('budget')) return false;
    return !restrictions.rows?.length&&!restrictions.fields?.length;
  });
}
export function requireAccess(db,u,action,p=null,s=undefined,r=undefined,f=undefined) { assert(can(db,u,action,p,s,r,f),'Недостаточно прав',403); }
export function defaults(db, agency) {
  const roles = [ ['admin','Администратор',permissions,true], ['organizer','Организатор',permissions.filter(x=>!['access','settings','publishAgencySite'].includes(x)),false], ['couple','Участник пары',projectPermissions,false], ['coordinator','Координатор',['read','create','edit','delete','finance','files'],false], ['contractor','Подрядчик',['read','edit'],false] ];
  return roles.map(([key,name,p,protectedRole]) => { const id=uid(); db.prepare('INSERT INTO roles(id,agency_id,name,permissions,protected,key) VALUES(?,?,?,?,?,?)').run(id,agency,name,JSON.stringify(p),Number(protectedRole),key); return {id,name,key}; });
}
export function grant(db, u, role, project = null, restrictions = {}) { db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?)').run(uid(),u.agency_id,u.id,role,project,JSON.stringify(restrictions)); }
export function rateLimit(db, key, limit = 10) {
  const row=db.prepare('SELECT * FROM attempts WHERE key=?').get(key);
  assert(!row || row.until_ms < Date.now() || row.count < limit,'Слишком много попыток. Повторите через 15 минут.',429);
  db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until_ms<? THEN 1 ELSE count+1 END, until_ms=CASE WHEN until_ms<? THEN excluded.until_ms ELSE until_ms END').run(key,Date.now()+900000,Date.now(),Date.now());
}

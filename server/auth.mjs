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
export function userSession(db, raw) {
  if (!raw) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.digest=? AND s.expires>? AND u.disabled=0').get(digest(raw),Date.now()) || null;
}
export function createSession(db, user) { const raw = token(); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(raw),user.id,Date.now()+7*86400000); return raw; }
export function publicUser(user) { const { password, ...safe } = user; return safe; }
export function grants(db, user) {
  return db.prepare('SELECT g.*,r.permissions,r.name AS role_name FROM grants g JOIN roles r ON g.role_id=r.id WHERE g.user_id=? AND g.agency_id=? AND r.agency_id=?').all(user.id,user.agency_id,user.agency_id).map(g=>({...g,permissions:JSON.parse(g.permissions),restrictions:JSON.parse(g.restrictions)}));
}
export function can(db, user, action, project = null, section = null, row = null, field = null) {
  if (!user || user.disabled) return false;
  if (user.protected) return true;
  return grants(db,user).some(g => {
    if (!g.permissions.includes(action)) return false;
    if (g.project_id !== null && g.project_id !== project) return false;
    if (project === null && g.project_id !== null) return false;
    const r = g.restrictions;
    if (r.sections?.length && (!section || !r.sections.includes(section))) return false;
    if (r.rows?.length && row !== null && !r.rows.includes(row)) return false;
    if (r.fields?.length && field !== null && !r.fields.includes(field)) return false;
    // Restricted roles cannot rewrite schemas, invite broader users, or access whole history.
    if ((r.rows?.length || r.fields?.length) && ['structure','invite','history'].includes(action)) return false;
    return true;
  });
}
export function requireAccess(db,u,action,p=null,s=null,r=null,f=null) { assert(can(db,u,action,p,s,r,f),'Недостаточно прав',403); }
export function defaults(db, agency) {
  const roles = [ ['Администратор',permissions,true], ['Организатор',permissions.filter(x=>!['access','settings'].includes(x)),false], ['Участник пары',projectPermissions,false], ['Координатор',['read','edit','finance','files'],false], ['Подрядчик',['read','edit'],false] ];
  return roles.map(([name,p,protectedRole]) => { const id=uid(); db.prepare('INSERT INTO roles(id,agency_id,name,permissions,protected) VALUES(?,?,?,?,?)').run(id,agency,name,JSON.stringify(p),Number(protectedRole)); return {id,name}; });
}
export function grant(db, u, role, project = null, restrictions = {}) { db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?)').run(uid(),u.agency_id,u.id,role,project,JSON.stringify(restrictions)); }
export function rateLimit(db, key, limit = 10) {
  const row=db.prepare('SELECT * FROM attempts WHERE key=?').get(key);
  assert(!row || row.until_ms < Date.now() || row.count < limit,'Слишком много попыток. Повторите через 15 минут.',429);
  db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until_ms<? THEN 1 ELSE count+1 END, until_ms=CASE WHEN until_ms<? THEN excluded.until_ms ELSE until_ms END').run(key,Date.now()+900000,Date.now(),Date.now());
}

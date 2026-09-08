import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate as migrateGuests } from './v2/guest/index.mjs';
import { migrate as migratePublishing, migrateLegacyDrafts } from './v2/publishing/index.mjs';
import { migrate as migrateWorkflow } from './v2/workflow/index.mjs';
import { migrate as migrateCalendar } from './v2/calendar/index.mjs';

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export class Fault extends Error {
  constructor(message, status = 400, details) { super(message); this.status = status; this.details = details; }
}
export function assert(ok, message, status = 400, details) { if (!ok) throw new Fault(message, status, details); }
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agencies(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, agency_id TEXT NOT NULL REFERENCES agencies(id), email TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL, protected INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, UNIQUE(agency_id,email));
    CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY, agency_id TEXT NOT NULL REFERENCES agencies(id), name TEXT NOT NULL, permissions TEXT NOT NULL, protected INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, key TEXT);
    CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, agency_id TEXT NOT NULL REFERENCES agencies(id), user_id TEXT NOT NULL REFERENCES users(id), role_id TEXT NOT NULL REFERENCES roles(id), project_id TEXT, restrictions TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, agency_id TEXT NOT NULL REFERENCES agencies(id), project_id TEXT, kind TEXT NOT NULL, parent_id TEXT, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS entities_scope ON entities(agency_id,project_id,kind,deleted);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, agency_id TEXT NOT NULL, project_id TEXT, actor_id TEXT NOT NULL, entity_id TEXT NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_scope ON audit(agency_id,project_id,created_at);
    CREATE TABLE IF NOT EXISTS commands(id TEXT NOT NULL, user_id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(id,user_id));
    CREATE TABLE IF NOT EXISTS invitations(digest TEXT PRIMARY KEY, agency_id TEXT NOT NULL REFERENCES agencies(id), project_id TEXT NOT NULL, email TEXT NOT NULL, role_id TEXT NOT NULL REFERENCES roles(id), expires INTEGER NOT NULL, used_by TEXT, restrictions TEXT NOT NULL DEFAULT '{}', created_by TEXT REFERENCES users(id), revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS blobs(id TEXT PRIMARY KEY REFERENCES entities(id), content BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_ms INTEGER NOT NULL);
    INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));
  `);
  const invitationColumns = new Set(db.prepare('PRAGMA table_info(invitations)').all().map(column => column.name));
  if (!invitationColumns.has('created_by')) db.exec('ALTER TABLE invitations ADD COLUMN created_by TEXT REFERENCES users(id)');
  if (!invitationColumns.has('revoked')) db.exec('ALTER TABLE invitations ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0');
  db.prepare("INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'))").run();
  const roleColumns = new Set(db.prepare('PRAGMA table_info(roles)').all().map(column => column.name));
  if (!roleColumns.has('key')) db.exec('ALTER TABLE roles ADD COLUMN key TEXT');
  for (const [key,name] of [['admin','Администратор'],['organizer','Организатор'],['couple','Участник пары'],['coordinator','Координатор'],['contractor','Подрядчик']]) db.prepare('UPDATE roles SET key=? WHERE key IS NULL AND name=?').run(key,name);
  db.prepare("INSERT OR IGNORE INTO migrations VALUES(3,datetime('now'))").run();
  if(!db.prepare('SELECT version FROM migrations WHERE version=4').get()) transaction(db,()=>{
    const auditColumns=new Set(db.prepare('PRAGMA table_info(audit)').all().map(c=>c.name));
    if(!auditColumns.has('actor_type')) db.exec("ALTER TABLE audit ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'user'");
    if(!auditColumns.has('actor_ref')) db.exec('ALTER TABLE audit ADD COLUMN actor_ref TEXT');
    db.exec('UPDATE audit SET actor_ref=actor_id WHERE actor_ref IS NULL');
    migrateCalendar(db);
    for(const role of db.prepare("SELECT * FROM roles WHERE key IN ('admin','organizer','couple')").all()) {
      const additions=role.key==='admin'?['publishWeddingSite','manageGuestInvites','publishAgencySite','viewTeamAvailability']:role.key==='organizer'?['publishWeddingSite','manageGuestInvites','viewTeamAvailability']:['publishWeddingSite','manageGuestInvites'];
      const permissions=[...new Set([...JSON.parse(role.permissions),...additions])];
      db.prepare('UPDATE roles SET permissions=?,version=version+1 WHERE id=?').run(JSON.stringify(permissions),role.id);
    }
    db.exec("UPDATE entities SET data=json_set(data,'$.timeZone','Europe/Moscow') WHERE kind='project' AND json_extract(data,'$.timeZone') IS NULL");
    db.prepare("INSERT INTO migrations VALUES(4,datetime('now'))").run();
  });
  if(!db.prepare('SELECT version FROM migrations WHERE version=5').get()) transaction(db,()=>{migrateGuests(db);db.prepare("INSERT INTO migrations VALUES(5,datetime('now'))").run();});
  if(!db.prepare('SELECT version FROM migrations WHERE version=6').get()) transaction(db,()=>{
    migratePublishing(db);migrateWorkflow(db);
    db.exec('CREATE TABLE IF NOT EXISTS legacy_public_imports(agency_id TEXT PRIMARY KEY, result TEXT NOT NULL, imported_at TEXT NOT NULL)');
    for(const agency of db.prepare('SELECT id FROM agencies').all()) {
      const u=db.prepare('SELECT * FROM users WHERE agency_id=? AND protected=1 AND disabled=0 LIMIT 1').get(agency.id);
      if(u&&!db.prepare('SELECT agency_id FROM legacy_public_imports WHERE agency_id=?').get(agency.id)) {
        const result=migrateLegacyDrafts(db,u);
        db.prepare('INSERT INTO legacy_public_imports VALUES(?,?,?)').run(agency.id,JSON.stringify(result),now());
      }
    }
    db.prepare("INSERT INTO migrations VALUES(6,datetime('now'))").run();
  });
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function decode(row) { return row ? { ...row, data: JSON.parse(row.data), deleted: !!row.deleted } : null; }
export function entity(db, id) { return decode(db.prepare('SELECT * FROM entities WHERE id=?').get(id)); }
export function entities(db, agency, project, kind, deleted = false) {
  return db.prepare(`SELECT * FROM entities WHERE agency_id=? AND project_id IS ? ${kind ? 'AND kind=?' : ''} ${deleted ? '' : 'AND deleted=0'} ORDER BY updated_at,id`).all(agency, project, ...(kind ? [kind] : [])).map(decode);
}
export function audit(db, user, row, before, action) {
  db.prepare('INSERT INTO audit(id,agency_id,project_id,actor_id,entity_id,kind,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid(), user.agency_id, row.project_id, user.id, row.id, row.kind, action, before ? JSON.stringify(before) : null, JSON.stringify(row), now());
}
export function insert(db, user, kind, data, project = null, parent = null, id = uid()) {
  db.prepare('INSERT INTO entities(id,agency_id,project_id,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, user.agency_id, project, kind, parent, JSON.stringify(data), now());
  const row = entity(db, id); audit(db, user, row, null, 'create'); return row;
}
export function change(db, user, row, data, deleted = row.deleted, action = 'edit') {
  db.prepare('UPDATE entities SET data=?,version=version+1,deleted=?,updated_at=? WHERE id=?').run(JSON.stringify(data), Number(deleted), now(), row.id);
  const next = entity(db, row.id); audit(db, user, next, row, action); return next;
}
export function version(row, expected) { assert(row.version === expected, 'Запись уже изменена. Сравните вашу правку с текущей версией.', 409, { current: row }); }

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const [beforePath, afterPath, mode = 'production'] = process.argv.slice(2);
assert(beforePath && afterPath, 'Provide before and after SQLite backups');
const before = new DatabaseSync(beforePath, { readOnly: true });
const after = new DatabaseSync(afterPath, { readOnly: true });
const ignored = new Set(mode === 'migration' ? ['migrations'] : [
  'migrations', 'sessions', 'attempts', 'guest_sessions', 'notification_outbox',
  'calendar_connections', 'calendar_event_links', 'calendar_oauth_states',
  'orbit_session_registry', 'orbit_guest_session_registry', 'orbit_nonces', 'orbit_idempotency'
]);
const quote = value => `"${value.replaceAll('"', '""')}"`;
const stable = value => {
  if (value instanceof Uint8Array) return `blob:${createHash('sha256').update(value).digest('hex')}`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const tables = db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name).filter(name => !ignored.has(name));
const columns = (db, table) => db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(column => column.name);
function fingerprint(db, table, fields) {
  const rows = db.prepare(`SELECT ${fields.map(quote).join(',')} FROM ${quote(table)}`).all().map(stable).sort();
  const hash = createHash('sha256');
  for (const row of rows) hash.update(row).update('\n');
  return { rows: rows.length, sha256: hash.digest('hex') };
}
try {
  assert(before.prepare('SELECT version FROM migrations WHERE version=15').get(), 'Expected schema 15 baseline');
  assert(after.prepare('SELECT version FROM migrations WHERE version=16').get(), 'Phone schema migration is missing');
  assert.equal(after.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.deepEqual(after.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(tables(after), tables(before), 'Unexpected business table change');
  for (const table of tables(before)) {
    const fields = columns(before, table);
    if (table === 'users') {
      assert(!fields.includes('phone'), 'Baseline already contains the phone migration');
      assert.deepEqual(columns(after, table).filter(field => field !== 'phone'), fields);
      assert.equal(after.prepare('SELECT COUNT(*) AS total FROM users WHERE phone IS NOT NULL').get().total, 0, 'Existing accounts received an unexpected phone');
      const schema = after.prepare('PRAGMA table_info(users)').all();
      assert.equal(schema.find(column => column.name === 'email').notnull, 0);
      assert.equal(schema.find(column => column.name === 'phone').type, 'TEXT');
    } else assert.deepEqual(columns(after, table), fields, `${table}: unexpected schema change`);
    assert.deepEqual(fingerprint(after, table, fields), fingerprint(before, table, fields), `${table}: data changed`);
  }
  console.log(JSON.stringify({ matched: true, mode, tables: tables(before).length, users: after.prepare('SELECT COUNT(*) AS total FROM users').get().total, migration: 16, integrity: 'ok', foreignKeys: 'ok' }));
} finally {
  before.close();
  after.close();
}

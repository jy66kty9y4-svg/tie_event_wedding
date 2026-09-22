import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const ignored = new Set(['sessions', 'attempts', 'guest_sessions', 'notification_outbox', 'migrations', 'calendar_connections', 'calendar_event_links', 'calendar_oauth_states']);
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
const stable = value => {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `blob:${createHash('sha256').update(value).digest('hex')}`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
if (args[0] === '--compare') {
  const [beforePath, afterPath] = args.slice(1);
  if (!beforePath || !afterPath) throw new Error('Usage: node ux-release-20260913-r1-db-fingerprint.mjs --compare <before.json> <after.json>');
  const before = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(beforePath), 'utf8'));
  const after = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(afterPath), 'utf8'));
  if (stable(before.tables) !== stable(after.tables)) throw new Error('Business-table fingerprint mismatch');
  console.log(JSON.stringify({ matched: true, tables: Object.keys(before.tables || {}).length, ignored: before.ignoredTables }, null, 2));
} else {
  const [dbPath, outputPath] = args;
  if (!dbPath || !outputPath) throw new Error('Usage: node ux-release-20260913-r1-db-fingerprint.mjs <database.sqlite> <output.json>');
  const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
  try {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name).filter(name => !ignored.has(name));
  const report = { generatedAt: new Date().toISOString(), database: dbPath, ignoredTables: [...ignored].sort(), tables: {} };
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(column => column.name);
    const rows = db.prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid`).all();
    const digest = createHash('sha256');
    for (const row of rows) digest.update(stable(row)).update('\n');
    report.tables[table] = { columns, rows: rows.length, sha256: digest.digest('hex') };
  }
  mkdirSync(dirname(resolve(outputPath)), { recursive: true, mode: 0o700 });
  writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ tables: Object.keys(report.tables).length, ignored: report.ignoredTables }, null, 2));
  } finally {
    db.close();
  }
}

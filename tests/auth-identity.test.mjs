import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { questionnaireQuestions } from '../src/questionnaire.js';
import { normalizePhone } from '../src/auth-identity.js';
import { openDatabase, uid } from '../server/db.mjs';
import { userSession } from '../server/auth.mjs';
import { authenticate, bootstrap, execute, register, snapshot } from '../server/service.mjs';

const password = 'phone-test-password';
function fixture(t, path = ':memory:') {
  const db = openDatabase(path);
  t.after(() => { if (db.isOpen) db.close(); });
  const owner = bootstrap(db, { slug: 'tie', agencyName: 'Test', name: 'Owner', email: 'owner@example.test', password });
  return { db, owner };
}
const fails = (fn, status) => assert.throws(fn, error => error.status === status);

test('phone identifiers normalize common domestic and international input and reject malformed values', () => {
  for (const value of ['+7 (999) 123-45-67', '8 999 123 45 67', '79991234567', '9991234567']) assert.equal(normalizePhone(value), '+79991234567');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('+1 (202) 555-0123'), '+12025550123');
  for (const value of [null, {}, 79991234567, '', '123', '+7 999', '000000000', '++79991234567', '+7 999 123-45-67 ext 5', '+1234567890123456']) assert.equal(normalizePhone(value), null);
});

test('existing phone-only accounts sign in with equivalent formats and remain manageable without an email', t => {
  const { db, owner } = fixture(t);
  const first = register(db, { name: 'Phone user', email: 'first@example.test', phone: '8 (999) 123-45-67', password });
  const second = register(db, { name: 'Second phone user', email: 'second@example.test', phone: '+79991234568', password });
  // Reproduce accounts created before signup required both contact fields.
  db.prepare('UPDATE users SET email=NULL WHERE id=?').run(first.user.id);
  db.prepare('UPDATE users SET email=NULL,phone=? WHERE id=?').run('+442079460958', second.user.id);
  first.user = authenticate(db, { phone: first.user.phone, password }).user;
  assert.equal(first.user.email, null);
  assert.equal(first.user.phone, '+79991234567');
  assert.equal('password' in first.user, false);
  assert.notEqual(first.user.id, second.user.id);
  for (const identifier of ['+7 999 123 45 67', '89991234567', '9991234567']) {
    const result = authenticate(db, { identifier, password });
    assert.equal(result.user.id, first.user.id);
    assert.equal(userSession(db, result.token).id, first.user.id);
  }
  assert.equal(authenticate(db, { phone: '+442079460958', password }).user.id, second.user.id);
  fails(() => authenticate(db, { identifier: first.user.phone, password: 'wrong-password' }), 401);
  fails(() => authenticate(db, { identifier: '+79990000000', password }), 401);
  fails(() => authenticate(db, { identifier: 'not-a-phone', password }), 401);
  for (const phone of ['+79991234567', '89991234567', '9991234567']) fails(() => register(db, { name: 'Duplicate', email: 'duplicate@example.test', phone, password }), 409);
  for (const phone of ['', '+7 123', 'number']) fails(() => register(db, { name: 'Invalid', email: 'invalid@example.test', phone, password }), 400);
  const managed = snapshot(db, owner.user).users.find(user => user.id === first.user.id);
  assert.equal(managed.phone, first.user.phone);
  assert.equal(managed.manageable, true);
  execute(db, owner.user, { id: uid(), op: 'user.remove', userId: first.user.id, version: first.user.version });
  assert.equal(userSession(db, first.token), null);
  fails(() => authenticate(db, { phone: first.user.phone, password }), 401);
});

test('email login remains compatible and identifiers stay isolated by agency', t => {
  const { db, owner } = fixture(t);
  assert.equal(authenticate(db, { email: ' OWNER@EXAMPLE.TEST ', password }).user.id, owner.user.id);
  assert.equal(authenticate(db, { identifier: 'owner@example.test', password }).user.id, owner.user.id);
  const other = uid();
  db.prepare('INSERT INTO agencies(id,slug,name) VALUES(?,?,?)').run(other, 'other', 'Other');
  const first = register(db, { name: 'First', email: 'first@example.test', phone: '+79991234567', password });
  const second = register(db, { slug: 'other', name: 'Other', email: 'first@example.test', phone: '+79991234567', password: 'other-phone-password' });
  assert.equal(authenticate(db, { slug: 'other', identifier: '+79991234567', password: 'other-phone-password' }).user.id, second.user.id);
  assert.equal(authenticate(db, { identifier: '+79991234567', password }).user.id, first.user.id);
  fails(() => authenticate(db, { slug: 'other', identifier: '+79991234567', password }), 401);
  fails(() => register(db, { name: 'Duplicate email', email: 'OWNER@example.test', phone: '+79990000000', password }), 409);
  assert.equal(db.prepare('SELECT id FROM users WHERE phone=?').get('+79990000000'), undefined);
});

test('phone registration can accept an email-bound invitation only with the matching email', t => {
  const { db, owner } = fixture(t);
  const project = execute(db, owner.user, { id: uid(), op: 'project.create', data: { name: 'Phone wedding', date: '2027-06-10' } });
  const invitation = execute(db, owner.user, { id: uid(), op: 'invite.create', projectId: project.id, email: 'invited@example.test' });
  fails(() => register(db, { name: 'Missing email', phone: '+79991234567', password, invitation: invitation.token }), 400);
  fails(() => register(db, { name: 'Wrong invite', phone: '+79991234567', email: 'wrong@example.test', password, invitation: invitation.token }), 403);
  assert.equal(db.prepare('SELECT id FROM users WHERE phone=?').get('+79991234567'), undefined);
  const result = register(db, { name: 'Invited phone', phone: '+79991234567', email: 'INVITED@example.test', password, invitation: invitation.token });
  const entry=snapshot(db,result.user).onboarding;
  assert.equal(entry.status,'pending');
  assert.deepEqual(snapshot(db,result.user).projects,[]);
  const approved=execute(db,owner.user,{id:uid(),op:'account.approve',entityId:entry.id,version:entry.version,weddingId:project.id});
  const answers=Object.fromEntries(questionnaireQuestions.map(({id})=>[id,id==='images'?['свечи/огни']:'Ответ пары']));
  execute(db,result.user,{id:uid(),op:'account.questionnaire',entityId:approved.id,version:approved.version,answers});
  assert.equal(snapshot(db, result.user).projects.some(row => row.id === project.id), true);
  for (const identifier of ['invited@example.test', '89991234567']) assert.equal(authenticate(db, { identifier, password }).user.id, result.user.id);
});

test('initial agency setup can use a phone number', t => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const owner = bootstrap(db, { slug: 'tie', agencyName: 'Phone agency', name: 'Owner', phone: '9991234567', password });
  assert.equal(owner.user.protected, 1);
  assert.equal(owner.user.email, null);
  assert.equal(authenticate(db, { identifier: '+79991234567', password }).user.id, owner.user.id);
});

test('the phone schema migration preserves existing passwords, sessions, grants and invitation references', t => {
  const path = join(mkdtempSync(join(tmpdir(), 'tie-phone-migration-')), 'legacy.sqlite');
  const { db, owner } = fixture(t, path);
  const project = execute(db, owner.user, { id: uid(), op: 'project.create', data: { name: 'Legacy wedding', date: '2027-06-10' } });
  const invitation = execute(db, owner.user, { id: uid(), op: 'invite.create', projectId: project.id, email: 'legacy-invite@example.test' });
  // Reproduce the previous release's user table without changing its records.
  db.exec(`PRAGMA foreign_keys=OFF;
    BEGIN IMMEDIATE;
    CREATE TABLE users_legacy(id TEXT PRIMARY KEY, agency_id TEXT NOT NULL REFERENCES agencies(id), email TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL, protected INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, UNIQUE(agency_id,email));
    INSERT INTO users_legacy SELECT id,agency_id,email,name,password,protected,disabled,version FROM users;
    DROP TABLE users;
    ALTER TABLE users_legacy RENAME TO users;
    DELETE FROM migrations WHERE version=16;
    COMMIT;`);
  db.close();
  const migrated = openDatabase(path);
  assert.equal(migrated.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(userSession(migrated, owner.token).id, owner.user.id);
  assert.equal(authenticate(migrated, { identifier: owner.user.email, password }).user.id, owner.user.id);
  assert.equal(migrated.prepare('SELECT created_by FROM invitations WHERE digest=?').get(invitation.id).created_by, owner.user.id);
  assert.ok(snapshot(migrated, owner.user).roles.length);
  const phone = register(migrated, { name: 'After migration', email: 'after@example.test', phone: '+79991234567', password });
  migrated.close();
  const reopened = openDatabase(path);
  t.after(() => reopened.close());
  assert.equal(authenticate(reopened, { identifier: '89991234567', password }).user.id, phone.user.id);
  assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);
});

test('new registration requires both email and an eleven-digit Russian phone without creating partial accounts', t => {
  const { db } = fixture(t);
  const account = { name: 'Both contacts', email: 'both@example.test', phone: '89991234567', password };
  for (const missing of ['email', 'phone']) {
    const body = { ...account };
    delete body[missing];
    fails(() => register(db, body), 400);
  }
  for (const phone of ['899912345678', '+799912345678', '+442079460958', '+7999123456']) fails(() => register(db, { ...account, phone }), 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  const result = register(db, account);
  assert.equal(result.user.email, account.email);
  assert.equal(result.user.phone, '+79991234567');
  for (const identifier of [account.email, account.phone]) assert.equal(authenticate(db, { identifier, password }).user.id, result.user.id);
});

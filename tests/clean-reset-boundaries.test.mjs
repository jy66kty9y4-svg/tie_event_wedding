import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cleanResetPlan,makeCleanDatabase,verifyCleanDatabase} from '../server/clean-reset.mjs';
import {initialTemplate} from '../server/model.mjs';
import {insert,entity,entities} from '../server/db.mjs';
import {grant} from '../server/auth.mjs';
import {unitDb} from './fixtures/unit-db.mjs';

function fixture(t) {
  const f=unitDb(t),{db,admin,member,roles,user}=f;
  db.prepare('DELETE FROM users WHERE id=?').run(f.foreign.id);db.prepare('DELETE FROM agencies WHERE id=?').run(f.foreign.agency_id);
  const third=user('unit-third');for(const u of [member,third])grant(db,u,roles.find(r=>r.key==='organizer').id,null);
  const options={agencyId:admin.agency_id,keepUserIds:[admin.id,member.id,third.id]};
  insert(db,admin,'template',{...initialTemplate(),name:'First'},null,null,'z-first-template');
  insert(db,admin,'template',{...initialTemplate(),name:'Second'},null,null,'a-second-template');
  db.prepare('UPDATE entities SET updated_at=? WHERE id=?').run('2026-10-01T00:00:00.000Z','z-first-template');
  db.prepare('UPDATE entities SET updated_at=? WHERE id=?').run('2026-10-02T00:00:00.000Z','a-second-template');
  return {...f,third,options};
}
test('maintenance copy preserves the first/default template and definition order even within one clock tick',t=>{
  const {db,admin,options}=fixture(t);t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-12T00:00:00Z')});
  const before=entities(db,admin.agency_id,null,'template').map(r=>r.id),clean=makeCleanDatabase(db,':memory:',options);t.after(()=>clean.db.close());
  assert.deepEqual(entities(clean.db,admin.agency_id,null,'template').map(r=>r.id),before);
  assert.equal(entities(clean.db,admin.agency_id,null,'template')[0].data.name,'First');
  assert.deepEqual(entities(db,admin.agency_id,null,'template').map(r=>r.id),before);
});
test('maintenance refuses overwrite, disabled preserve accounts, missing grants, unknown schema and invalid task dependencies',t=>{
  const {db,admin,member,options}=fixture(t),folder=mkdtempSync(join(tmpdir(),'tie-unit-clean-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const target=join(folder,'existing.sqlite');writeFileSync(target,'sentinel');assert.throws(()=>makeCleanDatabase(db,target,options),e=>e.status===400);assert.equal(readFileSync(target,'utf8'),'sentinel');
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(member.id);assert.throws(()=>cleanResetPlan(db,options),e=>e.status===400);db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(member.id);
  const saved=db.prepare('SELECT * FROM grants WHERE user_id=?').get(member.id);db.prepare('DELETE FROM grants WHERE user_id=?').run(member.id);assert.throws(()=>cleanResetPlan(db,options),e=>e.status===400);
  grant(db,member,saved.role_id,null);
  db.exec('CREATE TABLE future_schema(id TEXT)');assert.throws(()=>makeCleanDatabase(db,':memory:',options),e=>e.status===400);db.exec('DROP TABLE future_schema');
  const row=entity(db,'z-first-template'),bad={...row.data,taskBlueprints:[{key:'a',title:'A',dependencyKeys:['missing']}]};db.prepare('UPDATE entities SET data=? WHERE id=?').run(JSON.stringify(bad),row.id);
  assert.throws(()=>makeCleanDatabase(db,':memory:',options),e=>e.status===400);assert.equal(entity(db,row.id).data.taskBlueprints[0].dependencyKeys[0],'missing');
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,3);assert.equal(admin.protected,1);
});
test('maintenance verifier catches reintroduced work, history and private tables rather than only checking account counts',t=>{
  const {db,admin,options}=fixture(t),clean=makeCleanDatabase(db,':memory:',options);t.after(()=>clean.db.close());
  assert.equal(verifyCleanDatabase(clean.db,options).emptyWorkspaces,3);
  insert(clean.db,admin,'project',{name:'Should not exist'});
  assert.throws(()=>verifyCleanDatabase(clean.db,options),e=>e.status===400);
});

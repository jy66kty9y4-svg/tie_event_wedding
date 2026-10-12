import test from 'node:test';
import assert from 'node:assert/strict';
import {entity,entities,insert,change,version,transaction,pruneAuditHistory,auditRetentionCutoff,seedProjectTasks} from '../server/db.mjs';
import {executeModule,currentUser,scoped,historicalRecord,visible} from '../server/v2/common.mjs';
import {grant,requireAccess} from '../server/auth.mjs';
import {unitDb} from './fixtures/unit-db.mjs';

test('transaction failure rolls back entities, history and every preceding write',t=>{
  const {db,admin}=unitDb(t),before=db.prepare('SELECT count(*) n FROM audit').get().n;
  assert.throws(()=>transaction(db,()=>{insert(db,admin,'category',{name:'Must not exist'});db.prepare('UPDATE agencies SET name=? WHERE id=?').run('Must not persist',admin.agency_id);throw new Error('rollback');}),/rollback/);
  assert.equal(entities(db,admin.agency_id,null).length,0);assert.equal(db.prepare('SELECT count(*) n FROM audit').get().n,before);
  assert.equal(db.prepare('SELECT name FROM agencies WHERE id=?').get(admin.agency_id).name,'unit-a');
  assert.equal(transaction(db,()=>insert(db,admin,'category',{name:'Committed'})).data.name,'Committed');
});
test('optimistic versions reject stale writes with the actual current row; soft delete and restore retain stable identity',t=>{
  const {db,admin}=unitDb(t);let row=insert(db,admin,'category',{name:'A'});const original=row;
  row=change(db,admin,row,{name:'B'});assert.equal(row.version,2);assert.equal(row.id,original.id);
  assert.throws(()=>version(row,1),e=>e.status===409&&e.details.current.data.name==='B');version(row,2);
  row=change(db,admin,row,row.data,true,'delete');assert.equal(entities(db,admin.agency_id,null).length,0);assert.equal(entities(db,admin.agency_id,null,'category',true).length,1);
  row=change(db,admin,row,row.data,false,'restore');assert.equal(row.version,4);assert.equal(row.data.name,'B');
  assert.equal(db.prepare('SELECT count(*) n FROM audit WHERE entity_id=?').get(row.id).n,4);
});
test('audit retention removes only entries strictly before its three-year boundary',t=>{
  const {db,admin}=unitDb(t),at=Date.parse('2027-03-01T12:00:00Z'),cutoff=auditRetentionCutoff(at);
  assert.equal(cutoff,'2024-03-01T12:00:00.000Z');
  const old=insert(db,admin,'category',{name:'Old'}),edge=insert(db,admin,'category',{name:'Boundary'}),fresh=insert(db,admin,'category',{name:'Fresh'});
  db.prepare('UPDATE audit SET created_at=? WHERE entity_id=?').run('2024-03-01T11:59:59.999Z',old.id);
  db.prepare('UPDATE audit SET created_at=? WHERE entity_id=?').run(cutoff,edge.id);
  db.prepare('UPDATE audit SET created_at=? WHERE entity_id=?').run('2024-03-01T12:00:00.001Z',fresh.id);
  assert.equal(pruneAuditHistory(db,at),1);assert.equal(pruneAuditHistory(db,at),0);assert(entity(db,old.id));
  assert.equal(db.prepare('SELECT count(*) n FROM audit').get().n,2);
});
test('module command replay writes once, validates its digest and rechecks current permissions',t=>{
  const {db,member,role}=unitDb(t);grant(db,member,role(['read','create']),null);
  const operations={'unit.create':{authorize(db,u){requireAccess(db,u,'create');},run(db,u){return insert(db,u,'category',{name:'Once'});}}};
  const cmd={id:'unit_command_once',op:'unit.create'};
  const first=executeModule(db,member,cmd,operations),second=executeModule(db,member,cmd,operations);
  assert.deepEqual(second,first);assert.equal(entities(db,member.agency_id,null).length,1);
  assert.throws(()=>executeModule(db,member,{...cmd,extra:true},operations),e=>e.status===409);
  db.prepare('DELETE FROM grants WHERE user_id=?').run(member.id);assert.throws(()=>executeModule(db,member,cmd,operations),e=>e.status===403);
  assert.equal(db.prepare('SELECT count(*) n FROM commands').get().n,1);
});
test('module replay redacts fields using present grants instead of returning the stored privileged response',t=>{
  const {db,member,role}=unitDb(t),rid=role(['read','create']);grant(db,member,rid,null);
  const operations={'unit.create':{authorize(db,u){requireAccess(db,u,'create');},run(db,u){return insert(db,u,'category',{name:'Public',secret:'Private'});}}},cmd={id:'unit_redacted_replay',op:'unit.create'};
  assert.equal(executeModule(db,member,cmd,operations).data.secret,'Private');
  db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run(JSON.stringify({fields:['name']}),member.id);
  assert.deepEqual(executeModule(db,member,cmd,operations).data,{name:'Public'});
});
test('module failures never persist results or partial writes; offline and asynchronous operations are rejected',t=>{
  const {db,admin}=unitDb(t),operations={bad:{authorize(){},run(db,u){insert(db,u,'category',{name:'Partial'});throw new Error('Rejected');}},async:{authorize(){},run(){return Promise.resolve('invalid');}}};
  assert.throws(()=>executeModule(db,admin,{id:'unit_failed_run',op:'bad'},operations),/Rejected/);
  assert.throws(()=>executeModule(db,admin,{id:'unit_async_run',op:'async'},operations),e=>e.status===400);
  assert.throws(()=>executeModule(db,admin,{id:'unit_offline_run',op:'bad',offline:true},operations),e=>e.status===409);
  assert.throws(()=>executeModule(db,admin,{id:'short',op:'bad'},operations),e=>e.status===400);
  assert.throws(()=>executeModule(db,admin,{id:'unit_unknown_run',op:'missing'},operations),e=>e.status===400);
  assert.equal(entities(db,admin.agency_id,null).length,0);assert.equal(db.prepare('SELECT count(*) n FROM commands').get().n,0);
});
test('current principals, scoped records and deleted records are revalidated independently of supplied objects',t=>{
  const {db,admin,member,foreign}=unitDb(t),row=insert(db,admin,'category',{name:'A'},'p');
  assert.throws(()=>scoped(db,foreign,row.id,'p','category'),e=>e.status===404);
  assert.throws(()=>scoped(db,admin,row.id,'other','category'),e=>e.status===404);
  assert.throws(()=>scoped(db,admin,row.id,'p','task'),e=>e.status===404);
  const deleted=change(db,admin,row,row.data,true);assert.throws(()=>scoped(db,admin,row.id,'p','category'),e=>e.status===409);
  assert.equal(scoped(db,admin,row.id,'p','category',{deleted:true}).id,deleted.id);
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(member.id);
  assert.throws(()=>currentUser(db,member),e=>e.status===403);
  assert.throws(()=>currentUser(db,{id:admin.id,agency_id:foreign.agency_id}),e=>e.status===403);
});
test('history selects only the requested same-entity audit and prevents cross-record restoration',t=>{
  const {db,admin}=unitDb(t),a=insert(db,admin,'category',{name:'A'}),b=insert(db,admin,'category',{name:'B'}),next=change(db,admin,a,{name:'After'});
  const auditA=db.prepare("SELECT id FROM audit WHERE entity_id=? AND action='edit'").get(a.id),auditB=db.prepare('SELECT id FROM audit WHERE entity_id=?').get(b.id);
  assert.equal(historicalRecord(db,admin,{auditId:auditA.id},next).data.name,'A');
  assert.throws(()=>historicalRecord(db,admin,{auditId:auditB.id},next),e=>e.status===404);
  assert.throws(()=>historicalRecord(db,admin,{},next),e=>e.status===409);
  const removed=change(db,admin,next,next.data,true);assert.equal(historicalRecord(db,admin,{},removed).id,a.id);
});
test('record projections omit deleted rows and unreadable fields without altering their stored data',t=>{
  const {db,admin,member,role}=unitDb(t);grant(db,member,role(['read']),'p',{sections:['budget'],fields:['name']});
  const row=insert(db,admin,'category',{name:'Public',secret:'Private'},'p');
  assert.deepEqual(visible(db,member,row,'budget').data,{name:'Public'});
  assert.equal(visible(db,member,row,'files'),null);assert.equal(visible(db,member,{...row,deleted:true},'budget'),null);
  assert.equal(entity(db,row.id).data.secret,'Private');
});
test('task seeding resolves stable dependencies, is idempotent and preserves existing and deleted tasks',t=>{
  const {db,admin}=unitDb(t),p=insert(db,admin,'project',{name:'Unit wedding',date:'2027-06-12'}),blueprints=[
    {key:'a',title:'Площадка',dueMode:'relative',offsetDays:-10},
    {key:'b',title:'Договор',dueMode:'relative',offsetDays:-5,dependencyKeys:['a','missing']}
  ];
  const created=seedProjectTasks(db,admin,p,blueprints,{undated:true});
  assert.equal(created.length,2);assert.deepEqual(created[1].data.dependencyIds,[created[0].id]);
  for(const row of created){assert.equal(row.data.dueMode,'none');assert.equal(row.data.dueDate,'');assert.equal(row.data.offsetDays,null);}
  change(db,admin,created[0],{...created[0].data,title:'Моё название'},true);
  assert.deepEqual(seedProjectTasks(db,admin,p,blueprints,{undated:true}),[]);
  assert.equal(entities(db,admin.agency_id,p.id,'task',true).length,2);
  const another=insert(db,admin,'project',{name:'Other wedding',date:''});
  const open=seedProjectTasks(db,admin,another,blueprints);assert(open.every(r=>r.data.dueDate===''));assert(open.every(r=>r.data.dueMode==='relative'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,entity,insert,uid} from '../server/db.mjs';
import {grant} from '../server/auth.mjs';
import {bootstrap,register,snapshot,execute} from '../server/service.mjs';
import {notifications,queueAccountRegistration,processOutbox,operations} from '../server/v2/calendar/index.mjs';
import {executeModule} from '../server/v2/common.mjs';
import {restoreRegistrationNotifications} from '../server/backfill-account-registrations.mjs';
import {registerTestUser} from './fixtures/account.mjs';
import {questionnaireQuestions} from '../src/questionnaire.js';

const password='registration-inbox-password';
const run=(db,u,op,data={})=>execute(db,u,{id:uid(),op,...data});
function fixture(t){
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const owner=bootstrap(db,{slug:'tie',agencyName:'Tie',name:'Owner',email:'owner@example.test',password}).user;
  const organizer=registerTestUser(db,{name:'Organizer',email:'organizer@example.test',password}).user;
  grant(db,organizer,db.prepare("SELECT id FROM roles WHERE key='organizer'").get().id);
  const reader=registerTestUser(db,{name:'Reader',email:'reader@example.test',password}).user;
  const role=run(db,owner,'role.save',{name:'Reader',permissions:['read']});grant(db,reader,role.id);
  const disabled=registerTestUser(db,{name:'Disabled',email:'disabled@example.test',password}).user;
  grant(db,disabled,db.prepare("SELECT id FROM roles WHERE key='organizer'").get().id);
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(disabled.id);
  const otherAgency=uid(),otherId=uid();
  db.prepare("INSERT INTO agencies(id,slug,name,settings) VALUES(?,?,?,'{}')").run(otherAgency,'other','Other');
  db.prepare('INSERT INTO users(id,agency_id,email,name,password,protected) VALUES(?,?,?,?,?,1)').run(otherId,otherAgency,'other@example.test','Other owner',db.prepare('SELECT password FROM users WHERE id=?').get(owner.id).password);
  const other=db.prepare('SELECT * FROM users WHERE id=?').get(otherId);
  const user=register(db,{slug:'tie',name:'Anna',email:'anna@example.test',phone:'89991234567',password}).user;
  const entry=entity(db,snapshot(db,user).onboarding.id);
  return{db,owner,organizer,reader,disabled,other,user,entry};
}

test('new registration appears immediately in the reviewer inbox and notifications with both contacts',t=>{
  const{db,owner,organizer,reader,other,user,entry}=fixture(t);
  for(const recipient of[owner,organizer]){
    const item=snapshot(db,recipient).accountRegistrations.find(row=>row.id===entry.id);
    assert.equal(item.status,'pending');assert.equal(item.project,null);
    assert.equal(item.user.email,user.email);assert.equal(item.user.phone,'+79991234567');
    assert.equal(item.canApprove,recipient.id===owner.id);
    const inbox=notifications(db,recipient,{type:'account.registered'});
    assert.equal(inbox.total,1);assert.equal(inbox.unread,1);
    assert.equal(inbox.items[0].data.title,'Новая заявка на регистрацию');
    assert.equal(inbox.items[0].data.sourceId,entry.id);
    assert.equal(inbox.items[0].data.actionUrl,`/app/applications?registration=${entry.id}`);
  }
  for(const recipient of[user,reader]){
    assert.equal(snapshot(db,recipient).accountRegistrations,undefined);
    assert.equal(notifications(db,recipient,{type:'account.registered'}).total,0);
  }
  assert.deepEqual(snapshot(db,other).accountRegistrations,[]);
  assert.equal(notifications(db,other,{type:'account.registered'}).total,0);
  assert.equal(db.prepare("SELECT count(*) n FROM notification_outbox WHERE source_id=?").get(entry.id).n,2);
});

test('restoring old pending registrations is idempotent and leaves accounts, grants and onboarding unchanged',t=>{
  const{db,owner,organizer,user,entry}=fixture(t);
  const created=db.prepare("SELECT id FROM entities WHERE kind='notification' AND json_extract(data,'$.sourceId')=?").all(entry.id);
  for(const n of created){db.prepare('DELETE FROM audit WHERE entity_id=?').run(n.id);db.prepare('DELETE FROM entities WHERE id=?').run(n.id);}
  db.prepare('DELETE FROM notification_outbox WHERE source_id=?').run(entry.id);
  const before={user:db.prepare('SELECT * FROM users WHERE id=?').get(user.id),grants:db.prepare('SELECT * FROM grants WHERE user_id=?').all(user.id),entry:entity(db,entry.id)};
  assert.deepEqual(restoreRegistrationNotifications(db),{pendingAccounts:1,delivered:2});
  assert.deepEqual(restoreRegistrationNotifications(db),{pendingAccounts:1,delivered:0});
  assert.deepEqual({user:db.prepare('SELECT * FROM users WHERE id=?').get(user.id),grants:db.prepare('SELECT * FROM grants WHERE user_id=?').all(user.id),entry:entity(db,entry.id)},before);
  assert.equal(notifications(db,owner,{type:'account.registered'}).total,1);
  assert.equal(notifications(db,organizer,{type:'account.registered'}).total,1);
});

test('revoking review rights or disabling the registering account removes inbox and notification visibility',t=>{
  const{db,owner,organizer,user,entry}=fixture(t),notification=notifications(db,organizer,{type:'account.registered'}).items[0];
  db.prepare('DELETE FROM grants WHERE user_id=?').run(organizer.id);
  assert.equal(snapshot(db,organizer).accountRegistrations,undefined);
  assert.equal(notifications(db,organizer,{type:'account.registered'}).total,0);
  assert.throws(()=>executeModule(db,organizer,{id:uid(),op:'notification.read',entityId:notification.id},operations),e=>e.status===403);
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(user.id);
  assert.deepEqual(snapshot(db,owner).accountRegistrations,[]);
  assert.equal(notifications(db,owner,{type:'account.registered'}).total,0);
  queueAccountRegistration(db,null,entry);assert.equal(processOutbox(db,Date.now(),100,{sourceId:entry.id}).delivered,0);
});

test('approval and completed questionnaire remain visible in processed registrations',t=>{
  const{db,owner,user,entry}=fixture(t);
  const wedding=run(db,owner,'project.create',{data:{name:'Wedding',date:'2027-06-12'}});
  run(db,owner,'account.approve',{entityId:entry.id,version:entry.version,weddingId:wedding.id});
  let item=snapshot(db,owner).accountRegistrations[0];
  assert.equal(item.status,'questionnaire');assert.equal(item.project.id,wedding.id);
  assert.equal(item.questionnaire,null);
  const answers=Object.fromEntries(questionnaireQuestions.map(({id})=>[id,id==='images'?['свечи/огни']:'Ответ пары']));
  run(db,user,'account.questionnaire',{entityId:item.id,version:item.version,answers});
  item=snapshot(db,owner).accountRegistrations[0];assert.equal(item.status,'complete');assert.deepEqual(item.questionnaire,answers);
  assert.equal(notifications(db,owner,{type:'account.registered'}).total,1);
  assert.deepEqual(restoreRegistrationNotifications(db),{pendingAccounts:0,delivered:0});
});

test('failed signup produces no registration or notification, and source-scoped delivery leaves unrelated reminders alone',t=>{
  const{db,owner,user,entry}=fixture(t);
  const count=()=>db.prepare('SELECT count(*) n FROM entities').get().n,before=count();
  assert.throws(()=>register(db,{slug:'tie',name:'Invalid',email:'invalid@example.test',phone:'899912345678',password}),e=>e.status===400);
  assert.throws(()=>register(db,{slug:'tie',name:'Duplicate',email:user.email,phone:'89990000000',password}),e=>e.status===409);
  assert.equal(count(),before);
  const task=insert(db,owner,'task',{title:'Unrelated',dueDate:'2020-01-01',status:'todo',assigneeUserId:owner.id});
  queueAccountRegistration(db,null,entry);
  assert.equal(processOutbox(db,Date.now(),100,{sourceId:entry.id}).delivered,0);
  assert.equal(db.prepare('SELECT count(*) n FROM notification_outbox WHERE source_id=?').get(task.id).n,0);
});

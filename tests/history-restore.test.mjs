import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,entity,uid,change} from '../server/db.mjs';
import {bootstrap,execute} from '../server/service.mjs';
import {grant} from '../server/auth.mjs';
import {calendar} from '../server/v2/calendar/index.mjs';
import {registerTestUser} from './fixtures/account.mjs';
function fixture(){
 const db=openDatabase(':memory:'),admin=bootstrap(db,{slug:'tie',agencyName:'Тест',name:'Владелец',email:'owner@example.test',password:'restore-password'}).user;
 const run=(op,body={},user=admin)=>execute(db,user,{id:uid(),op,...body});
 const project=run('project.create',{data:{name:'История теста',date:'2027-06-12'}});
 const audit=(row,action)=>db.prepare('SELECT * FROM audit WHERE entity_id=? AND action=? ORDER BY rowid DESC LIMIT 1').get(row.id,action);
 return {db,admin,run,project,audit};
}
const denied=(work,status)=>assert.throws(work,error=>error.status===status);
test('task history restores prior edits/status and deleted records with versioning and replay',()=>{
 const {db,admin,run,project:p,audit}=fixture();
 let row=run('task.create',{projectId:p.id,data:{title:'До правки',dueMode:'fixed',fixedDate:'2027-07-01'}});
 row=run('task.edit',{projectId:p.id,entityId:row.id,version:row.version,data:{title:'После правки',fixedDate:'2027-07-02'}});const edited=audit(row,'edit');
 row=run('task.setStatus',{projectId:p.id,entityId:row.id,version:row.version,status:'done'});
 row=run('task.restore',{projectId:p.id,entityId:row.id,version:row.version,auditId:edited.id});
 assert.equal(row.data.title,'До правки');assert.equal(row.data.status,'todo');assert.equal(row.data.dueDate,'2027-07-01');assert.equal(row.data.completedAt,null);
 row=run('task.delete',{projectId:p.id,entityId:row.id,version:row.version});const removed=audit(row,'delete');
 const command={id:uid(),op:'task.restore',projectId:p.id,entityId:row.id,version:row.version,auditId:removed.id};
 const restored=execute(db,admin,command);assert.equal(restored.deleted,false);assert.equal(restored.id,row.id);assert.equal(restored.version,row.version+1);
 assert.deepEqual(execute(db,admin,command),restored);assert.equal(entity(db,row.id).version,restored.version);
 assert.equal(calendar(db,admin,{projectId:p.id,from:'2027-07-01',to:'2027-07-03'}).items.find(item=>item.sourceId===row.id).start,'2027-07-01');
});
test('task history refuses stale/foreign snapshots and requires edit together with history rights',()=>{
 const {db,run,project:p,audit}=fixture();let row=run('task.create',{projectId:p.id,data:{title:'Защищённая задача'}});
 row=run('task.edit',{projectId:p.id,entityId:row.id,version:row.version,data:{title:'Изменённая задача'}});const history=audit(row,'edit');
 const other=run('task.create',{projectId:p.id,data:{title:'Другая задача'}});
 const command={projectId:p.id,entityId:row.id,version:row.version,auditId:history.id};
 denied(()=>run('task.restore',{...command,version:row.version-1}),409);
 denied(()=>run('task.restore',{...command,auditId:audit(other,'create').id}),404);
 const user=registerTestUser(db,{slug:'tie',name:'Читатель',email:'reader@example.test',password:'restore-password'}).user;
 const role=run('role.save',{name:'Только история',permissions:['read','history']});grant(db,user,role.id,p.id);
 denied(()=>run('task.restore',command,user),403);
 const restricted=run('role.save',{name:'Частичная правка',permissions:['read','history','edit']});grant(db,user,restricted.id,p.id,{fields:['description']});
 denied(()=>run('task.restore',command,user),403);assert.equal(entity(db,row.id).version,row.version);assert.equal(entity(db,row.id).data.title,'Изменённая задача');
});
test('restored task schedules follow current wedding date and blocked completion stays protected',()=>{
 const {db,admin,run,project:p,audit}=fixture();let row=run('task.create',{projectId:p.id,data:{title:'От даты',dueMode:'relative',offsetDays:-10}});
 row=run('task.delete',{projectId:p.id,entityId:row.id,version:row.version});change(db,admin,entity(db,p.id),{...p.data,date:'2027-07-12'});
 row=run('task.restore',{projectId:p.id,entityId:row.id,version:row.version,auditId:audit(row,'delete').id});assert.equal(row.data.dueDate,'2027-07-02');
 let dependency=run('task.create',{projectId:p.id,data:{title:'Зависимость'}});dependency=run('task.setStatus',{projectId:p.id,entityId:dependency.id,version:dependency.version,status:'done'});
 let dependent=run('task.create',{projectId:p.id,data:{title:'Зависимая',dependencyIds:[dependency.id]}});dependent=run('task.setStatus',{projectId:p.id,entityId:dependent.id,version:dependent.version,status:'done'});
 dependent=run('task.edit',{projectId:p.id,entityId:dependent.id,version:dependent.version,data:{description:'Новая версия'}});const history=audit(dependent,'edit');
 run('task.setStatus',{projectId:p.id,entityId:dependency.id,version:dependency.version,status:'todo'});
 denied(()=>run('task.restore',{projectId:p.id,entityId:dependent.id,version:dependent.version,auditId:history.id}),409);assert.equal(entity(db,dependent.id).version,dependent.version);
});
const meetingData=(admin,title='Встреча')=>({title,startAt:'2027-07-01T07:00:00.000Z',endAt:'2027-07-01T08:00:00.000Z',timeZone:'Europe/Moscow',assignedUserIds:[admin.id],participantUserIds:[]});
test('meeting history restores changed times and soft deletions including agency meetings',()=>{
 const {db,admin,run,project:p,audit}=fixture();
 for(const projectId of [p.id,null]){
  let row=run('meeting.save',{projectId,data:meetingData(admin)});
  row=run('meeting.save',{projectId,entityId:row.id,version:row.version,data:{title:'Правка',startAt:'2027-07-02T07:00:00.000Z',endAt:'2027-07-02T08:00:00.000Z'}});const history=audit(row,'edit');
  row=run('meeting.restore',{projectId,entityId:row.id,version:row.version,auditId:history.id});assert.equal(row.data.title,'Встреча');assert.equal(row.data.startAt,'2027-07-01T07:00:00.000Z');
  row=run('meeting.delete',{projectId,entityId:row.id,version:row.version});
  const restored=run('meeting.restore',{projectId,entityId:row.id,version:row.version,auditId:audit(row,'delete').id});assert.equal(restored.deleted,false);assert.equal(restored.id,row.id);
  assert.ok(calendar(db,admin,{from:'2027-07-01',to:'2027-07-02',...projectId?{projectId}:{}}).items.some(item=>item.sourceId===row.id));
  // Free the time slot before testing the next scope.
  run('meeting.delete',{projectId,entityId:row.id,version:restored.version});
 }
});
test('meeting restore checks current versions, snapshot identity and explicit conflict confirmation',()=>{
 const {db,admin,run,project:p,audit}=fixture();let row=run('meeting.save',{projectId:p.id,data:meetingData(admin)});
 row=run('meeting.delete',{projectId:p.id,entityId:row.id,version:row.version});const history=audit(row,'delete');
 const competing=run('meeting.save',{projectId:p.id,data:meetingData(admin,'Другая встреча')});
 const command={projectId:p.id,entityId:row.id,version:row.version,auditId:history.id};let conflict;
 assert.throws(()=>run('meeting.restore',command),error=>{conflict=error.details;return error.status===409&&conflict.conflicts.length>0});assert.equal(entity(db,row.id).deleted,true);
 denied(()=>run('meeting.restore',{...command,auditId:audit(competing,'create').id}),404);
 denied(()=>run('meeting.restore',{...command,version:row.version-1}),409);
 const restored=run('meeting.restore',{...command,conflictDigest:conflict.digest,conflictReason:'Согласовано раздельное участие'});assert.equal(restored.deleted,false);assert.equal(restored.data.conflictReason,'Согласовано раздельное участие');
});

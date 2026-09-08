import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, entity, insert, uid } from '../server/db.mjs';
import { defaults, grant } from '../server/auth.mjs';
import { bootstrap } from '../server/service.mjs';
import { executeModule } from '../server/v2/common.mjs';
import { migrate, operations, previewReschedule } from '../server/v2/workflow/index.mjs';

let sequence=0;
const command = (db,user,op,body={}) => executeModule(db,user,{id:`workflow_cmd_${++sequence}_safe`,op,...body},operations);
const fails = (fn,status=400) => assert.throws(fn,error=>error?.status===status);

function fixture() {
  const db=openDatabase(':memory:');
  const setup=bootstrap(db,{slug:'wflow',agencyName:'Тест',email:'owner@example.test',name:'Владелец',password:'strong-pass-1'});
  migrate(db);
  const project=insert(db,setup.user,'project',{name:'Анна и Илья',date:'2027-06-12',location:'Москва',timeZone:'Europe/Moscow',leadOrganizerUserId:setup.user.id});
  return {db,admin:setup.user,project};
}
function user(db, admin, email, name) {
  const person={id:uid(),agency_id:admin.agency_id,email,name,password:'hash',protected:0,disabled:0,version:1};
  db.prepare('INSERT INTO users(id,agency_id,email,name,password,protected,disabled,version) VALUES(?,?,?,?,?,?,?,?)').run(person.id,person.agency_id,person.email,person.name,person.password,0,0,1);
  return person;
}
function role(db, admin, key) { return db.prepare('SELECT id FROM roles WHERE agency_id=? AND key=?').get(admin.agency_id,key).id; }
function give(db, person, key, project) { grant(db,person,role(db,person,key),project.id); }

test('task dependencies, versions and relative dates are enforced atomically',()=>{
  const {db,admin,project}=fixture();
  const first=command(db,admin,'task.create',{projectId:project.id,data:{title:'Выбрать площадку',dueMode:'relative',offsetDays:-60}});
  let second=command(db,admin,'task.create',{projectId:project.id,data:{title:'Подписать договор',dueMode:'relative',offsetDays:-50,dependencyIds:[first.id]}});
  assert.equal(second.data.dueDate,'2027-04-23');
  fails(()=>command(db,admin,'task.edit',{projectId:project.id,entityId:second.id,version:second.version,data:{status:'done'}}),409);
  fails(()=>command(db,admin,'task.setStatus',{projectId:project.id,entityId:second.id,version:second.version,status:'done'}),409);
  const done=command(db,admin,'task.setStatus',{projectId:project.id,entityId:first.id,version:first.version,status:'done'});
  second=command(db,admin,'task.setStatus',{projectId:project.id,entityId:second.id,version:second.version,status:'done'});
  assert.equal(second.data.completedBy,admin.id);
  fails(()=>command(db,admin,'task.edit',{projectId:project.id,entityId:first.id,version:first.version,data:{title:'Старая правка'}}),409);
  fails(()=>command(db,admin,'task.edit',{projectId:project.id,entityId:done.id,version:done.version,data:{dependencyIds:[second.id]}}),409);
});

test('task delete reports dependents and reschedule rejects stale previews',()=>{
  const {db,admin,project}=fixture();
  const a=command(db,admin,'task.create',{projectId:project.id,data:{title:'A',dueMode:'relative',offsetDays:-30}});
  command(db,admin,'task.create',{projectId:project.id,data:{title:'B',dueMode:'relative',offsetDays:-20,dependencyIds:[a.id]}});
  fails(()=>command(db,admin,'task.delete',{projectId:project.id,entityId:a.id,version:a.version}),409);
  const preview=previewReschedule(db,admin,{projectId:project.id,newDate:'2027-07-12'});
  command(db,admin,'task.edit',{projectId:project.id,entityId:a.id,version:a.version,data:{title:'A+',dueMode:'relative',offsetDays:-30}});
  fails(()=>command(db,admin,'project.reschedule.apply',{projectId:project.id,newDate:'2027-07-12',projectVersion:preview.projectVersion,previewDigest:preview.digest,sourceVersions:preview.affected.map(item=>({id:item.id,version:item.version}))}),409);
});

test('reschedule moves only explicitly anchored meetings in project time zone',()=>{
  const {db,admin,project}=fixture();
  const anchored=insert(db,admin,'meeting',{title:'Созвон',dateAnchor:'wedding',offsetDays:0,localStartTime:'10:30',durationMinutes:90,timeZone:'Europe/Moscow',startAt:'2027-06-12T07:30:00.000Z',endAt:'2027-06-12T09:00:00.000Z'},project.id);
  const plain=insert(db,admin,'meeting',{title:'Без якоря',startAt:'2027-06-10T07:30:00.000Z',endAt:'2027-06-10T09:00:00.000Z'},project.id);
  const preview=previewReschedule(db,admin,{projectId:project.id,newDate:'2027-07-12'});
  const meeting=preview.affected.find(item=>item.id===anchored.id);assert.equal(meeting.newStartAt,'2027-07-12T07:30:00.000Z');
  const result=command(db,admin,'project.reschedule.apply',{projectId:project.id,newDate:'2027-07-12',projectVersion:preview.projectVersion,previewDigest:preview.digest,sourceVersions:preview.affected.map(item=>({id:item.id,version:item.version}))});
  assert.equal(result.project.data.date,'2027-07-12');assert.equal(entity(db,anchored.id).data.startAt,'2027-07-12T07:30:00.000Z');assert.equal(entity(db,plain.id).data.startAt,'2027-06-10T07:30:00.000Z');
});

test('approval votes require the actual approver and all policy never accepts conflicting options',()=>{
  const {db,admin,project}=fixture();
  const anna=user(db,admin,'anna@example.test','Анна'),ilya=user(db,admin,'ilya@example.test','Илья'),other=user(db,admin,'other@example.test','Другой');
  give(db,anna,'couple',project);give(db,ilya,'couple',project);give(db,other,'couple',project);
  let approval=command(db,admin,'approval.saveDraft',{projectId:project.id,data:{title:'Фотограф',category:'vendor',approverUserIds:[anna.id,ilya.id],policy:'all',options:[{id:'a',title:'Вариант A',price:100000},{id:'b',title:'Вариант B',price:110000}]}});
  const published=command(db,admin,'approval.publish',{projectId:project.id,entityId:approval.id,version:approval.version}); approval=published.approval;
  fails(()=>command(db,other,'approval.vote',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,decision:'approve',optionId:'a'}),403);
  command(db,anna,'approval.vote',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,decision:'approve',optionId:'a'});
  const conflict=command(db,ilya,'approval.vote',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,decision:'approve',optionId:'b'});
  assert.equal(conflict.approval.data.state,'in_review');assert.equal(conflict.approval.data.discussion,true);
  const approved=command(db,ilya,'approval.vote',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,decision:'approve',optionId:'a'});
  assert.equal(approved.approval.data.state,'approved');assert.equal(approved.approval.data.outcomeOptionId,'a');
  fails(()=>command(db,admin,'approval.saveDraft',{projectId:project.id,entityId:approval.id,version:entity(db,approval.id).version,data:{title:'Подмена'}}),409);
});

test('request changes is final for any policy and requires a comment',()=>{
  const {db,admin,project}=fixture();const anna=user(db,admin,'anna2@example.test','Анна');give(db,anna,'couple',project);
  const approval=command(db,admin,'approval.saveDraft',{projectId:project.id,data:{title:'Меню',category:'menu',approverUserIds:[anna.id],policy:'any',options:[{id:'menu',title:'Меню',price:50000}]}});
  const published=command(db,admin,'approval.publish',{projectId:project.id,entityId:approval.id,version:approval.version});
  fails(()=>command(db,anna,'approval.vote',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,decision:'request_changes',comment:''}),400);
  const result=command(db,anna,'approval.vote',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,decision:'request_changes',comment:'Нужен другой состав'});
  assert.equal(result.approval.data.state,'changes');
});

test('approved budget application preserves paid amount and is idempotent by revision option',()=>{
  const {db,admin,project}=fixture();
  const selection=insert(db,admin,'selection',{title:'Старый вариант',price:90000,selected:true,terms:'',dueDate:''},project.id);
  const obligation=insert(db,admin,'obligation',{title:'Старый вариант',priceKind:'amount',agreed:90000,planned:null,dueDate:'',fee:false,condition:'',selectionId:selection.id},project.id);
  const linked=entity(db,selection.id); db.prepare('UPDATE entities SET data=?,version=version+1 WHERE id=?').run(JSON.stringify({...linked.data,obligationId:obligation.id}),linked.id);
  const approval=command(db,admin,'approval.saveDraft',{projectId:project.id,data:{title:'Новый вариант',category:'vendor',approverUserIds:[admin.id],policy:'any',options:[{id:'winner',title:'Новый вариант',price:120000,selectionId:selection.id,terms:'До полуночи'}]}});
  const published=command(db,admin,'approval.publish',{projectId:project.id,entityId:approval.id,version:approval.version});
  command(db,admin,'approval.vote',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,decision:'approve',optionId:'winner'});
  const applied=command(db,admin,'approval.applyToBudget',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,optionId:'winner',selectionVersion:entity(db,selection.id).version,obligationVersion:entity(db,obligation.id).version});
  assert.equal(applied.obligation.data.agreed,120000);assert.equal(applied.selection.data.approvalOptionId,'winner');
  const repeated=command(db,admin,'approval.applyToBudget',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,optionId:'winner'});
  assert.equal(repeated.alreadyApplied,true);
  insert(db,admin,'movement',{type:'payment',amount:115000,obligationId:obligation.id},project.id);
  const second=command(db,admin,'approval.saveDraft',{projectId:project.id,data:{title:'Дешевле',category:'vendor',approverUserIds:[admin.id],policy:'any',options:[{id:'cheap',title:'Дешевле',price:100000,selectionId:selection.id}]}});
  const sent=command(db,admin,'approval.publish',{projectId:project.id,entityId:second.id,version:second.version});command(db,admin,'approval.vote',{projectId:project.id,entityId:second.id,revisionId:sent.revision.id,decision:'approve',optionId:'cheap'});
  fails(()=>command(db,admin,'approval.applyToBudget',{projectId:project.id,entityId:second.id,revisionId:sent.revision.id,optionId:'cheap',selectionVersion:entity(db,selection.id).version,obligationVersion:entity(db,obligation.id).version}),409);
});

test('module replay validates current authorization before returning saved result',()=>{
  const {db,admin,project}=fixture();const task=command(db,admin,'task.create',{projectId:project.id,data:{title:'Однократно',dueMode:'fixed',fixedDate:'2027-05-01'}});
  const replay={id:'workflow_replay_authorized',op:'task.create',projectId:project.id,data:{title:'Повтор',dueMode:'fixed',fixedDate:'2027-05-02'}};
  const first=executeModule(db,admin,replay,operations),second=executeModule(db,admin,replay,operations);assert.equal(first.id,second.id);assert.equal(task.data.title,'Однократно');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, entity, insert, uid } from '../server/db.mjs';
import { defaults, grant } from '../server/auth.mjs';
import { bootstrap } from '../server/service.mjs';
import { executeModule } from '../server/v2/common.mjs';
import { getApproval, getTask, guardProjectDateEdit, listTasks, migrate, operations, previewBudgetApplication, previewReschedule, suggestTasks } from '../server/v2/workflow/index.mjs';

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

test('organizer focus is staff-only and controls agency task list membership',()=>{
  const {db,admin,project}=fixture(),organizer=user(db,admin,'organizer@example.test','Организатор'),couple=user(db,admin,'couple@example.test','Пара');
  grant(db,organizer,role(db,organizer,'organizer'));give(db,couple,'couple',project);
  const earlier=command(db,admin,'task.create',{projectId:project.id,data:{title:'Ранняя обычная',dueMode:'fixed',fixedDate:'2027-04-01'}}),later=command(db,admin,'task.create',{projectId:project.id,data:{title:'Главная для организатора',dueMode:'fixed',fixedDate:'2027-05-01'}});
  fails(()=>command(db,couple,'task.setOrganizerFocus',{projectId:project.id,entityId:later.id,version:later.version,focused:true}),403);
  fails(()=>command(db,couple,'task.edit',{projectId:project.id,entityId:later.id,version:later.version,data:{organizerFocus:true}}),409);
  const saved=command(db,organizer,'task.setOrganizerFocus',{projectId:project.id,entityId:later.id,version:later.version,focused:true});
  assert.equal(saved.data.organizerFocus,true);assert.equal(saved.data.organizerFocusedBy,organizer.id);
  const projectTasks=listTasks(db,organizer,{projectId:project.id,status:'active'});assert.equal(projectTasks.total,2);assert.equal(projectTasks.items.every(item=>item.canSetOrganizerFocus),true);
  const coupleTasks=listTasks(db,couple,{projectId:project.id,status:'active'});assert.equal(coupleTasks.items.every(item=>item.canSetOrganizerFocus===false),true);
  assert.deepEqual(listTasks(db,organizer,{status:'active'}).items.map(item=>item.id),[later.id]);
  assert.equal(listTasks(db,organizer,{status:'active'}).items.some(item=>item.id===earlier.id),false);
  const done=command(db,organizer,'task.setStatus',{projectId:project.id,entityId:later.id,version:saved.version,status:'done'});assert.equal(done.data.organizerFocus,false);assert.equal(listTasks(db,organizer,{status:'active',focus:true}).total,0);
});

test('task suggestions reuse readable history without exposing other weddings',()=>{
  const {db,admin,project}=fixture(),past=insert(db,admin,'project',{name:'Прошлая свадьба',date:'2027-01-20',timeZone:'Europe/Moscow'}),second=insert(db,admin,'project',{name:'Другая свадьба',date:'2027-03-20',timeZone:'Europe/Moscow'});
  insert(db,admin,'task',{title:'Согласовать холодные фонтаны',description:'Проверить площадку, технику безопасности и время запуска',phaseKey:'day',status:'done',dueMode:'relative',fixedDate:'',offsetDays:-30,dueDate:'2026-12-21',priority:'normal',participantUserIds:[],dependencyIds:[]},past.id);
  insert(db,admin,'task',{title:'Согласовать холодные фонтаны',description:'Проверить технические ограничения площадки',phaseKey:'day',status:'done',dueMode:'relative',fixedDate:'',offsetDays:-28,dueDate:'2027-02-20',priority:'normal',participantUserIds:[],dependencyIds:[]},second.id);
  const initial=suggestTasks(db,admin,{projectId:project.id,query:'',limit:12});assert(initial.items.length>0);assert(initial.items.some(item=>item.source==='preset'&&item.title==='Поиск площадки'));
  const result=suggestTasks(db,admin,{projectId:project.id,query:'холодные фонтаны'});
  assert.equal(result.items.length,1);assert.equal(result.items[0].title,'Согласовать холодные фонтаны');assert.equal(result.items[0].usageCount,2);assert([-30,-28].includes(result.items[0].offsetDays));assert.equal(JSON.stringify(result).includes('Прошлая свадьба'),false);
  const couple=user(db,admin,'suggestions-couple@example.test','Пара');give(db,couple,'couple',project);
  assert.deepEqual(suggestTasks(db,couple,{projectId:project.id,query:'фонтаны'}).items,[]);
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
  fails(()=>command(db,admin,'approval.applyToBudget',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,optionId:'winner',selectionId:selection.id,obligationId:obligation.id,selectionVersion:entity(db,selection.id).version,obligationVersion:entity(db,obligation.id).version}),409);
  const preview=previewBudgetApplication(db,admin,{projectId:project.id,id:approval.id,revisionId:published.revision.id,optionId:'winner',selectionId:selection.id,obligationId:obligation.id});
  const applied=command(db,admin,'approval.applyToBudget',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,optionId:'winner',selectionId:selection.id,obligationId:obligation.id,selectionVersion:preview.selection.version,obligationVersion:preview.obligation.version,previewDigest:preview.digest,confirmed:true});
  assert.equal(applied.obligation.data.agreed,120000);assert.equal(applied.selection.data.approvalOptionId,'winner');
  const repeated=command(db,admin,'approval.applyToBudget',{projectId:project.id,entityId:approval.id,revisionId:published.revision.id,optionId:'winner'});
  assert.equal(repeated.alreadyApplied,true);
  insert(db,admin,'movement',{type:'payment',amount:115000,obligationId:obligation.id},project.id);
  const second=command(db,admin,'approval.saveDraft',{projectId:project.id,data:{title:'Дешевле',category:'vendor',approverUserIds:[admin.id],policy:'any',options:[{id:'cheap',title:'Дешевле',price:100000,selectionId:selection.id}]}});
  const sent=command(db,admin,'approval.publish',{projectId:project.id,entityId:second.id,version:second.version});command(db,admin,'approval.vote',{projectId:project.id,entityId:second.id,revisionId:sent.revision.id,decision:'approve',optionId:'cheap'});
  const conflict=previewBudgetApplication(db,admin,{projectId:project.id,id:second.id,revisionId:sent.revision.id,optionId:'cheap',selectionId:selection.id,obligationId:obligation.id});assert.equal(conflict.conflict,true);
  fails(()=>command(db,admin,'approval.applyToBudget',{projectId:project.id,entityId:second.id,revisionId:sent.revision.id,optionId:'cheap',selectionId:selection.id,obligationId:obligation.id,selectionVersion:conflict.selection.version,obligationVersion:conflict.obligation.version,previewDigest:conflict.digest,confirmed:true}),409);
});

test('module replay validates current authorization before returning saved result',()=>{
  const {db,admin,project}=fixture();const task=command(db,admin,'task.create',{projectId:project.id,data:{title:'Однократно',dueMode:'fixed',fixedDate:'2027-05-01'}});
  const replay={id:'workflow_replay_authorized',op:'task.create',projectId:project.id,data:{title:'Повтор',dueMode:'fixed',fixedDate:'2027-05-02'}};
  const first=executeModule(db,admin,replay,operations),second=executeModule(db,admin,replay,operations);assert.equal(first.id,second.id);assert.equal(task.data.title,'Однократно');
});

test('template repeat is safe, new version does not overwrite, and date guard permits unchanged values',()=>{
  const {db,admin,project}=fixture();
  const template=insert(db,admin,'template',{name:'База',taskBlueprints:[{key:'venue',title:'Площадка',phaseKey:'plan',offsetDays:-60,order:0}]});
  const first=command(db,admin,'taskTemplate.apply',{projectId:project.id,templateId:template.id,templateVersion:template.version,projectVersion:project.version});
  assert.equal(first.created.length,1);fails(()=>command(db,admin,'taskTemplate.apply',{projectId:project.id,templateId:template.id,templateVersion:template.version,projectVersion:project.version}),409);
  const changed=entity(db,first.created[0].id);db.prepare('UPDATE entities SET data=?,version=version+1 WHERE id=?').run(JSON.stringify({...changed.data,title:'Ручная правка'}),changed.id);
  const nextTemplate=entity(db,template.id);db.prepare('UPDATE entities SET data=?,version=version+1 WHERE id=?').run(JSON.stringify({...nextTemplate.data,taskBlueprints:[...nextTemplate.data.taskBlueprints,{key:'menu',title:'Меню',phaseKey:'plan',offsetDays:-30,order:1}]}),nextTemplate.id);
  const second=command(db,admin,'taskTemplate.apply',{projectId:project.id,templateId:template.id,templateVersion:entity(db,template.id).version,projectVersion:project.version});
  assert.equal(second.created.length,1);assert.equal(entity(db,changed.id).data.title,'Ручная правка');
  guardProjectDateEdit(db,admin,{op:'entity.edit',entityId:project.id,data:{date:project.data.date}});
  fails(()=>guardProjectDateEdit(db,admin,{op:'entity.edit',entityId:project.id,data:{date:'2027-07-01'}}),409);
});

test('task comments, deletion listing and restore use current versions',()=>{
  const {db,admin,project}=fixture();
  let task=command(db,admin,'task.create',{projectId:project.id,data:{title:'Комментарии',dueMode:'fixed',fixedDate:'2027-05-01'}});
  let comment=command(db,admin,'comment.create',{projectId:project.id,parentId:task.id,text:'Первый комментарий'});
  assert.equal(getTask(db,admin,{projectId:project.id,id:task.id}).comments.length,1);
  comment=command(db,admin,'comment.edit',{projectId:project.id,entityId:comment.id,version:comment.version,text:'Исправленный комментарий'});
  command(db,admin,'comment.delete',{projectId:project.id,entityId:comment.id,version:comment.version});
  assert.equal(getTask(db,admin,{projectId:project.id,id:task.id}).comments.length,0);
  task=command(db,admin,'task.delete',{projectId:project.id,entityId:task.id,version:task.version});
  assert.equal(listTasks(db,admin,{projectId:project.id,includeDeleted:true}).items.some(item=>item.id===task.id&&item.deleted),true);
  const restored=command(db,admin,'task.restore',{projectId:project.id,entityId:task.id,version:task.version});assert.equal(restored.deleted,false);
});

test('approved topic can start a reasoned second immutable revision',()=>{
  const {db,admin,project}=fixture();
  let approval=command(db,admin,'approval.saveDraft',{projectId:project.id,data:{title:'Свет',category:'decor',approverUserIds:[admin.id],policy:'any',options:[{id:'warm',title:'Тёплый свет',price:500000}]}});
  const first=command(db,admin,'approval.publish',{projectId:project.id,entityId:approval.id,version:approval.version});
  approval=command(db,admin,'approval.vote',{projectId:project.id,entityId:approval.id,revisionId:first.revision.id,decision:'approve',optionId:'warm'}).approval;
  approval=command(db,admin,'approval.startRevision',{projectId:project.id,entityId:approval.id,version:approval.version,reason:'Изменилась схема зала'});
  approval=command(db,admin,'approval.saveDraft',{projectId:project.id,entityId:approval.id,version:approval.version,data:{options:[{id:'warm',title:'Тёплый свет',price:550000}]}});
  const second=command(db,admin,'approval.publish',{projectId:project.id,entityId:approval.id,version:approval.version});
  assert.equal(second.revision.data.number,2);const history=getApproval(db,admin,{projectId:project.id,id:approval.id});assert.equal(history.revisions.length,2);assert.equal(history.revisions.find(item=>item.revision.id===first.revision.id).votes.length,1);
});

test('approval revisions freeze authorized file versions and require integer cents',()=>{
  const {db,admin,project}=fixture(),file=insert(db,admin,'file',{name:'Референс.jpg',size:123},project.id);
  fails(()=>command(db,admin,'approval.saveDraft',{projectId:project.id,data:{title:'Фото',category:'other',approverUserIds:[admin.id],policy:'any',options:[{id:'bad',title:'Плавающая цена',price:12.5}]}}));
  const approval=command(db,admin,'approval.saveDraft',{projectId:project.id,data:{title:'Фото',category:'other',approverUserIds:[admin.id],policy:'any',options:[{id:'photo',title:'Референс',price:1200,fileIds:[file.id],imageIds:[file.id]}]}});
  const published=command(db,admin,'approval.publish',{projectId:project.id,entityId:approval.id,version:approval.version});
  assert.deepEqual(published.revision.data.options[0].fileRefs,[{id:file.id,version:file.version}]);
});

test('time-zone reschedule previews unchanged finance and dirties publication atomically',()=>{
  const {db,admin,project}=fixture();
  const fixed=command(db,admin,'task.create',{projectId:project.id,data:{title:'Фиксированная',dueMode:'fixed',fixedDate:'2027-05-01'}});
  const meeting=insert(db,admin,'meeting',{title:'На следующий день',dateAnchor:'wedding',offsetDays:1,localStartTime:'10:30',durationMinutes:60,timeZone:'Europe/Moscow',startAt:'2027-06-13T07:30:00.000Z',endAt:'2027-06-13T08:30:00.000Z'},project.id);
  const obligation=insert(db,admin,'obligation',{title:'Площадка',priceKind:'amount',agreed:10000,dueDate:'2027-05-10',selectionId:'none'},project.id);
  insert(db,admin,'movement',{type:'deposit',amount:10000,date:'2027-04-10',to:admin.id},project.id);
  const site=insert(db,admin,'microsite',{status:'published',dirty:false},project.id);
  const preview=previewReschedule(db,admin,{projectId:project.id,newDate:project.data.date,newTimeZone:'Europe/Berlin'});
  assert.equal(preview.unchanged.some(item=>item.id===fixed.id&&item.reason==='fixed_task'),true);assert.equal(preview.unchanged.some(item=>item.id===obligation.id),true);
  const result=command(db,admin,'project.reschedule.apply',{projectId:project.id,newDate:preview.newDate,newTimeZone:preview.newTimeZone,projectVersion:preview.projectVersion,previewDigest:preview.digest,sourceVersions:preview.affected.map(item=>({id:item.id,version:item.version}))});
  assert.equal(result.project.data.timeZone,'Europe/Berlin');assert.equal(entity(db,meeting.id).data.timeZone,'Europe/Berlin');assert.equal(entity(db,meeting.id).data.startAt,'2027-06-13T08:30:00.000Z');assert.equal(entity(db,fixed.id).version,fixed.version);assert.equal(entity(db,site.id).data.dirty,true);
});

test('focused agency task pagination retains tasks beyond the first project page',()=>{
 const {db,admin,project}=fixture();
 for(let i=0;i<301;i++)insert(db,admin,'task',{title:`Задача ${i}`,status:'todo',dueDate:'2027-06-01',order:i,organizerFocus:true},project.id);
 const first=listTasks(db,admin,{limit:200});const last=listTasks(db,admin,{offset:first.nextOffset,limit:200});
 assert.equal(first.total,301);assert.equal(first.items.length,200);assert.equal(last.items.length,101);assert.equal(last.nextOffset,null);assert.equal(new Set([...first.items,...last.items].map(row=>row.id)).size,301);
});

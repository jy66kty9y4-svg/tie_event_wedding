import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,entity,entities,uid} from '../server/db.mjs';
import {bootstrap,execute,register,snapshot} from '../server/service.mjs';
import {registerTestUser} from './fixtures/account.mjs';
import {calendar} from '../server/v2/calendar/index.mjs';
import {previewReschedule,previewTemplateApplication} from '../server/v2/workflow/index.mjs';
import {questionnaireQuestions} from '../src/questionnaire.js';

const password='open-date-test-password';
const answers=Object.fromEntries(questionnaireQuestions.map(({id})=>[id,id==='images'?['свечи/огни']:'Ответ пары']));
const run=(db,user,op,data={})=>execute(db,user,{id:uid(),op,...data});
function fixture(t){const db=openDatabase(':memory:');t.after(()=>db.close());const user=bootstrap(db,{slug:'tie',agencyName:'Test',name:'Owner',email:'owner@example.test',password}).user;return{db,user};}
const tasks=(db,user,p)=>entities(db,user.agency_id,p.id,'task');
const reschedule=(db,user,p,newDate)=>{
  const preview=previewReschedule(db,user,{projectId:p.id,newDate});
  return run(db,user,'project.reschedule.apply',{projectId:p.id,newDate,projectVersion:preview.projectVersion,previewDigest:preview.digest});
};
function onboarding(db,owner,project,email='couple@example.test',phone='+79991234567'){
  const user=register(db,{name:'Пара',email,phone,password}).user;
  const pending=snapshot(db,user).onboarding;
  const approved=run(db,owner,'account.approve',{entityId:pending.id,version:pending.version,weddingId:project.id});
  return{user,approved};
}

test('a brief with no wedding date can be edited, reviewed and approved without inventing dates',t=>{
  const{db,user:owner}=fixture(t),user=registerTestUser(db,{name:'Пара',email:'legacy@example.test',password}).user;
  let brief=run(db,user,'application.create',{data:{name:'Анна и Иван',contact:'anna@example.test',message:'Открытая дата',questionnaire:answers}});
  assert.equal(brief.data.date,'');
  brief=run(db,user,'application.questionnaire',{entityId:brief.id,version:brief.version,answers,date:'2027-06-12'});
  assert.equal(brief.data.date,'2027-06-12');
  brief=run(db,user,'application.questionnaire',{entityId:brief.id,version:brief.version,answers,date:''});
  const approved=run(db,owner,'application.review',{entityId:brief.id,version:brief.version,status:'approved'}),project=entity(db,approved.data.projectId);
  assert.equal(project.data.date,'');assert.equal(tasks(db,owner,project).length,25);
  assert(tasks(db,owner,project).every(row=>row.data.dueMode==='none'&&row.data.dueDate===''));
  assert.equal(calendar(db,owner,{projectId:project.id,from:'2027-01-01',to:'2027-03-31'}).items.length,0);
  assert.equal(snapshot(db,user,project.id).project.data.date,'');
});

test('open weddings support relative task edits and template preview while keeping concrete dates valid',t=>{
  const{db,user}=fixture(t),project=run(db,user,'project.create',{data:{name:'Открытая свадьба',date:''}});
  const row=run(db,user,'task.create',{projectId:project.id,data:{title:'До свадьбы',dueMode:'relative',offsetDays:-5}});
  assert.equal(row.data.dueDate,'');
  const updated=run(db,user,'task.edit',{projectId:project.id,entityId:row.id,version:row.version,data:{description:'Описание'}});assert.equal(updated.data.dueDate,'');
  const template=entities(db,user.agency_id,null,'template')[0];
  const changed=run(db,user,'entity.edit',{entityId:template.id,version:template.version,data:{taskBlueprints:[{key:'open-extra',title:'Новый пункт',phaseKey:'start',offsetDays:-1}]}});
  const preview=previewTemplateApplication(db,user,{projectId:project.id,templateId:changed.id,templateVersion:changed.version});
  assert.equal(preview.adds[0].dueDate,'');assert.equal(preview.adds[0].overdue,false);
  run(db,user,'taskTemplate.apply',{projectId:project.id,templateId:changed.id,templateVersion:changed.version,projectVersion:preview.projectVersion});
  assert(tasks(db,user,project).some(row=>row.data.sourceTemplateKey==='open-extra'&&row.data.dueDate===''));
  assert.throws(()=>run(db,user,'project.create',{data:{name:'Неверная',date:'2027-02-30'}}),e=>e.status===400);
  run(db,user,'entity.edit',{projectId:project.id,entityId:project.id,version:project.version,data:{notes:'Детали сохранились'}});
});

test('choosing a date later sets only active relative deadlines and reopening clears them without touching fixed tasks',t=>{
  const{db,user}=fixture(t),project=run(db,user,'project.create',{data:{name:'Открытая свадьба'}});
  const make=data=>run(db,user,'task.create',{projectId:project.id,data});
  const relative=make({title:'За пять дней',dueMode:'relative',offsetDays:-5}),fixed=make({title:'Фиксированная',dueMode:'fixed',fixedDate:'2027-01-02'}),none=make({title:'Без срока'});
  const done=make({title:'Завершена',dueMode:'relative',offsetDays:-1});run(db,user,'task.setStatus',{projectId:project.id,entityId:done.id,version:done.version,status:'done'});
  reschedule(db,user,project,'2027-06-12');
  assert.equal(entity(db,relative.id).data.dueDate,'2027-06-07');assert.equal(entity(db,fixed.id).data.dueDate,'2027-01-02');
  assert.equal(entity(db,none.id).data.dueDate,'');assert.equal(entity(db,done.id).data.dueDate,'');
  reschedule(db,user,entity(db,project.id),'');
  assert.equal(entity(db,project.id).data.date,'');assert.equal(entity(db,relative.id).data.dueDate,'');assert.equal(entity(db,fixed.id).data.dueDate,'2027-01-02');
});

test('approved onboarding can submit an open date or set the first date atomically with its questionnaire',t=>{
  const{db,user:owner}=fixture(t),open=run(db,owner,'project.create',{data:{name:'Открытая свадьба'}}),first=onboarding(db,owner,open);
  const completed=run(db,first.user,'account.questionnaire',{entityId:first.approved.id,version:first.approved.version,answers,weddingDate:'',projectVersion:open.version});
  assert.equal(completed.data.weddingDate,'');assert.equal(snapshot(db,first.user,open.id).project.data.date,'');
  const secondProject=run(db,owner,'project.create',{data:{name:'Дата из брифа'}}),second=onboarding(db,owner,secondProject,'second@example.test','+79991234568');
  const body={id:uid(),op:'account.questionnaire',entityId:second.approved.id,version:second.approved.version,answers,weddingDate:'2027-06-12',projectVersion:secondProject.version};
  const submitted=execute(db,second.user,body);assert.deepEqual(execute(db,second.user,body),submitted);
  assert.equal(snapshot(db,second.user,secondProject.id).project.data.date,'2027-06-12');
  assert(tasks(db,owner,secondProject).every(row=>row.data.dueMode==='none'&&row.data.dueDate===''));
});

test('stale briefs, invalid dates and changes to already agreed dates do not complete onboarding or overwrite a wedding',t=>{
  const{db,user:owner}=fixture(t),project=run(db,owner,'project.create',{data:{name:'Открытая'}}),{user,approved}=onboarding(db,owner,project);
  const base={entityId:approved.id,version:approved.version,answers,projectVersion:project.version};
  assert.throws(()=>run(db,user,'account.questionnaire',{...base,weddingDate:'2027-02-30'}),e=>e.status===400);
  reschedule(db,owner,project,'2027-06-12');
  assert.throws(()=>run(db,user,'account.questionnaire',{...base,weddingDate:''}),e=>e.status===409);
  const current=entity(db,project.id);
  assert.throws(()=>run(db,user,'account.questionnaire',{...base,projectVersion:current.version,weddingDate:''}),e=>e.status===409);
  assert.equal(snapshot(db,user).onboarding.status,'questionnaire');assert.equal(entity(db,project.id).data.date,'2027-06-12');
  assert.throws(()=>snapshot(db,user,project.id),e=>e.status===403);
  run(db,user,'account.questionnaire',{...base,projectVersion:current.version,weddingDate:'2027-06-12'});
  assert.equal(snapshot(db,user,project.id).project.data.date,'2027-06-12');
});

test('existing wedding-anchored meetings remain intact when clearing their wedding date is rejected',t=>{
  const{db,user}=fixture(t),project=run(db,user,'project.create',{data:{name:'Согласована',date:'2027-06-12'}});
  const meeting=run(db,user,'meeting.save',{projectId:project.id,data:{title:'Церемония',dateAnchor:'wedding',offsetDays:0,localStartTime:'14:00',durationMinutes:30}});
  assert.throws(()=>reschedule(db,user,project,''),e=>e.status===409&&e.details.code==='anchored_meeting_requires_date');
  assert.equal(entity(db,project.id).data.date,'2027-06-12');assert.deepEqual(entity(db,meeting.id).data,meeting.data);
});

test('first-date assignment cannot bypass a revoked field grant and rolls back questionnaire completion',t=>{
  const{db,user:owner}=fixture(t),project=run(db,owner,'project.create',{data:{name:'Открытая'}}),{user,approved}=onboarding(db,owner,project);
  db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run(JSON.stringify({sections:['tasks'],fields:['title']}),user.id);
  assert.throws(()=>run(db,user,'account.questionnaire',{entityId:approved.id,version:approved.version,answers,weddingDate:'2027-06-12',projectVersion:project.version}),e=>e.status===403);
  assert.equal(entity(db,approved.id).data.status,'questionnaire');
  assert.equal(entity(db,project.id).data.date,'');
  assert(tasks(db,owner,project).every(row=>!row.data.dueDate));
  assert.throws(()=>snapshot(db,user,project.id),e=>e.status===403);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,entities,entity,insert,uid} from '../server/db.mjs';
import {bootstrap,execute,snapshot} from '../server/service.mjs';
import {grant,createSession} from '../server/auth.mjs';
import {registerTestUser} from './fixtures/account.mjs';
import {makeCleanDatabase} from '../server/clean-reset.mjs';
import {DEFAULT_TASK_BLUEPRINTS} from '../src/task-blueprints.js';
import {questionnaireQuestions} from '../src/questionnaire.js';

function fixture(){
  const db=openDatabase(':memory:'),admin=bootstrap(db,{slug:'tie',agencyName:'Агентство',name:'Администратор',email:'admin@example.test',password:'reset-password'}).user;
  const add=name=>registerTestUser(db,{slug:'tie',name,email:`${uid()}@example.test`,password:'reset-password'}).user;
  const angelina=add('Ангелина'),alexandra=add('Александра'),discarded=add('Удаляемый');
  const role=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='organizer'").get(admin.agency_id);
  grant(db,angelina,role.id);grant(db,alexandra,role.id);
  const run=(op,body={})=>execute(db,admin,{id:uid(),op,...body});
  return {db,admin,angelina,alexandra,discarded,run,options:{agencyId:admin.agency_id,keepUserIds:[admin.id,angelina.id,alexandra.id]}};
}

test('a physical clean database keeps three credentials and definitions, empties every work/history table and leaves its source intact',()=>{
  const {db,admin,angelina,alexandra,discarded,run,options}=fixture();
  const wedding=run('project.create',{data:{name:'PRIVATE-WEDDING',date:'2027-06-12'}});
  const table=entities(db,admin.agency_id,wedding.id,'table').find(t=>t.data.key==='guests');
  run('entity.create',{projectId:wedding.id,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'PRIVATE-GUEST'}});
  run('entity.create',{projectId:wedding.id,kind:'selection',data:{title:'PRIVATE-VENDOR',price:999001,selected:true}});
  run('coupleBudget.cell',{projectId:wedding.id,row:9,field:'actual',value:999001});
  run('meeting.save',{projectId:wedding.id,data:{title:'PRIVATE-MEETING',startAt:'2027-06-01T07:00Z',endAt:'2027-06-01T08:00Z',timeZone:'Europe/Moscow',assignedUserIds:[admin.id]}});
  const file=insert(db,admin,'file',{name:'PRIVATE-FILE',size:1,mime:'text/plain'},wedding.id);db.prepare('INSERT INTO blobs VALUES(?,?)').run(file.id,Buffer.from('PRIVATE-BLOB'));
  db.prepare('INSERT INTO published_assets(id,agency_id,content,mime,width,height,created_at) VALUES(?,?,?,?,1,1,?)').run(uid(),admin.agency_id,Buffer.from('PRIVATE-PHOTO'),'image/png',new Date().toISOString());
  createSession(db,admin);createSession(db,angelina);createSession(db,discarded);
  const sourceCounts=Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t=>[t.name,db.prepare(`SELECT count(*) AS n FROM "${t.name}"`).get().n]));
  const {db:clean,report}=makeCleanDatabase(db,':memory:',options);
  assert.equal(report.counts.users,3);assert.equal(report.counts.entities,17);assert.equal(report.counts.sessions,0);assert.equal(report.counts.audit,0);assert.equal(report.counts.commands,0);assert.equal(report.counts.published_assets,0);assert.equal(report.counts.blobs,0);
  assert.equal(clean.prepare('SELECT id FROM users WHERE id=?').get(discarded.id),undefined);
  for(const user of [admin,angelina,alexandra]){const saved=clean.prepare('SELECT * FROM users WHERE id=?').get(user.id),original=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);assert.equal(saved.password,original.password);assert.equal(saved.email,original.email);assert.equal(saved.phone,original.phone);assert.deepEqual(snapshot(clean,saved).projects,[])}
  assert.equal(report.questionnaireQuestions,questionnaireQuestions.length);assert.equal(report.questionnaireQuestions,33);
  assert(entities(clean,admin.agency_id,null,'template').every(t=>t.data.taskBlueprints.every(task=>task.dueMode==='none'&&task.offsetDays===0)));
  assert(entities(clean,admin.agency_id,null).every(row=>!JSON.stringify(row.data).includes('PRIVATE-')));
  assert.deepEqual(JSON.parse(clean.prepare('SELECT settings FROM agencies').get().settings),{tagline:'',description:'',contact:'',services:[],portfolio:[]});
  assert.deepEqual(Object.fromEntries(Object.keys(sourceCounts).map(t=>[t,db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n])),sourceCounts);
  const savedTemplate=entities(clean,admin.agency_id,null,'template')[0];
  const legacy=execute(clean,admin,{id:uid(),op:'entity.edit',entityId:savedTemplate.id,version:savedTemplate.version,data:{taskBlueprints:[{key:'old',title:'Старый срок',phaseKey:'start',dueMode:'relative',offsetDays:-90}]}});
  for(const date of ['2027-07-01','']){
    const project=execute(clean,admin,{id:uid(),op:'project.create',templateId:legacy.id,data:{name:'Новая свадьба',date}}),tasks=entities(clean,admin.agency_id,project.id,'task');
    assert(tasks.every(task=>task.data.dueMode==='none'&&task.data.dueDate===''&&task.data.offsetDays===null&&task.data.startDate===''&&task.data.endDate===''));
    assert.equal(tasks.length,1);
  }
  clean.close();db.close();
});

test('cleanup refuses an incomplete or invalid preserve list before touching any record',()=>{
  const {db,admin,angelina,options}=fixture(),before=db.prepare('SELECT count(*) AS n FROM users').get().n;
  for(const ids of [[admin.id,angelina.id],[admin.id,angelina.id,angelina.id],[admin.id,angelina.id,uid()]])assert.throws(()=>makeCleanDatabase(db,':memory:',{...options,keepUserIds:ids}),e=>e.status===400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,before);db.close();
  assert(DEFAULT_TASK_BLUEPRINTS.every(task=>task.dueMode==='none'&&task.offsetDays===0));
});

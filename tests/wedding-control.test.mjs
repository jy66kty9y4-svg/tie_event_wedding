import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,entity,entities,insert,change,audit,uid} from '../server/db.mjs';
import {bootstrap,execute,snapshot} from '../server/service.mjs';
import {grant} from '../server/auth.mjs';
import {registerTestUser} from './fixtures/account.mjs';
import {WEDDING_STAGES,weddingProgress,weddingStage} from '../src/wedding-control.js';

function fixture(t){
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const admin=bootstrap(db,{slug:'control',agencyName:'Тест',name:'Администратор',email:'admin@example.test',password:'test-password'}).user;
  const run=(user,op,body={})=>execute(db,user,{id:uid(),op,...body});
  const project=run(admin,'project.create',{data:{name:'Тестовая свадьба',date:''}});
  const member=role=>{const user=registerTestUser(db,{slug:'control',name:role,email:`${role}@example.test`,password:'test-password'}).user;grant(db,user,db.prepare('SELECT id FROM roles WHERE key=?').get(role).id,project.id);return user;};
  return {db,admin,run,project,organizer:member('organizer'),couple:member('couple'),contractor:member('contractor')};
}
const stage=(id='venue',status='done',comment='Выбрана площадка')=>({id,status,comment,notRequired:false});

test('active wedding stages have stable unique IDs; progress excludes optional and retired stages',()=>{
  assert.equal(WEDDING_STAGES.length,18);assert.equal(new Set(WEDDING_STAGES.map(s=>s.id)).size,18);
  for(const id of ['guests','seating','timing','budget','tasks'])assert(!WEDDING_STAGES.some(s=>s.id===id));
  for(const id of ['brief','questionnaire','sound','light','stylist','effects','band','transfer','alcohol','menu','registry'])assert(WEDDING_STAGES.some(s=>s.id===id));
  assert.deepEqual(weddingProgress({}),{done:0,total:18,problems:0,percent:0});
  const control={stages:Object.fromEntries(WEDDING_STAGES.map(s=>[s.id,{status:'done'}]))};
  assert.equal(weddingProgress(control).percent,100);
  control.stages.venue={status:'problem'};control.stages.band={status:'open',notRequired:true};
  assert.deepEqual(weddingProgress(control),{done:16,total:17,problems:1,percent:94});
  control.stages.guests={status:'problem'};control.stages.tasks={status:'done'};
  assert.deepEqual(weddingProgress(control),{done:16,total:17,problems:1,percent:94});
  for(const s of WEDDING_STAGES)control.stages[s.id]={notRequired:true,status:'open'};
  assert.deepEqual(weddingProgress(control),{done:0,total:0,problems:0,percent:0});
  assert.equal(weddingStage({},'venue').comment,'');
});

test('organizer marks one stage atomically with comment, history and no changes to finances or other rows',t=>{
  const f=fixture(t),before=entities(f.db,f.admin.agency_id,f.project.id).map(r=>JSON.stringify(r));
  let saved=f.run(f.organizer,'project.control.save',{projectId:f.project.id,version:f.project.version,stage:stage()});
  assert.equal(saved.canManageWeddingControl,true);assert.equal(saved.data.weddingControl.stages.venue.updatedBy,f.organizer.id);
  assert.equal(saved.data.weddingControl.stages.venue.status,'done');assert.equal(saved.data.weddingControl.stages.venue.comment,'Выбрана площадка');
  saved=f.run(f.organizer,'project.control.save',{projectId:f.project.id,version:saved.version,stage:stage('host','problem','Нужно найти замену')});
  assert.equal(saved.data.weddingControl.stages.venue.status,'done');assert.equal(weddingProgress(saved.data.weddingControl).problems,1);
  assert.deepEqual(entities(f.db,f.admin.agency_id,f.project.id).map(r=>JSON.stringify(r)),before);
  assert(f.db.prepare("SELECT id FROM audit WHERE entity_id=? AND action='weddingControl'").get(f.project.id));
  saved=f.run(f.organizer,'entity.edit',{projectId:f.project.id,entityId:f.project.id,version:saved.version,data:{notes:'Общая заметка'}});
  assert.equal(saved.data.weddingControl.stages.host.comment,'Нужно найти замену');
});

test('comments, main document and notes persist independently; irrelevant services do not count as problems',t=>{
  const f=fixture(t),legacy=change(f.db,f.admin,entity(f.db,f.project.id),{...f.project.data,weddingControl:{stages:{guests:{status:'problem',comment:'Сохранённый ранее комментарий'}}}});
  let saved=f.run(f.admin,'project.control.save',{projectId:f.project.id,version:legacy.version,stage:{...stage('band','problem','Без кавер-группы'),notRequired:true}});
  assert.equal(saved.data.weddingControl.stages.band.status,'open');
  saved=f.run(f.admin,'project.control.save',{projectId:f.project.id,version:saved.version,info:{documentUrl:'https://example.test/wedding',notes:'Внутренние заметки'}});
  assert.equal(saved.data.weddingControl.stages.band.comment,'Без кавер-группы');
  const read=snapshot(f.db,f.organizer).projects.find(p=>p.id===f.project.id);
  assert.equal(read.data.weddingControl.documentUrl,'https://example.test/wedding');assert.equal(read.data.weddingControl.notes,'Внутренние заметки');
  assert.equal(weddingProgress(read.data.weddingControl).total,17);
  assert.equal(weddingProgress(read.data.weddingControl).problems,0);
  assert.equal(read.data.weddingControl.stages.guests.comment,'Сохранённый ранее комментарий');
});

test('stale commands cannot overwrite another organizer; replay is idempotent and content-bound',t=>{
  const f=fixture(t),cmd={id:uid(),op:'project.control.save',projectId:f.project.id,version:f.project.version,stage:stage()};
  const saved=execute(f.db,f.admin,cmd),replayed=execute(f.db,f.admin,cmd);
  assert.equal(replayed.version,saved.version);
  assert.throws(()=>execute(f.db,f.admin,{...cmd,stage:stage('host')}),e=>e.status===409);
  assert.throws(()=>f.run(f.admin,'project.control.save',{projectId:f.project.id,version:f.project.version,stage:stage('host')}),e=>e.status===409);
  assert.equal(entity(f.db,f.project.id).data.weddingControl.stages.host,undefined);
});

test('couples and contractors cannot read or edit organizer stages, even through history and generic mutations',t=>{
  const f=fixture(t),saved=f.run(f.admin,'project.control.save',{projectId:f.project.id,version:f.project.version,stage:stage('venue','done','Внутренняя комиссия 10%'),info:{documentUrl:'https://example.test/private',notes:'Секрет организатора'}});
  audit(f.db,f.admin,{...saved,project_id:f.project.id},f.project,'project-scoped-history');
  // Give both roles history access to verify redaction independently of the usual hidden history UI.
  for(const key of ['couple','contractor']){const role=f.db.prepare('SELECT * FROM roles WHERE key=?').get(key);f.db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(JSON.stringify([...new Set([...JSON.parse(role.permissions),'history','finance'])]),role.id);}
  for(const user of [f.couple,f.contractor]){
    for(const state of [snapshot(f.db,user),snapshot(f.db,user,f.project.id)]){
      assert(!JSON.stringify(state).includes('Внутренняя комиссия'));assert(!JSON.stringify(state).includes('Секрет организатора'));
      const project=state.project||state.projects[0];assert.equal(project.canManageWeddingControl,false);assert.equal(project.data.weddingControl,undefined);
    }
    assert.throws(()=>f.run(user,'project.control.save',{projectId:f.project.id,version:saved.version,stage:stage()}),e=>e.status===403);
  }
  assert.throws(()=>f.run(f.admin,'entity.edit',{projectId:f.project.id,entityId:f.project.id,version:saved.version,data:{weddingControl:{}}}),e=>e.status===409);
  assert.throws(()=>f.run(f.admin,'entity.create',{projectId:f.project.id,kind:'project',data:{...f.project.data,weddingControl:{}}}),e=>e.status===409);
});

test('organizer field grants and read-only access apply to nested stages as a single private field',t=>{
  const f=fixture(t);f.run(f.admin,'project.control.save',{projectId:f.project.id,version:f.project.version,stage:stage()});
  f.db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run(JSON.stringify({fields:['weddingControl']}),f.organizer.id);
  assert.throws(()=>f.run(f.organizer,'project.control.save',{projectId:f.project.id,version:f.project.version,stage:stage('host')}),e=>e.status===409&&e.details.current.data.limit===undefined&&e.details.current.data.notes===undefined&&e.details.current.data.weddingControl.stages.venue.status==='done');
  f.db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run(JSON.stringify({fields:['name','notes']}),f.organizer.id);
  assert.equal(snapshot(f.db,f.organizer).projects[0].data.weddingControl,undefined);
  assert.throws(()=>f.run(f.organizer,'project.control.save',{projectId:f.project.id,version:entity(f.db,f.project.id).version,stage:stage('host')}),e=>e.status===403);
  const role=f.db.prepare("SELECT * FROM roles WHERE key='organizer'").get();f.db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run('{}',f.organizer.id);f.db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(JSON.stringify(JSON.parse(role.permissions).filter(p=>p!=='edit')),role.id);
  assert.equal(snapshot(f.db,f.organizer).projects[0].data.weddingControl.stages.venue.status,'done');assert.equal(snapshot(f.db,f.organizer).projects[0].canManageWeddingControl,false);
  assert.throws(()=>f.run(f.organizer,'project.control.save',{projectId:f.project.id,version:entity(f.db,f.project.id).version,stage:stage('host')}),e=>e.status===403);
});

test('invalid statuses, empty problems, oversized notes, unsafe links and foreign weddings roll back',t=>{
  const f=fixture(t),original=JSON.stringify(entity(f.db,f.project.id));
  const bodies=[{stage:stage('venue','yellow')},{stage:stage('__proto__')},{stage:stage('venue','problem',' ')},{stage:{...stage(),notRequired:'yes'}},{stage:stage('venue','done','x'.repeat(8001))},{info:{documentUrl:'javascript:alert(1)',notes:''}},{info:{documentUrl:'https://user:password@example.test',notes:''}},{info:{documentUrl:'https://',notes:''}},{info:{documentUrl:'',notes:'x'.repeat(8001)}}];
  bodies.push(...['guests','seating','timing','budget','tasks'].map(id=>({stage:stage(id)})));
  for(const body of bodies){assert.throws(()=>f.run(f.admin,'project.control.save',{projectId:f.project.id,version:f.project.version,...body}),e=>e.status===400);assert.equal(JSON.stringify(entity(f.db,f.project.id)),original);}
  const agency=uid();f.db.prepare('INSERT INTO agencies(id,slug,name) VALUES(?,?,?)').run(agency,'foreign','Другое агентство');
  const other=insert(f.db,{...f.admin,agency_id:agency},'project',{name:'Чужая свадьба'});
  assert.throws(()=>f.run(f.admin,'project.control.save',{projectId:other.id,version:other.version,stage:stage()}),e=>e.status===404);
});

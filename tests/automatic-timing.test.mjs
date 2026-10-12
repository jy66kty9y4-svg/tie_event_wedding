import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,entities,entity,insert,change,uid} from '../server/db.mjs';
import {bootstrap,execute,snapshot} from '../server/service.mjs';
import {grant} from '../server/auth.mjs';
import {calendar,conflicts} from '../server/v2/calendar/index.mjs';
import {readiness} from '../server/v2/calendar/readiness.mjs';
import {previewReschedule} from '../server/v2/workflow/index.mjs';
import {registerTestUser} from './fixtures/account.mjs';
import {timingFields,withTimingStaff,TIMING_STAFF_COLUMN} from '../src/timing-fields.js';

function fixture(t,date='2027-06-12'){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const admin=bootstrap(db,{slug:'timing',agencyName:'Тест',name:'Организатор',email:'owner@example.test',password:'test-password'}).user;
 const run=(user,op,body={})=>execute(db,user,{id:uid(),op,...body}),project=run(admin,'project.create',{data:{name:'Свадьба',date}});
 const member=key=>{const user=registerTestUser(db,{slug:'timing',name:key,email:`${key}@example.test`,password:'test-password'}).user;grant(db,user,db.prepare('SELECT id FROM roles WHERE key=?').get(key).id,project.id);return user};
 const table=entities(db,admin.agency_id,project.id,'table').find(r=>r.data.key==='timing');
 return {db,admin,project,run,table,couple:member('couple'),organizer:member('organizer'),contractor:member('contractor')};
}
const events=(f,user=f.admin,assignee)=>calendar(f.db,user,{projectId:f.project.id,from:'2027-06-01',to:'2027-06-30',type:'timing',assignee}).items;

test('standard timing projects immediately and follows cell changes, renamed labels and wedding rescheduling',t=>{
 const f=fixture(t),{db,admin,project,run,table}=f;
 assert.equal(table.data.semanticMap,undefined);assert.equal(timingFields(table).assignedUserIds,TIMING_STAFF_COLUMN.id);
 let row=run(admin,'entity.create',{projectId:project.id,kind:'row',parentId:table.id,schemaVersion:table.version,data:{title:'Церемония',time:'12:00',end:'13:00',audience:'Пара'}});
 assert.equal(events(f)[0].start,'2027-06-12T09:00:00.000Z');assert.equal(events(f)[0].end,'2027-06-12T10:00:00.000Z');
 row=run(admin,'entity.edit',{projectId:project.id,entityId:row.id,version:row.version,schemaVersion:table.version,data:{time:'14:00',end:'15:00'}});
 const renamed=run(admin,'entity.edit',{projectId:project.id,entityId:table.id,version:table.version,data:{columns:table.data.columns.map(c=>({...c,name:'Другое название '+c.id}))}});
 assert.equal(events(f)[0].start,'2027-06-12T11:00:00.000Z');assert.equal(events(f).length,1);
 const preview=previewReschedule(db,admin,{projectId:project.id,newDate:'2027-06-20'});
 run(admin,'project.reschedule.apply',{projectId:project.id,newDate:'2027-06-20',projectVersion:preview.projectVersion,previewDigest:preview.digest});
 assert.equal(events(f)[0].start,'2027-06-20T11:00:00.000Z');assert.equal(entity(db,row.id).data.time,'14:00');assert.equal(entity(db,renamed.id).data.semanticMap,undefined);
});

test('legacy standard timing gains only a staff field, once, with versions and organizer permissions',t=>{
 const f=fixture(t),{db,admin,project,run,couple,organizer}=f;
 const old=change(db,admin,f.table,{...f.table.data,columns:f.table.data.columns.filter(c=>c.id!==TIMING_STAFF_COLUMN.id)});
 const row=insert(db,admin,'row',{title:'Фотосессия',time:'10:00',end:'11:00',responsible:'Анна из переписки',people:'Пара и гости'},project.id,old.id),before=JSON.stringify(entity(db,row.id));
 assert.equal(events(f).length,1);
 assert.throws(()=>run(couple,'timing.ensure',{projectId:project.id,entityId:old.id,schemaVersion:old.version}),e=>e.status===403);
 assert.throws(()=>run(organizer,'timing.ensure',{projectId:project.id,entityId:old.id,schemaVersion:old.version-1}),e=>e.status===409);
 const saved=run(organizer,'timing.ensure',{projectId:project.id,entityId:old.id,schemaVersion:old.version});
 assert.equal(saved.version,old.version+1);assert.equal(saved.data.columns.length,old.data.columns.length+1);assert.equal(JSON.stringify(entity(db,row.id)),before);
 const again=run(organizer,'timing.ensure',{projectId:project.id,entityId:old.id,schemaVersion:old.version});assert.equal(again.version,saved.version);
 assert.equal(events(f)[0].assignedUserIds.length,0);
});

test('selected staff automatically filter the calendar and detect overlaps; free text does not assign anyone',t=>{
 const f=fixture(t),{db,admin,organizer,project,table,run}=f,staff=timingFields(table).assignedUserIds;
 let row=run(admin,'entity.create',{projectId:project.id,kind:'row',parentId:table.id,schemaVersion:table.version,data:{title:'Работа организатора',time:'12:00',end:'13:00',responsible:organizer.name}});
 assert.equal(events(f,admin,organizer.id).length,0);
 row=run(admin,'entity.edit',{projectId:project.id,entityId:row.id,version:row.version,schemaVersion:table.version,data:{[staff]:[organizer.id]}});
 assert.equal(events(f,admin,organizer.id).length,1);
 const overlap=conflicts(db,admin,{assignedUserIds:[organizer.id],startAt:'2027-06-12T09:30:00.000Z',endAt:'2027-06-12T10:30:00.000Z'});
 assert.equal(overlap.length,1);assert.equal(overlap[0].sourceId,row.id);assert(overlap[0].actionUrl.includes('/day/pair?row='));
 assert.equal(conflicts(db,admin,{assignedUserIds:[organizer.id],startAt:'2027-06-12T10:00:00.000Z',endAt:'2027-06-12T11:00:00.000Z'}).length,0);
 run(admin,'entity.edit',{projectId:project.id,entityId:row.id,version:row.version,schemaVersion:table.version,data:{[staff]:[]}});assert.equal(events(f,admin,organizer.id).length,0);
});

test('automatic mapping respects custom mappings, wrong types and reserved field collisions',t=>{
 const basic={key:'timing',columns:[{id:'title',type:'text'},{id:'time',type:'time'},{id:'end',type:'time'}]},custom={...basic,semanticMap:{title:'custom_title',startTime:'custom_time'}};
 assert.deepEqual(timingFields({data:custom}),custom.semanticMap);assert.equal(withTimingStaff(custom),custom);
 assert.deepEqual(timingFields({data:{...basic,columns:basic.columns.map(c=>c.id==='time'?{...c,type:'text'}:c)}}),{});
 const collision={...basic,columns:[...basic.columns,{...TIMING_STAFF_COLUMN,type:'text'}]},expanded=withTimingStaff(collision);
 assert.equal(expanded.columns.find(c=>c.id===TIMING_STAFF_COLUMN.id).type,'text');assert.equal(timingFields({data:expanded}).assignedUserIds,TIMING_STAFF_COLUMN.id+'_2');assert.equal(withTimingStaff(expanded),expanded);
});

test('unconfigured standard timing stays private and readiness checks visible rows without requiring a setup',t=>{
 const f=fixture(t),{db,admin,project,table,couple,contractor,run}=f;
 insert(db,admin,'row',{title:'Церемония',time:'12:00',end:'13:00',audience:'Пара'},project.id,table.id);
 const team=insert(db,admin,'row',{title:'Секрет команды',time:'bad',audience:'Команда'},project.id,table.id);
 run(admin,'project.readinessSettings',{projectId:project.id,version:project.version,data:{readinessPolicy:{timing:{required:true}}}});
 for(const user of [couple,contractor]){assert.equal(events(f,user).length,1);assert(!snapshot(db,user,project.id).entities.some(r=>r.id===team.id));assert.equal(readiness(db,user,project.id).checks.find(c=>c.ruleKey==='timing').state,'pass');}
 assert.equal(readiness(db,admin,project.id).checks.find(c=>c.ruleKey==='timing').state,'warning');
});

test('an open wedding emits no invented dates and maps existing standard offset columns',t=>{
 const f=fixture(t,''),{db,admin,project,table,run}=f;
 const mapped=change(db,admin,table,{...table.data,columns:[...table.data.columns,{id:'timing_day_offset',name:'Накануне',type:'number'},{id:'timing_end_day_offset',name:'Через день',type:'number'}]});
 insert(db,admin,'row',{title:'Монтаж',time:'22:00',end:'02:00',timing_day_offset:-1,timing_end_day_offset:1},project.id,mapped.id);assert.equal(events(f).length,0);
 const preview=previewReschedule(db,admin,{projectId:project.id,newDate:'2027-06-12'});run(admin,'project.reschedule.apply',{projectId:project.id,newDate:'2027-06-12',projectVersion:preview.projectVersion,previewDigest:preview.digest});
 assert.equal(events(f)[0].start,'2027-06-11T19:00:00.000Z');assert.equal(events(f)[0].end,'2027-06-11T23:00:00.000Z');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,entities,entity,insert,uid} from '../server/db.mjs';
import {bootstrap,execute as serviceExecute,register} from '../server/service.mjs';
import {grant} from '../server/auth.mjs';
import {executeModule} from '../server/v2/common.mjs';
import {operations,validateTimingSchemaMutation} from '../server/v2/timing.mjs';

const fixture=()=>{const db=openDatabase(':memory:'),admin=bootstrap(db,{slug:'timing',agencyName:'Тест',email:'owner@example.test',name:'Владелец',password:'strong-password'}).user,project=serviceExecute(db,admin,{id:uid(),op:'project.create',data:{name:'День свадьбы',date:'2027-06-12'}}),member=register(db,{slug:'timing',email:'member@example.test',name:'Координатор',password:'strong-password'}).user;grant(db,member,db.prepare("SELECT id FROM roles WHERE key='couple'").get().id,project.id);const table=entities(db,admin.agency_id,project.id,'table').find(row=>row.data.key==='timing');return {db,admin,project,member,table};};
const run=(db,user,body)=>executeModule(db,user,{id:uid(),op:'timing.configure',...body},operations);
const rejects=(fn,status=400)=>assert.throws(fn,error=>error.status===status);

test('timing configure maps existing columns and atomically creates typed optional fields without touching legacy text',()=>{
 const {db,admin,project,member,table}=fixture(),legacy=insert(db,admin,'row',{time:'10:00',end:'11:00',title:'Церемония',responsible:'Старший координатор'},project.id,table.id);
 const configured=run(db,admin,{projectId:project.id,entityId:table.id,schemaVersion:table.version,data:{semanticMap:{title:'title',startTime:'time',endTime:'end'},createMissing:['dayOffset','endDayOffset','required','assignedUserIds']}});
 assert.equal(configured.version,table.version+1);assert.deepEqual(Object.keys(configured.data.semanticMap).sort(),['assignedUserIds','dayOffset','endDayOffset','endTime','required','startTime','title'].sort());
 const assigned=configured.data.columns.find(column=>column.id===configured.data.semanticMap.assignedUserIds);assert.equal(assigned.type,'users');assert.equal(entity(db,legacy.id).data.responsible,'Старший координатор');assert.equal(entity(db,legacy.id).data[assigned.id],undefined);
 const saved=serviceExecute(db,admin,{id:uid(),op:'entity.edit',projectId:project.id,entityId:legacy.id,version:legacy.version,schemaVersion:configured.version,data:{[assigned.id]:[member.id]}});assert.deepEqual(saved.data[assigned.id],[member.id]);assert.equal(saved.data.responsible,'Старший координатор');
 const outsider=register(db,{slug:'timing',email:'outsider@example.test',name:'Без проекта',password:'strong-password'}).user;rejects(()=>serviceExecute(db,admin,{id:uid(),op:'entity.edit',projectId:project.id,entityId:saved.id,version:saved.version,schemaVersion:configured.version,data:{[assigned.id]:[outsider.id]}}),409);
});

test('timing mapping requires explicit compatible rebind and schema version',()=>{
 const {db,admin,project,table}=fixture();let configured=run(db,admin,{projectId:project.id,entityId:table.id,schemaVersion:table.version,data:{semanticMap:{title:'title',startTime:'time',endTime:'end'},createMissing:['required','assignedUserIds']}});
 assert.equal(validateTimingSchemaMutation(table,{...table,data:{...table.data,semanticMap:{title:'time',startTime:'title'}}}).ok,false);
 configured=serviceExecute(db,admin,{id:uid(),op:'entity.edit',projectId:project.id,entityId:configured.id,version:configured.version,data:{...configured.data,columns:[...configured.data.columns,{id:'alternate_start',name:'Другое начало',type:'time'}]}});
 const rebind={...configured.data.semanticMap,startTime:'alternate_start'};rejects(()=>run(db,admin,{projectId:project.id,entityId:configured.id,schemaVersion:configured.version,data:{semanticMap:rebind,createMissing:[]}}),409);
 const rebound=run(db,admin,{projectId:project.id,entityId:configured.id,schemaVersion:configured.version,data:{semanticMap:rebind,createMissing:[]},confirm:true});assert.equal(rebound.data.semanticMap.startTime,'alternate_start');
 rejects(()=>run(db,admin,{projectId:project.id,entityId:rebound.id,schemaVersion:configured.version,data:{semanticMap:rebind,createMissing:[]},confirm:true}),409);
 rejects(()=>run(db,admin,{projectId:project.id,entityId:rebound.id,schemaVersion:rebound.version,data:{semanticMap:{...rebind,title:'alternate_start'},createMissing:[]},confirm:true}),409);
 const deleted={...rebound,data:{...rebound.data,columns:rebound.data.columns.filter(column=>column.id!=='alternate_start')}};const guard=validateTimingSchemaMutation(rebound,deleted);assert.equal(guard.ok,false);assert(['timingMappingType','timingMappingRebindRequired'].includes(guard.code));
});

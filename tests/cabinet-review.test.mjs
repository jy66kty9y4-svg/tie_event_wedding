import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,entities,entity,insert,uid} from '../server/db.mjs';
import {bootstrap,execute,snapshot,upload,download} from '../server/service.mjs';
import {grant,can} from '../server/auth.mjs';
import {calendar} from '../server/v2/calendar/index.mjs';
import {GUEST_ACTIONS_COLUMN} from '../src/sheet.js';
import {registerTestUser} from './fixtures/account.mjs';

function fixture(t){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const admin=bootstrap(db,{slug:'review',agencyName:'Тест',name:'Организатор',email:'admin@example.test',password:'review-test-password'}).user;
 const run=(user,op,body={})=>execute(db,user,{id:uid(),op,...body});
 const project=run(admin,'project.create',{data:{name:'Тестовая свадьба',date:'2027-06-12'}});
 const member=key=>{const user=registerTestUser(db,{slug:'review',name:key,email:`${key}@example.test`,password:'review-test-password'}).user;grant(db,user,db.prepare('SELECT id FROM roles WHERE key=?').get(key).id,project.id);return user};
 return {db,admin,project,run,couple:member('couple'),contractor:member('contractor'),organizer:member('organizer')};
}

test('team timing stays private in snapshots, offline data, calendar and direct row commands',t=>{
 const {db,admin,project,run,couple,contractor,organizer}=fixture(t),table=entities(db,admin.agency_id,project.id,'table').find(r=>r.data.key==='timing');
 const common=insert(db,admin,'row',{title:'Общее',time:'10:00',audience:'Общее'},project.id,table.id),pair=insert(db,admin,'row',{title:'Для пары',time:'11:00',audience:'Пара'},project.id,table.id),team=insert(db,admin,'row',{title:'Только команда',time:'09:00',audience:'Команда'},project.id,table.id);
 const mapped=run(admin,'timing.configure',{projectId:project.id,entityId:table.id,schemaVersion:table.version,data:{semanticMap:{title:'title',startTime:'time'}}});
 const coupleRole=db.prepare("SELECT * FROM roles WHERE agency_id=? AND key='couple'").get(admin.agency_id);
 db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(JSON.stringify([...JSON.parse(coupleRole.permissions),'history']),coupleRole.id);
 for(const user of [couple,contractor]){
  for(const offline of [false,true]){const rows=snapshot(db,user,project.id,offline).entities;assert(rows.some(r=>r.id===common.id));assert(rows.some(r=>r.id===pair.id));assert(!rows.some(r=>r.id===team.id));}
  const events=calendar(db,user,{projectId:project.id,from:'2027-06-12',to:'2027-06-13'}).items;
  assert(!events.some(e=>e.sourceId===team.id));assert(events.filter(e=>[common.id,pair.id].includes(e.sourceId)).every(e=>e.actionUrl.includes('/day/pair')));
  assert.equal(can(db,user,'read',project.id,table.id,team.id),false);
  assert.throws(()=>run(user,'entity.edit',{projectId:project.id,entityId:team.id,version:team.version,schemaVersion:mapped.version,data:{title:'Попытка'}}),e=>e.status===403);
 }
 assert(snapshot(db,organizer,project.id).entities.some(r=>r.id===team.id));
 assert(!snapshot(db,couple,project.id).history.some(item=>item.entity_id===team.id));
 assert.throws(()=>run(couple,'entity.edit',{projectId:project.id,entityId:mapped.id,version:mapped.version,data:{key:'ordinary_table'}}),e=>e.status===403);
 assert.throws(()=>run(couple,'entity.create',{projectId:project.id,kind:'row',parentId:table.id,schemaVersion:mapped.version,data:{title:'Команда',time:'12:00',audience:'Команда'}}),e=>e.status===403);
 assert.throws(()=>run(couple,'entity.edit',{projectId:project.id,entityId:pair.id,version:pair.version,schemaVersion:mapped.version,data:{audience:'Команда'}}),e=>e.status===403);
 assert.equal(run(couple,'entity.edit',{projectId:project.id,entityId:pair.id,version:pair.version,schemaVersion:mapped.version,data:{title:'Обновлено'}}).data.title,'Обновлено');
 run(admin,'entity.edit',{projectId:project.id,entityId:team.id,version:team.version,schemaVersion:mapped.version,data:{audience:'Общее'}});
 assert(!snapshot(db,couple,project.id).history.some(item=>item.entity_id===team.id));
});

test('guest actions width is persisted, retained by schema edits and scoped to the guest table',t=>{
 const {db,admin,project,run,couple}=fixture(t),tables=entities(db,admin.agency_id,project.id,'table'),guest=tables.find(r=>r.data.key==='guests'),timing=tables.find(r=>r.data.key==='timing');
 const resized=run(couple,'sheet.layout',{projectId:project.id,entityId:guest.id,axis:'columnWidths',key:GUEST_ACTIONS_COLUMN,value:240});
 assert.equal(resized.data.sheetLayout.columnWidths[GUEST_ACTIONS_COLUMN],240);
 assert.equal(snapshot(db,couple,project.id).entities.find(r=>r.id===guest.id).data.sheetLayout.columnWidths[GUEST_ACTIONS_COLUMN],240);
 run(couple,'entity.edit',{projectId:project.id,entityId:guest.id,version:resized.version,data:{...resized.data,name:'Гости и ответы'}});
 assert.equal(entity(db,guest.id).data.sheetLayout.columnWidths[GUEST_ACTIONS_COLUMN],240);
 assert.throws(()=>run(couple,'sheet.layout',{projectId:project.id,entityId:timing.id,axis:'columnWidths',key:GUEST_ACTIONS_COLUMN,value:240}));
 assert.throws(()=>run(couple,'sheet.layout',{projectId:project.id,entityId:guest.id,axis:'columnWidths',key:GUEST_ACTIONS_COLUMN,value:801}));
});

test('a booking contract is a wedding document and cannot link a different wedding file',t=>{
 const {db,admin,project,run,couple}=fixture(t),selection=insert(db,admin,'selection',{name:'Фотограф',selected:true},project.id),bytes=Buffer.from('%PDF-1.4\nReview contract\n%%EOF');
 const file=upload(db,couple,project.id,{name:'Договор.pdf',mime:'application/pdf',documentStatus:'signed',content:bytes.toString('base64')});
 const saved=run(couple,'selection.booking',{projectId:project.id,entityId:selection.id,version:selection.version,required:true,status:'confirmed',fileId:file.id,note:''});
 assert.equal(saved.data.bookingEvidenceFileId,file.id);assert.equal(saved.data.bookingStatus,'confirmed');
 const document=snapshot(db,couple,project.id).entities.find(r=>r.id===file.id);assert.equal(document.data.documentStatus,'signed');assert.deepEqual(Buffer.from(download(db,couple,file.id).content),bytes);
 const other=run(admin,'project.create',{data:{name:'Другая свадьба',date:'2027-08-20'}}),foreign=upload(db,admin,other.id,{name:'Другой договор.pdf',content:bytes.toString('base64')});
 assert.throws(()=>run(couple,'selection.booking',{projectId:project.id,entityId:saved.id,version:saved.version,required:true,status:'confirmed',fileId:foreign.id,note:''}),e=>e.status===403||e.status===404);
 assert.equal(entity(db,saved.id).data.bookingEvidenceFileId,file.id);
});

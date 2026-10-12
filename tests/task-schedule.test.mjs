import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,insert,entity,uid} from '../server/db.mjs';
import {bootstrap,execute} from '../server/service.mjs';
import {grant} from '../server/auth.mjs';
import {listTasks,getTask,previewReschedule} from '../server/v2/workflow/index.mjs';
import {calendar,processOutbox} from '../server/v2/calendar/index.mjs';
import {beginGoogleCalendar,finishGoogleCalendar,syncExternalCalendar,queueExternalCalendarSyncForCommand} from '../server/v2/calendar/external.mjs';
const run=(db,user,op,body={})=>execute(db,user,{id:uid(),op,...body});
function fixture(t){const db=openDatabase(':memory:');t.after(()=>db.close());const user=bootstrap(db,{slug:'tie',agencyName:'Test',email:'owner@example.test',name:'Тестовый админ',password:'task-test-password'}).user;const project=insert(db,user,'project',{name:'Тестовая свадьба',date:'2027-06-12',timeZone:'Europe/Moscow',status:'preparation',leadOrganizerUserId:user.id});return{db,user,project};}
const create=(db,user,project,data)=>run(db,user,'task.create',{projectId:project.id,data});
const edit=(db,user,row,data)=>run(db,user,'task.edit',{projectId:row.project_id,entityId:row.id,version:row.version,data});

test('tasks default to no deadline and each schedule can be changed or removed without changing other task fields',t=>{
 const {db,user,project}=fixture(t);let row=create(db,user,project,{title:'Без срока',description:'Сохранить описание'});
 assert.equal(row.data.dueMode,'none');assert.equal(row.data.dueDate,'');assert.equal(row.data.offsetDays,null);
 row=edit(db,user,row,{dueMode:'fixed',fixedDate:'2027-05-01'});assert.equal(row.data.dueDate,'2027-05-01');
 row=edit(db,user,row,{dueMode:'range',startDate:'2027-05-03',endDate:'2027-05-06'});assert.equal(row.data.dueDate,'2027-05-06');assert.equal(row.data.fixedDate,'');
 row=edit(db,user,row,{dueMode:'relative',offsetDays:-30});assert.equal(row.data.dueDate,'2027-05-13');assert.equal(row.data.startDate,'');assert.equal(row.data.endDate,'');
 row=edit(db,user,row,{dueMode:'none',fixedDate:'2027-01-01',offsetDays:-30,startDate:'2027-01-02',endDate:'2027-01-04'});
 assert.equal(row.data.dueDate,'');assert.equal(row.data.fixedDate,'');assert.equal(row.data.startDate,'');assert.equal(row.data.endDate,'');assert.equal(row.data.offsetDays,null);assert.equal(row.data.description,'Сохранить описание');
 row=edit(db,user,row,{title:'Переименованная'});assert.equal(row.data.dueMode,'none');
 assert.equal(getTask(db,user,{projectId:project.id,id:row.id}).task.data.dueDate,'');
 const single=create(db,user,project,{title:'Один день',dueMode:'range',startDate:'2027-05-05',endDate:'2027-05-05'});assert.equal(single.data.dueDate,'2027-05-05');
 const legacy=insert(db,user,'task',{title:'Старая дата',status:'todo',dueDate:'2027-04-01'},project.id);assert.equal(edit(db,user,legacy,{title:'Старое название изменено'}).data.dueDate,'2027-04-01');
});

test('chosen dates and periods validate atomically; stale edits and restricted changes remain rejected',t=>{
 const {db,user,project}=fixture(t),row=create(db,user,project,{title:'Проверка срока'});
 for(const data of [{dueMode:'fixed',fixedDate:''},{dueMode:'range',startDate:'2027-01-10',endDate:'2027-01-09'},{dueMode:'range',startDate:'',endDate:'2027-01-09'},{dueMode:'range',startDate:'2027-02-30',endDate:'2027-03-03'}])assert.throws(()=>edit(db,user,row,data),e=>e.status===400);
 assert.equal(entity(db,row.id).version,row.version);
 const changed=edit(db,user,row,{dueMode:'fixed',fixedDate:'2027-04-01'});assert.throws(()=>edit(db,user,row,{dueMode:'none'}),e=>e.status===409);
 const readerId=uid();db.prepare('INSERT INTO users(id,agency_id,email,name,password) VALUES(?,?,?,?,?)').run(readerId,user.agency_id,'reader@example.test','Читатель','test-hash');const reader=db.prepare('SELECT * FROM users WHERE id=?').get(readerId);const role=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='contractor'").get(user.agency_id);grant(db,reader,role.id,project.id,{sections:['tasks'],fields:['title']});
 assert.throws(()=>edit(db,reader,changed,{dueMode:'none'}),e=>e.status===403);
});

test('undated tasks stay in the plan and focused agency list but not date filters or calendar; periods overlap query dates',t=>{
 const {db,user,project}=fixture(t),none=create(db,user,project,{title:'Без срока'}),range=create(db,user,project,{title:'Период',dueMode:'range',startDate:'2027-05-01',endDate:'2027-05-05'});
 assert(listTasks(db,user,{projectId:project.id}).items.some(row=>row.id===none.id));
 run(db,user,'task.setOrganizerFocus',{projectId:project.id,entityId:none.id,version:none.version,focused:true});assert(listTasks(db,user).items.some(row=>row.id===none.id));
 for(const q of [{from:'2027-05-03'},{to:'2027-05-03'},{from:'2027-05-03',to:'2027-05-03'}]){const rows=listTasks(db,user,{projectId:project.id,...q}).items;assert(rows.some(row=>row.id===range.id));assert(!rows.some(row=>row.id===none.id));}
 const events=calendar(db,user,{projectId:project.id,from:'2027-05-03',to:'2027-05-03'}).items;assert(!events.some(event=>event.sourceId===none.id));const event=events.find(event=>event.sourceId===range.id);assert.equal(event.start,'2027-05-01');assert.equal(event.end,'2027-05-05');assert.equal(event.dateRange,true);
});

test('wedding reschedule keeps no-deadline and concrete periods unchanged while moving relative tasks',t=>{
 const {db,user,project}=fixture(t),none=create(db,user,project,{title:'Без срока'}),range=create(db,user,project,{title:'Период',dueMode:'range',startDate:'2027-05-01',endDate:'2027-05-05'}),relative=create(db,user,project,{title:'Связано со свадьбой',dueMode:'relative',offsetDays:-5});
 const preview=previewReschedule(db,user,{projectId:project.id,newDate:'2027-07-12'});assert(preview.unchanged.some(row=>row.id===none.id&&row.reason==='undated_task'));assert(preview.unchanged.some(row=>row.id===range.id&&row.reason==='range_task'));assert(preview.affected.some(row=>row.id===relative.id));
 run(db,user,'project.reschedule.apply',{projectId:project.id,newDate:preview.newDate,newTimeZone:preview.newTimeZone,projectVersion:preview.projectVersion,previewDigest:preview.digest,sourceVersions:preview.affected.map(({id,version})=>({id,version}))});
 assert.equal(entity(db,none.id).version,none.version);assert.equal(entity(db,none.id).data.dueDate,'');assert.equal(entity(db,range.id).version,range.version);assert.equal(entity(db,relative.id).data.dueDate,'2027-07-07');
});

test('removing deadline cancels queued date reminders and creates no new overdue notifications',t=>{
 const {db,user,project}=fixture(t),row=create(db,user,project,{title:'Не просрочена без срока',assigneeUserId:user.id,dueMode:'fixed',fixedDate:'2027-01-02'});
 processOutbox(db,Date.parse('2027-01-01T00:00:00Z'));assert(db.prepare("SELECT count(*) n FROM notification_outbox WHERE source_id=? AND template_key='task.before'").get(row.id).n>0);
 edit(db,user,row,{dueMode:'none'});processOutbox(db,Date.parse('2027-01-05T12:00:00Z'));
 assert.equal(db.prepare("SELECT count(*) n FROM notification_outbox WHERE source_id=? AND template_key IN ('task.before','task.overdue') AND status<>'cancelled'").get(row.id).n,0);
});

test('Google range round trip uses exclusive end, and removing a deadline deletes the linked event',async t=>{
 const previous={...process.env};t.after(()=>{for(const key of ['TIE_CALENDAR_SECRET','TIE_PUBLIC_ORIGIN','GOOGLE_CALENDAR_CLIENT_ID','GOOGLE_CALENDAR_CLIENT_SECRET'])previous[key]===undefined?delete process.env[key]:process.env[key]=previous[key];});
 Object.assign(process.env,{TIE_CALENDAR_SECRET:'01234567890123456789012345678901',TIE_PUBLIC_ORIGIN:'http://localhost:4199',GOOGLE_CALENDAR_CLIENT_ID:'client-id',GOOGLE_CALENDAR_CLIENT_SECRET:'client-secret'});
 const {db,user,project}=fixture(t);let row=create(db,user,project,{title:'Внешний период',dueMode:'range',startDate:'2027-05-01',endDate:'2027-05-05'});create(db,user,project,{title:'Без срока'});
 const written=[],deleted=[];let remote=[];const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,options={})=>{const value=String(url),method=options.method||'GET';if(value.includes('oauth2.googleapis.com/token'))return json({access_token:'access',refresh_token:'refresh',expires_in:3600});if(value.endsWith('/calendars')&&method==='POST')return json({id:'fixture-calendar'});if(value.endsWith('/events/watch'))return json({id:'watch',resourceId:'resource',expiration:Date.now()+86400000});if(value.includes('/events')&&method==='GET')return json({items:remote,nextSyncToken:'fixture-token'});if(value.includes('/events')&&['POST','PUT'].includes(method)){const body=JSON.parse(options.body);written.push(body);return json({id:'fixture-event',etag:'etag',updated:'2026-10-01T00:00:00Z',...body});}if(method==='DELETE'){deleted.push(value);return new Response(null,{status:204});}throw new Error('Unexpected mock request');};
 const started=beginGoogleCalendar(db,user,project.id);await finishGoogleCalendar(db,new URL(started.url).searchParams.get('state'),'code',{fetchImpl});assert.equal(written.length,1);assert.equal(written[0].start.date,'2027-05-01');assert.equal(written[0].end.date,'2027-05-06');
 remote=[{id:'fixture-event',etag:'changed',updated:'2027-01-01T00:00:00Z',...written[0],start:{date:'2027-05-02'},end:{date:'2027-05-08'}}];await syncExternalCalendar(db,user,{projectId:project.id,provider:'google'},{fetchImpl});row=entity(db,row.id);assert.equal(row.data.dueMode,'range');assert.equal(row.data.startDate,'2027-05-02');assert.equal(row.data.endDate,'2027-05-07');
 remote=[];const command={id:uid(),op:'task.edit',projectId:project.id,entityId:row.id,version:row.version,data:{dueMode:'none'}};execute(db,user,command);await queueExternalCalendarSyncForCommand(db,user,command,{fetchImpl});assert.equal(deleted.length,1);assert.equal(db.prepare('SELECT count(*) n FROM calendar_event_links WHERE task_id=?').get(row.id).n,0);
});

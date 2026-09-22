import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, entity, entities, insert, change, transaction, uid } from '../server/db.mjs';
import { bootstrap, execute, register } from '../server/service.mjs';
import { grant } from '../server/auth.mjs';
import { executeModule, zonedInstant, addDays } from '../server/v2/common.mjs';
import { operations, calendar, previewMeeting, processOutbox, notifications, queueChanges, preferences, scheduleReminders } from '../server/v2/calendar/index.mjs';
import { readiness, dashboard, readinessOperations } from '../server/v2/calendar/readiness.mjs';
const fixture=()=>{const db=openDatabase(':memory:');const admin=bootstrap(db,{slug:'tie',agencyName:'Тест',email:'owner@example.test',name:'Владелец',password:'strong-password'}).user;const p=execute(db,admin,{id:uid(),op:'project.create',data:{name:'Тестовая свадьба',date:'2027-06-12'}});const user=register(db,{slug:'tie',email:'couple@example.test',name:'Участник',password:'strong-password'}).user;grant(db,user,db.prepare("SELECT id FROM roles WHERE key='couple'").get().id,p.id);return {db,admin,p,user};};
const run=(db,u,op,b={})=>executeModule(db,u,{id:uid(),op,...b},{...operations,...readinessOperations});
const rejects=(fn,status=400)=>assert.throws(fn,e=>e.status===status);
test('calendar wall-clock rules preserve calendar days and reject DST gaps and unresolved folds',()=>{
 assert.equal(addDays('2024-03-10',1),'2024-03-11');assert.equal(addDays('2024-02-28',1),'2024-02-29');
 rejects(()=>zonedInstant('2027-03-14','02:30','America/New_York'));
 rejects(()=>zonedInstant('2027-11-07','01:30','America/New_York'),409);
 assert.equal(zonedInstant('2027-11-07','01:30','America/New_York','earlier'),'2027-11-07T05:30:00.000Z');
 assert.equal(zonedInstant('2027-11-07','01:30','America/New_York','later'),'2027-11-07T06:30:00.000Z');
});
test('meetings require explicit overlap acknowledgement; endpoint adjacency, different zones, versions and source routes work',()=>{
 const {db,admin,p,user}=fixture();const base={title:'Встреча',startDate:'2027-06-01',startTime:'10:00',endDate:'2027-06-01',endTime:'11:00',timeZone:'Europe/Moscow',assignedUserIds:[user.id],participantUserIds:[]};
 const first=run(db,user,'meeting.save',{projectId:p.id,data:base});
 const adjacent=run(db,user,'meeting.save',{projectId:p.id,data:{...base,title:'Следующая',startTime:'11:00',endTime:'12:00'}});assert(adjacent.id);
 const overlapping={...base,title:'Пересечение',startTime:'10:30',endTime:'11:30'};rejects(()=>run(db,user,'meeting.save',{projectId:p.id,data:overlapping}),409);
 const withReason={...overlapping,conflictReason:'Согласовано участие по очереди'},preview=previewMeeting(db,user,{projectId:p.id,data:withReason});assert.equal(preview.conflicts.length,2);
 const third=run(db,user,'meeting.save',{projectId:p.id,data:withReason,conflictDigest:preview.digest});assert.equal(third.data.startAt,'2027-06-01T07:30:00.000Z');
 rejects(()=>run(db,user,'meeting.save',{projectId:p.id,entityId:first.id,version:99,data:{...base,title:'Правка'}}),409);
 const items=calendar(db,user,{from:'2027-06-01',to:'2027-06-30',projectId:p.id}).items;assert.equal(items.filter(x=>x.sourceKind==='meeting').length,3);assert(items.every(x=>x.sourceVersion&&x.actionUrl.startsWith('/app/')));assert.equal(items.find(x=>x.sourceKind==='project').actionUrl,`/app/projects/${p.id}/overview`);
 const zoned=run(db,user,'meeting.save',{projectId:p.id,data:{...base,title:'Нью-Йорк',startDate:'2027-06-02',endDate:'2027-06-02',timeZone:'America/New_York'}});const projected=calendar(db,user,{from:'2027-06-01',to:'2027-06-30',projectId:p.id,type:'meeting'}).items.find(x=>x.sourceId===zoned.id);assert.equal(projected.displayTimeZone,'America/New_York');assert.equal(projected.start,'2027-06-02T14:00:00.000Z');
 rejects(()=>calendar(db,user,{from:'2027-01-01',to:'2027-12-31'}));
});
test('hidden project overlap discloses no indicator without separate team availability permission',()=>{
 const {db,admin,p,user}=fixture(),p2=execute(db,admin,{id:uid(),op:'project.create',data:{name:'Скрытая свадьба',date:'2027-06-12'}});
 const data={title:'Секретное событие',startAt:'2027-06-01T10:00:00Z',endAt:'2027-06-01T11:00:00Z',timeZone:'UTC',assignedUserIds:[admin.id],participantUserIds:[]};run(db,admin,'meeting.save',{projectId:p2.id,data});
 const visible=previewMeeting(db,user,{projectId:p.id,data:{...data,title:'Открытое событие'}});assert.deepEqual(visible.conflicts,[]);
 const role=execute(db,admin,{id:uid(),op:'role.save',name:'Занятость',permissions:['viewTeamAvailability']});grant(db,user,role.id);
 const limited=previewMeeting(db,user,{projectId:p.id,data:{...data,title:'Открытое событие'}}).conflicts;assert.equal(limited.length,1);assert.equal(limited[0].busy,true);assert.equal(limited[0].title,undefined);assert.equal(limited[0].sourceId,undefined);
});
test('outbox is durable and deduplicated, reads are pure, paid debt and revoked recipients cancel delivery',()=>{
 const {db,admin,p,user}=fixture();const task=insert(db,admin,'task',{title:'Задача',dueDate:'2027-06-11',status:'todo',assigneeUserId:user.id},p.id);
 const at=Date.parse('2027-06-10T06:00:00Z');assert.equal(processOutbox(db,at).delivered,1);assert.equal(processOutbox(db,at).delivered,0);assert.equal(notifications(db,user).unread,1);assert.equal(notifications(db,user).unread,1);
 const n=notifications(db,user).items[0];run(db,user,'notification.read',{entityId:n.id});assert.equal(notifications(db,user).unread,0);
 db.prepare('DELETE FROM grants WHERE user_id=?').run(user.id);assert.equal(notifications(db,user).total,0);processOutbox(db,Date.parse('2027-06-12T06:00:00Z'));assert.equal(notifications(db,user).total,0);
 const pref=preferences(db,admin);rejects(()=>run(db,admin,'notificationPreferences.save',{version:pref.version,data:{disabledTypes:[],dateOnlyReminderTime:'09:00',email:true}}));
});
test('reminder generations survive unrelated edits, repeat scheduling is durable, and paid debt cancels pending delivery',()=>{
 const {db,admin,p,user}=fixture();const task=insert(db,admin,'task',{title:'Позвонить',dueDate:'2027-06-11',status:'todo',assigneeUserId:user.id},p.id),before=Date.parse('2027-06-09T06:00:00Z');
 scheduleReminders(db,before);scheduleReminders(db,before);assert.equal(db.prepare("SELECT count(*) count FROM notification_outbox WHERE source_id=? AND template_key='task.before'").get(task.id).count,1);
 change(db,admin,task,{...task.data,title:'Позвонить площадке'});const due=Date.parse('2027-06-10T06:00:00Z');assert.equal(processOutbox(db,due).delivered,1);assert.equal(notifications(db,user,{type:'task.before'}).items[0].data.body,'Позвонить площадке');assert.equal(processOutbox(db,due).delivered,0);
 const obligation=insert(db,admin,'obligation',{title:'Фотограф',priceKind:'amount',agreed:50000,dueDate:'2027-06-13',responsible:user.id},p.id);scheduleReminders(db,Date.parse('2027-06-09T06:00:00Z'));assert.equal(db.prepare("SELECT count(*) count FROM notification_outbox WHERE source_id=? AND template_key='payment.3d'").get(obligation.id).count,1);
 insert(db,admin,'movement',{type:'payment',amount:50000,date:'2027-06-10',description:'Оплачено',source:'direct',obligationId:obligation.id},p.id);const result=processOutbox(db,Date.parse('2027-06-10T06:00:00Z'));assert(result.cancelled>=1);assert.equal(notifications(db,user,{type:'payment.3d'}).total,0);
});
test('workflow result states enqueue notifications and microsite rotation revokes guest sessions',()=>{
 const {db,admin,p,user}=fixture();const revision=insert(db,admin,'approvalRevision',{approverUserIds:[user.id],publishedBy:admin.id,state:'open'},p.id),approval=insert(db,admin,'approval',{title:'Меню',state:'draft',currentRevisionId:null,discussion:false},p.id),cursor=db.prepare('SELECT max(rowid) rowid FROM audit').get().rowid;
 change(db,admin,approval,{...approval.data,state:'in_review',currentRevisionId:revision.id});queueChanges(db,admin,cursor);assert.equal(db.prepare("SELECT count(*) count FROM notification_outbox WHERE source_id=? AND template_key='approval.published'").get(approval.id).count,1);
 let next=entity(db,approval.id),resultCursor=db.prepare('SELECT max(rowid) rowid FROM audit').get().rowid;change(db,admin,next,{...next.data,state:'changes'});queueChanges(db,admin,resultCursor);assert.equal(db.prepare("SELECT count(*) count FROM notification_outbox WHERE source_id=? AND template_key='approval.result'").get(approval.id).count,1);
 next=entity(db,approval.id);resultCursor=db.prepare('SELECT max(rowid) rowid FROM audit').get().rowid;change(db,admin,next,{...next.data,state:'in_review',discussion:true});queueChanges(db,admin,resultCursor);assert.equal(db.prepare("SELECT count(*) count FROM notification_outbox WHERE source_id=? AND template_key='approval.result'").get(approval.id).count,2);
 const site=insert(db,admin,'microsite',{shareId:'a'.repeat(24),status:'published',publishedRevisionId:'revision'},p.id);db.prepare('INSERT INTO guest_invites(id,digest,agency_id,project_id,guest_table_id,expires_at,revoked_at,created_by,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('invite','digest',admin.agency_id,p.id,'guests',Date.now()+86400000,null,admin.id,1,new Date().toISOString());db.prepare('INSERT INTO guest_sessions VALUES(?,?,?,?,?,?)').run('session','invite',Date.now()+86400000,1,'csrf',new Date().toISOString());const siteCursor=db.prepare('SELECT max(rowid) rowid FROM audit').get().rowid;
 change(db,admin,site,{...site.data,shareId:'b'.repeat(24)});queueChanges(db,admin,siteCursor);assert.equal(db.prepare('SELECT count(*) count FROM guest_sessions').get().count,0);
 db.prepare('INSERT INTO guest_sessions VALUES(?,?,?,?,?,?)').run('session-2','invite',Date.now()+86400000,1,'csrf-2',new Date().toISOString());const unpublished=entity(db,site.id),unpublishCursor=db.prepare('SELECT max(rowid) rowid FROM audit').get().rowid;change(db,admin,unpublished,{...unpublished.data,status:'unpublished',publishedRevisionId:null});queueChanges(db,admin,unpublishCursor);assert.equal(db.prepare('SELECT count(*) count FROM guest_sessions').get().count,0);
});
test('baseline readiness stays unverified, verified file provenance is required, snooze stays personal',()=>{
 const {db,admin,p,user}=fixture();let report=readiness(db,user,p.id);assert.equal(report.progress.ratio,0);assert.equal(report.checks.find(x=>x.ruleKey==='contract').state,'unknown');assert(!report.checks.some(x=>x.state==='pass'));
 const updated=run(db,user,'project.readinessSettings',{projectId:p.id,version:p.version,data:{readinessPolicy:{contract:{required:true},booking:{required:false,reason:'Выбранные услуги не требуют брони'},timing:{required:true},seating:{required:true}}}});
 const file=insert(db,admin,'file',{name:'Документ.pdf'},p.id);report=readiness(db,user,p.id);assert.equal(report.checks.find(x=>x.ruleKey==='contract').state,'warning');
 run(db,user,'file.verify',{projectId:p.id,entityId:file.id,version:file.version,documentKind:'contract',status:'confirmed',note:'Проверен подписанный экземпляр'});assert.equal(readiness(db,user,p.id).checks.find(x=>x.ruleKey==='contract').state,'pass');
 const untilAt=new Date(Date.now()+86400000).toISOString();run(db,user,'readiness.snooze',{projectId:p.id,ruleKey:'tasks',untilAt});assert.equal(readiness(db,user,p.id).checks.find(x=>x.ruleKey==='tasks').snoozedUntil,untilAt);assert.equal(readiness(db,admin,p.id).checks.find(x=>x.ruleKey==='tasks').snoozedUntil,null);assert.equal(readiness(db,user,p.id).checks.find(x=>x.ruleKey==='tasks').state,'warning');
 const overdue=insert(db,admin,'task',{title:'Просроченная задача',dueDate:'2020-01-01',status:'todo',assigneeUserId:user.id},p.id);assert(!readiness(db,user,p.id).attention.some(x=>x.sourceId===overdue.id));assert(readiness(db,admin,p.id).attention.some(x=>x.sourceId===overdue.id));assert(readiness(db,user,p.id,Date.parse(untilAt)+1).attention.some(x=>x.sourceId===overdue.id));
 assert.equal(dashboard(db,user,{projectId:p.id}).metrics.activeProjects,1);
 const focused=insert(db,admin,'task',{title:'В фокусе организатора',dueDate:'2027-06-01',status:'todo',organizerFocus:true},p.id),home=dashboard(db,admin);
 assert.equal(home.organizerFocusTotal,1);assert.equal(home.organizerFocus[0].id,focused.id);
});

test('explicit staff working intervals use the project time zone and remain reversible',()=>{
 const {db,admin,p}=fixture();
 const saved=run(db,admin,'project.readinessSettings',{projectId:p.id,version:p.version,data:{staffIntervals:[{userId:admin.id,startLocal:'2027-06-12T09:00',endLocal:'2027-06-12T23:00'}]}});
 assert.equal(saved.data.staffIntervals[0].startAt,'2027-06-12T06:00:00.000Z');assert.equal(saved.data.staffIntervals[0].endAt,'2027-06-12T20:00:00.000Z');
 rejects(()=>run(db,admin,'project.readinessSettings',{projectId:p.id,version:saved.version,data:{staffIntervals:[{userId:admin.id,startLocal:'2027-06-12T23:00',endLocal:'2027-06-12T09:00'}]}}));
 assert.equal(entity(db,p.id).version,saved.version);
 const cleared=run(db,admin,'project.readinessSettings',{projectId:p.id,version:saved.version,data:{staffIntervals:[]}});assert.deepEqual(cleared.data.staffIntervals,[]);
});

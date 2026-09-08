import { assert, entity, entities, insert, change, version, transaction, now, uid, decode } from '../../db.mjs';
import { can, requireAccess, digest } from '../../auth.mjs';
import { getScoped, projectVisible, text, date, safeUrl, financials, sectionOf } from '../../model.mjs';
import { currentUser, projectAccess, scoped, members, validateMembers, visible, listPage, localDate, addDays, timeZone, zonedInstant } from '../common.mjs';

export function migrate(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS notification_outbox(id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, agency_id TEXT NOT NULL, project_id TEXT, recipient_id TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_version INTEGER NOT NULL, occurrence_at TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, retry_at TEXT, lease_until TEXT, generation TEXT NOT NULL, template_key TEXT NOT NULL, payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS outbox_ready ON notification_outbox(status,occurrence_at,retry_at,lease_until);
 CREATE TABLE IF NOT EXISTS readiness_snoozes(user_id TEXT NOT NULL,project_id TEXT NOT NULL,rule_key TEXT NOT NULL,source_id TEXT NOT NULL DEFAULT '',until_at TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,project_id,rule_key,source_id));
 CREATE UNIQUE INDEX IF NOT EXISTS notification_dedupe ON entities(json_extract(data,'$.dedupeKey')) WHERE kind='notification' AND json_extract(data,'$.dedupeKey') IS NOT NULL;`);
}
const route=(p,s,id='')=>p?`/app/projects/${p}/${s}${id?'/'+id:''}`:`/app/${s}`;
const activeProject=p=>p&&!p.deleted&&!['archived','completed'].includes(p.data.status);
const allowedSource=(db,u,r,fields=[])=>r&&!r.deleted&&(!(r.kind==='project'?r.id:r.project_id)||projectVisible(db,u,r.kind==='project'?r.id:r.project_id))&&can(db,u,r.kind==='obligation'?['read','finance']:'read',r.kind==='project'?r.id:r.project_id,({task:'tasks',approval:'approvals',approvalRevision:'approvals',meeting:'calendar',project:'project',microsite:'microsite'})[r.kind]||sectionOf(r),r.id,fields.length?fields:undefined);
function event(db,u,r,p,start,end,allDay,title,section,assigned=[],extra={}) {return {id:r.kind+':'+r.id,sourceKind:r.kind,sourceId:r.id,sourceVersion:r.version,projectId:p?.id||null,projectName:p?.data.name||'',title,start,end,allDay,displayTimeZone:p?.data.timeZone||r.data.timeZone||'Europe/Moscow',assignedUserIds:assigned,actionUrl:route(p?.id,section,r.id),allowedOps:can(db,u,'edit',p?.id||null,sectionOfSource(r),r.id)?r.kind==='task'?['open','reschedule']:r.kind==='meeting'?['open','edit','delete']:['open']:['open'],...extra};}
function sectionOfSource(r){return ({task:'tasks',approval:'approvals',approvalRevision:'approvals',meeting:'calendar',project:'project'})[r.kind]||sectionOf(r);}
export function calendar(db,user,q={}) {
 const u=currentUser(db,user),from=date(q.from,false),to=date(q.to,false);assert(to>=from&&(Date.parse(to)-Date.parse(from))/86400000<=92,'Выберите период не длиннее 93 дней');
 const projects=entities(db,u.agency_id,null,'project').filter(p=>activeProject(p)&&projectVisible(db,u,p.id)&&(!q.projectId||p.id===q.projectId));
 if(q.projectId) projectAccess(db,u,q.projectId);
 const result=[]; const add=e=>{const day=e.allDay?e.start:localDate(e.start,e.displayTimeZone),last=e.allDay?e.end:localDate(e.end,e.displayTimeZone);if(day<=to&&last>=from&&(!q.type||q.type===e.sourceKind)&&(!q.assignee||e.assignedUserIds.includes(q.assignee)))result.push(e);};
 for(const p of projects){
  const z=p.data.timeZone||'Europe/Moscow',rows=entities(db,u.agency_id,p.id);
  if(p.data.date&&can(db,u,'read',p.id,'project',p.id,['name','date']))add(event(db,u,p,p,p.data.date,p.data.date,true,p.data.name,'overview'));
  for(const r of rows){
   if(r.kind==='task'&&allowedSource(db,u,r,['title','dueDate','status','assigneeUserId'])&&!['done','skipped'].includes(r.data.status)&&r.data.dueDate)add(event(db,u,r,p,r.data.dueDate,r.data.dueDate,true,r.data.title,'tasks',[r.data.assigneeUserId].filter(Boolean)));
   if(r.kind==='approval'&&allowedSource(db,u,r,['title','dueDate','state'])&&r.data.dueDate&&!['approved','withdrawn','draft'].includes(r.data.state))add(event(db,u,r,p,r.data.dueDate,r.data.dueDate,true,r.data.title,'approvals'));
   if(r.kind==='meeting'&&allowedSource(db,u,r,['title','startAt','endAt','assignedUserIds','participantUserIds']))add(event(db,u,r,p,r.data.startAt,r.data.endAt,false,r.data.title,'calendar',[...(r.data.assignedUserIds||[]),...(r.data.participantUserIds||[])],{location:r.data.location||''}));
  }
  // Financial projection requires the complete authorized ledger. Never leak an aggregate of hidden fields.
  if(can(db,u,['read','finance'],p.id,'budget',null,null)){
   const f=financials(rows);for(const r of rows.filter(x=>x.kind==='obligation'&&x.data.agreed!==null&&x.data.dueDate&&x.data.agreed-(f.paid[x.id]||0)>0))add(event(db,u,r,p,r.data.dueDate,r.data.dueDate,true,r.data.title,'finance/estimate',[r.data.responsible].filter(Boolean),{due:r.data.agreed-(f.paid[r.id]||0)}));
  }
  for(const table of rows.filter(r=>r.kind==='table'&&r.data.key==='timing'&&r.data.semanticMap)){
   const m=table.data.semanticMap;
   for(const r of rows.filter(r=>r.kind==='row'&&r.parent_id===table.id)){
    const required=[m.startTime,m.endTime,m.title,m.assignedUserIds].filter(Boolean);if(!m.startTime||!m.title||!can(db,u,'read',p.id,table.id,r.id,required))continue;
    try{const day=addDays(p.data.date,Number(r.data[m.dayOffset]||0)),start=zonedInstant(day,r.data[m.startTime],z,r.data[m.dstChoice]),endTime=r.data[m.endTime]||r.data[m.startTime],endDay=addDays(day,Number(r.data[m.endDayOffset]||0)),end=zonedInstant(endDay,endTime,z,r.data[m.dstChoice]);if(end<start)continue;
    const assigned=Array.isArray(r.data[m.assignedUserIds])?r.data[m.assignedUserIds]:[];add(event(db,u,r,p,start,end,false,r.data[m.title],'day/team',assigned,{sourceKind:'timing',actionUrl:route(p.id,'day/team')+'?row='+r.id}));}catch{/* Invalid legacy timing is surfaced in readiness, not silently corrected. */}
   }
  }
 }
 if(!q.projectId)for(const r of entities(db,u.agency_id,null,'meeting'))if(allowedSource(db,u,r,['title','startAt','endAt','assignedUserIds','participantUserIds']))add(event(db,u,r,null,r.data.startAt,r.data.endAt,false,r.data.title,'calendar',[...(r.data.assignedUserIds||[]),...(r.data.participantUserIds||[])]));
 return {items:result.sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id)),from,to};
}
function allBusy(db,u) {
 const records=db.prepare("SELECT * FROM entities WHERE agency_id=? AND deleted=0 AND kind IN ('meeting','project','row','table')").all(u.agency_id).map(decode),projects=new Map(records.filter(r=>r.kind==='project'&&activeProject(r)).map(r=>[r.id,r]));
 const result=[];
 for(const r of records){
  if(r.project_id&&!projects.has(r.project_id))continue;
  if(r.kind==='meeting')result.push({row:r,start:r.data.startAt,end:r.data.endAt,users:[...(r.data.assignedUserIds||[]),...(r.data.participantUserIds||[])]});
  if(r.kind==='project')for(const interval of r.data.staffIntervals||[])if(interval.userId&&interval.startAt<interval.endAt)result.push({row:r,start:interval.startAt,end:interval.endAt,users:[interval.userId]});
  if(r.kind==='row'){
   const t=records.find(t=>t.id===r.parent_id&&t.kind==='table'),m=t?.data.semanticMap,p=projects.get(r.project_id);if(t?.data.key!=='timing'||!m?.assignedUserIds||!p)continue;
   try{const day=addDays(p.data.date,Number(r.data[m.dayOffset]||0)),start=zonedInstant(day,r.data[m.startTime],p.data.timeZone),end=zonedInstant(addDays(day,Number(r.data[m.endDayOffset]||0)),r.data[m.endTime],p.data.timeZone);if(start<end)result.push({row:r,start,end,users:Array.isArray(r.data[m.assignedUserIds])?r.data[m.assignedUserIds]:[]});}catch{}
  }
 }return result;
}
export function conflicts(db,user,d,excludeId=null) {
 const u=currentUser(db,user),ids=new Set([...(d.assignedUserIds||[]),...(d.participantUserIds||[])]),items=[];
 for(const b of allBusy(db,u)){
  if(b.row.id===excludeId||!b.users.some(id=>ids.has(id))||!(d.startAt<b.end&&b.start<d.endAt))continue;
  const readable=allowedSource(db,u,b.row,['title','startAt','endAt']);
  if(!readable&&!can(db,u,'viewTeamAvailability',null))continue;
  items.push(readable?{sourceId:b.row.id,sourceKind:b.row.kind,projectId:b.row.project_id,title:b.row.data.title||b.row.data.name,start:b.start,end:b.end,actionUrl:route(b.row.project_id,sectionOfSource(b.row),b.row.id)}:{busy:true,start:b.start,end:b.end});
 }return items;
}
function meetingData(db,u,p,data,current) {
 const d={...current?.data,...data},z=timeZone(d.timeZone|| (p?entity(db,p).data.timeZone:undefined)||'Europe/Moscow');
 const people=[...new Set([...(d.assignedUserIds||[]),...(d.participantUserIds||[])])];
 if(p)validateMembers(db,u,p,people);else{const allowed=db.prepare('SELECT id FROM users WHERE agency_id=? AND disabled=0').all(u.agency_id).map(x=>x.id);assert(people.every(id=>allowed.includes(id)),'Участник недоступен');}
 let start=d.startAt,end=d.endAt;
 if(d.startDate)start=zonedInstant(d.startDate,d.startTime,z,d.dstChoice);
 if(d.endDate)end=zonedInstant(d.endDate,d.endTime,z,d.endDstChoice||d.dstChoice);
 if(d.dateAnchor==='wedding'){
  assert(p,'Привязка к свадьбе требует проекта');assert(Number.isInteger(d.offsetDays)&&Math.abs(d.offsetDays)<=1095&&Number.isInteger(d.durationMinutes)&&d.durationMinutes>=1&&d.durationMinutes<=10080,'Проверьте смещение и длительность');
  start=zonedInstant(addDays(entity(db,p).data.date,d.offsetDays),d.localStartTime,z,d.dstChoice);end=new Date(Date.parse(start)+d.durationMinutes*60000).toISOString();
 }
 assert(typeof start==='string'&&typeof end==='string'&&Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end)),'Укажите начало и окончание');
 start=new Date(start).toISOString();end=new Date(end).toISOString();assert(start<end,'Окончание должно быть позже начала');
 return {title:text(d.title),startAt:start,endAt:end,timeZone:z,location:d.location?text(d.location,'Место или ссылка',1,1000):'',notes:d.notes?text(d.notes,'Заметка',1,8000):'',assignedUserIds:d.assignedUserIds||[],participantUserIds:d.participantUserIds||[],dateAnchor:d.dateAnchor==='wedding'?'wedding':null,offsetDays:d.dateAnchor==='wedding'?d.offsetDays:null,localStartTime:d.dateAnchor==='wedding'?d.localStartTime:null,durationMinutes:d.dateAnchor==='wedding'?d.durationMinutes:null,dstChoice:d.dstChoice||null,conflictReason:d.conflictReason?text(d.conflictReason,'Причина пересечения',3,2000):''};
}
export function previewMeeting(db,user,c){const u=currentUser(db,user),p=c.projectId||null;if(p)projectAccess(db,u,p);requireAccess(db,u,c.entityId?'edit':'create',p,'calendar',c.entityId||null,Object.keys(c.data||{}));const row=c.entityId?scoped(db,u,c.entityId,p,'meeting'):null;const data=meetingData(db,u,p,c.data,row);return {data,conflicts:conflicts(db,u,data,row?.id),digest:digest(JSON.stringify({data,conflicts:conflicts(db,u,data,row?.id)}))};}
const meetingAuthorize=(db,u,c)=>{const p=c.projectId||null;requireAccess(db,u,c.op==='meeting.delete'?'delete':c.entityId?'edit':'create',p,'calendar',c.entityId||null,c.op==='meeting.delete'?null:Object.keys(c.data||{}));if(c.entityId)scoped(db,u,c.entityId,p,'meeting');};
export const operations={
 'meeting.save':{authorize:meetingAuthorize,run(db,u,c){const preview=previewMeeting(db,u,c);if(preview.conflicts.length)assert(c.conflictDigest===preview.digest&&preview.data.conflictReason,'Есть пересечение. Проверьте события и укажите причину сохранения.',409,{conflicts:preview.conflicts,digest:preview.digest});const old=c.entityId?scoped(db,u,c.entityId,c.projectId||null,'meeting'):null;if(old)version(old,c.version);return old?change(db,u,old,preview.data):insert(db,u,'meeting',preview.data,c.projectId||null);}},
 'meeting.delete':{authorize:meetingAuthorize,run(db,u,c){const r=scoped(db,u,c.entityId,c.projectId||null,'meeting');version(r,c.version);return change(db,u,r,r.data,true,'delete');}},
 'notification.read':{authorize(db,u,c){const r=scoped(db,u,c.entityId,undefined,'notification');assert(notificationVisible(db,u,r),'Уведомление недоступно',403);},run(db,u,c){const r=entity(db,c.entityId);return r.data.readAt?r:change(db,u,r,{...r.data,readAt:now()});}},
 'notification.readAll':{authorize(){},run(db,u,c){const rows=notificationRows(db,u,c);for(const r of rows)if(!r.data.readAt)change(db,u,r,{...r.data,readAt:now()});return {count:rows.filter(r=>!r.data.readAt).length};}},
 'notificationPreferences.save':{authorize(){},run(db,u,c){const old=preferences(db,u);assert(c.version===old.version,'Настройки уже изменены',409,{current:old});const d=c.data;assert(d&&Array.isArray(d.disabledTypes)&&d.disabledTypes.length<=30&&d.disabledTypes.every(x=>typeof x==='string'&&x.length<=100),'Проверьте виды уведомлений');assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(d.dateOnlyReminderTime),'Проверьте время');assert(!d.email,'Email не подключён');const data={disabledTypes:[...new Set(d.disabledTypes)],dateOnlyReminderTime:d.dateOnlyReminderTime,email:false,inApp:true};db.prepare('INSERT INTO notification_preferences VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,version=excluded.version').run(u.id,JSON.stringify(data),old.version+1);db.prepare("UPDATE notification_outbox SET status='cancelled' WHERE recipient_id=? AND status='queued'").run(u.id);return {...data,version:old.version+1,emailStatus:'not_configured'};}},
 'readiness.snooze':{authorize(db,u,c){projectAccess(db,u,c.projectId,'read','readiness');},run(db,u,c){assert(['contract','booking','rsvp','receipts','payments','timing','tasks','seating'].includes(c.ruleKey),'Проверка не найдена');const until=new Date(c.untilAt);assert(Number.isFinite(+until)&&+until>Date.now()&&+until<Date.now()+366*86400000,'Выберите будущую дату в пределах года');db.prepare('INSERT INTO readiness_snoozes VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,project_id,rule_key,source_id) DO UPDATE SET until_at=excluded.until_at,reason=excluded.reason').run(u.id,c.projectId,c.ruleKey,c.sourceId||'',until.toISOString(),c.reason?text(c.reason,'Причина',1,1000):'');return {untilAt:until.toISOString()};}},
};
export function preferences(db,user){const u=currentUser(db,user),r=db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(u.id);return {...(r?JSON.parse(r.data):{disabledTypes:[],dateOnlyReminderTime:'09:00',email:false,inApp:true}),version:r?.version||0,emailStatus:'not_configured'};}
function notificationVisible(db,u,r){if(r.data.recipientUserId!==u.id&&r.data.userId!==u.id)return false;const p=r.project_id||r.data.projectId;if(p&&!projectVisible(db,u,p))return false;if(r.data.sourceId){const source=entity(db,r.data.sourceId);if(!allowedSource(db,u,source,['title']))return false;}return true;}
function notificationRows(db,u,q={}){return db.prepare("SELECT * FROM entities WHERE agency_id=? AND kind='notification' AND deleted=0 ORDER BY updated_at DESC,id").all(u.agency_id).map(decode).filter(r=>notificationVisible(db,u,r)&&(!q.unread||!r.data.readAt)&&(!q.projectId||r.project_id===q.projectId)&&(!q.type||r.data.templateKey===q.type));}
export function notifications(db,user,q={}) {const u=currentUser(db,user),rows=notificationRows(db,u,q);return {...listPage(rows,q),unread:notificationRows(db,u).filter(r=>!r.data.readAt).length};}
const titles={'task.assigned':'Вам назначена задача','task.before':'Задача на завтра','task.overdue':'Задача просрочена','approval.published':'Нужно ваше решение','approval.result':'Получено решение','guest.responded':'Гости ответили на приглашение','project.rescheduled':'Дата свадьбы изменена','meeting.conflict':'Встреча пересекается с другим событием','meeting.24h':'Встреча через сутки','meeting.1h':'Встреча через час','payment.3d':'Выплата через три дня','payment.1d':'Выплата завтра','payment.due':'Сегодня срок выплаты','payment.overdue':'Срок выплаты прошёл'};
function recipientAllowed(db,u,r){if(!u||u.disabled)return false;return allowedSource(db,u,r,['title']);}
export function enqueue(db,actor,source,recipientId,templateKey,occurrence=now(),generation=String(source.version),payload={}) {
 if(recipientId===actor?.id)return;const u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(recipientId,source.agency_id);if(!recipientAllowed(db,u,source))return;
 const pref=preferences(db,u);if(pref.disabledTypes.includes(templateKey))return;
 const key=[source.kind,source.id,templateKey,generation,recipientId,occurrence,'inApp'].join(':');
 db.prepare('INSERT OR IGNORE INTO notification_outbox(id,dedupe_key,agency_id,project_id,recipient_id,source_kind,source_id,source_version,occurrence_at,channel,generation,template_key,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(),key,source.agency_id,source.kind==='project'?source.id:source.project_id,recipientId,source.kind,source.id,source.version,occurrence,'inApp',generation,templateKey,JSON.stringify({...payload,preferenceVersion:pref.version}));
}
function generationFor(r,pref){return digest(JSON.stringify({version:r.version,pref:pref.version}));}
export function queueChanges(db,actor,sinceRowid){
 const changes=db.prepare('SELECT rowid,* FROM audit WHERE rowid>? ORDER BY rowid').all(sinceRowid);
 for(const a of changes){const r=entity(db,a.entity_id);if(!r||r.deleted||r.kind==='notification')continue;const before=a.before_json?JSON.parse(a.before_json):null;const old=before?.data||{};const at=a.created_at,g=String(a.rowid);
  if(r.kind==='task'&&r.data.assigneeUserId&&old.assigneeUserId!==r.data.assigneeUserId)enqueue(db,actor,r,r.data.assigneeUserId,'task.assigned',at,g);
  if(r.kind==='approval'){
   const rev=r.data.currentRevisionId?entity(db,r.data.currentRevisionId):null,ids=rev?.data.approverUserIds||[];
   if(rev&&old.currentRevisionId!==rev.id)for(const id of ids)enqueue(db,actor,r,id,'approval.published',at,g);
   if(old.state!==r.data.state&&['approved','needs_changes','changes_requested','discussion','needs_discussion'].includes(r.data.state)){const targets=new Set([...ids,rev?.data.publishedBy,r.project_id&&entity(db,r.project_id)?.data.leadOrganizerUserId]);for(const id of targets)if(id)enqueue(db,actor,r,id,'approval.result',at,g);}
  }
  if(r.kind==='project'&&old.date&&old.date!==r.data.date)for(const person of members(db,actor,r.id))enqueue(db,actor,r,person.id,'project.rescheduled',at,g);
  if(r.kind==='meeting'&&r.data.conflictReason&&JSON.stringify(old)!==JSON.stringify(r.data))for(const id of new Set([...(r.data.assignedUserIds||[]),...(r.data.participantUserIds||[])]))enqueue(db,actor,r,id,'meeting.conflict',at,g);
 }
}
export function queueGuestResponse(db,actor,projectId,rows,commandId){const p=entity(db,projectId),id=p?.data.leadOrganizerUserId;if(!id)return;const source=entities(db,p.agency_id,projectId,'microsite')[0];if(source)enqueue(db,null,source,id,'guest.responded',now(),digest(commandId),{actionUrl:route(projectId,'guests')});}
export function scheduleReminders(db,at=Date.now()) {
 const rows=db.prepare("SELECT * FROM entities WHERE deleted=0 AND kind IN ('task','meeting','obligation')").all().map(decode);
 for(const r of rows){const p=r.project_id?entity(db,r.project_id):null;if(p&&!activeProject(p))continue;const recipients=r.kind==='meeting'?[...new Set([...(r.data.assignedUserIds||[]),...(r.data.participantUserIds||[])])]:[r.data.assigneeUserId||r.data.responsible||p?.data.leadOrganizerUserId].filter(Boolean);
  for(const id of recipients){const u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(id,r.agency_id);if(!recipientAllowed(db,u,r))continue;const pref=preferences(db,u),gen=generationFor(r,pref),zone=p?.data.timeZone||r.data.timeZone||'Europe/Moscow',day=localDate(at,zone),occurrences=[];
   if(r.kind==='task'&&!['done','skipped'].includes(r.data.status)&&r.data.dueDate){const before=addDays(r.data.dueDate,-1);if(before>=day)occurrences.push(['task.before',zonedInstant(before,pref.dateOnlyReminderTime,zone)]);if(r.data.dueDate<day)occurrences.push(['task.overdue',zonedInstant(addDays(r.data.dueDate,1),pref.dateOnlyReminderTime,zone)]);else occurrences.push(['task.overdue',zonedInstant(addDays(r.data.dueDate,1),pref.dateOnlyReminderTime,zone)]);}
   if(r.kind==='meeting'&&r.data.startAt>new Date(at).toISOString())for(const [hours,key] of [[24,'meeting.24h'],[1,'meeting.1h']]){const when=Date.parse(r.data.startAt)-hours*3600000;if(when>=Date.parse(r.updated_at))occurrences.push([key,new Date(when).toISOString()]);}
   if(r.kind==='obligation'&&r.data.agreed!==null&&r.data.dueDate){const f=financials(entities(db,r.agency_id,r.project_id));if(r.data.agreed-(f.paid[r.id]||0)>0)for(const [days,key]of[[3,'payment.3d'],[1,'payment.1d'],[0,'payment.due']]){const when=addDays(r.data.dueDate,-days);if(when>=day)occurrences.push([key,zonedInstant(when,pref.dateOnlyReminderTime,zone)]);else if(days===0)occurrences.push(['payment.overdue',zonedInstant(r.data.dueDate,pref.dateOnlyReminderTime,zone)]);}}
   for(const [key,when]of occurrences)enqueue(db,null,r,id,key,when,gen,{reminder:true});
  }
 }
}
export function processOutbox(db,at=Date.now(),limit=100) {
 return transaction(db,()=>{scheduleReminders(db,at);const stamp=new Date(at).toISOString();const pending=db.prepare("SELECT * FROM notification_outbox WHERE (status='queued' OR (status='leased' AND lease_until<?)) AND occurrence_at<=? AND (retry_at IS NULL OR retry_at<=?) ORDER BY occurrence_at,id LIMIT ?").all(stamp,stamp,stamp,limit);let delivered=0,cancelled=0;
  for(const job of pending){db.prepare("UPDATE notification_outbox SET status='leased',lease_until=?,attempts=attempts+1 WHERE id=?").run(new Date(at+30000).toISOString(),job.id);const u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(job.recipient_id,job.agency_id),r=entity(db,job.source_id),payload=JSON.parse(job.payload);let valid=recipientAllowed(db,u,r)&&r.version===job.source_version;
   if(valid){const pref=preferences(db,u);valid=!pref.disabledTypes.includes(job.template_key)&&pref.version===payload.preferenceVersion;if(payload.reminder)valid=valid&&generationFor(r,pref)===job.generation;
    if(r.kind==='task'&&['done','skipped'].includes(r.data.status))valid=false;
    if(r.kind==='meeting'&&r.data.startAt<=stamp)valid=false;
    if(r.kind==='obligation'){const f=financials(entities(db,r.agency_id,r.project_id));if(r.data.agreed===null||r.data.agreed-(f.paid[r.id]||0)<=0)valid=false;}
   }
   if(!valid){db.prepare("UPDATE notification_outbox SET status='cancelled',lease_until=NULL WHERE id=?").run(job.id);cancelled++;continue;}
   if(!db.prepare("SELECT id FROM entities WHERE kind='notification' AND json_extract(data,'$.dedupeKey')=?").get(job.dedupe_key))insert(db,u,'notification',{recipientUserId:u.id,sourceKind:r.kind,sourceId:r.id,sourceVersion:r.version,templateKey:job.template_key,title:titles[job.template_key]||'Новое событие',body:r.data.title||r.data.name||'',actionUrl:payload.actionUrl||route(r.project_id,sectionOfSource(r),r.kind==='project'?'':r.id),createdAt:stamp,readAt:null,dedupeKey:job.dedupe_key},r.kind==='project'?r.id:r.project_id);
   db.prepare("UPDATE notification_outbox SET status='sent',lease_until=NULL WHERE id=?").run(job.id);delivered++;
  }return {delivered,cancelled};
 });
}

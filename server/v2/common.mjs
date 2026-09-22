import { assert, transaction, entities } from '../db.mjs';
import { can, canHoldFunds, requireAccess, digest } from '../auth.mjs';
import { getScoped, projectVisible, date, sectionOf } from '../model.mjs';

export function currentUser(db,user) {
 const u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(user?.id,user?.agency_id);
 assert(u,'Доступ отозван',403);return u;
}
// New commands are synchronous and atomic; authorize is always run before replay.
export function executeModule(db,user,cmd,operations) {
 assert(cmd&&/^[a-zA-Z0-9_-]{8,100}$/.test(cmd.id||''),'Команда должна иметь уникальный ID');
 const operation=operations[cmd.op];assert(operation,'Неизвестное действие');
 try{return transaction(db,()=>{
  const u=currentUser(db,user);
  if(cmd.projectId) projectAccess(db,u,cmd.projectId);
  assert(!cmd.offline,'Это действие доступно только при подключении к сети',409);
  operation.authorize(db,u,cmd);
  const hash=digest(JSON.stringify(cmd)); const prior=db.prepare('SELECT * FROM commands WHERE id=? AND user_id=?').get(cmd.id,u.id);
  if(prior){assert(prior.digest===hash,'ID команды уже использован',409);return safeCommandResult(db,u,JSON.parse(prior.result));}
  const result=safeCommandResult(db,u,operation.run(db,u,cmd));
  assert(result!==undefined&&!result?.then,'Команда должна вернуть синхронный результат');
  const saved=operation.redactResult?operation.redactResult(result):result;
  db.prepare('INSERT INTO commands VALUES(?,?,?,?)').run(cmd.id,u.id,hash,JSON.stringify(saved));return result;
 });}catch(error){if(error.details)error.details=safeCommandResult(db,user,error.details);throw error}
}
function safeCommandResult(db,u,value){if(!value||typeof value!=='object')return value;if(Array.isArray(value))return value.map(v=>safeCommandResult(db,u,v));if(value.kind&&value.id&&value.agency_id&&value.data&&typeof value.data==='object'){const project=value.kind==='project'?value.id:value.project_id,section=sectionOf(value);return {...value,data:Object.fromEntries(Object.entries(value.data).filter(([key])=>!(value.kind==='project'&&key==='limit'&&!canHoldFunds(db,u,project))&&can(db,u,'read',project,section,value.id,key)))};}return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,safeCommandResult(db,u,v)]));}
export function projectAccess(db,u,id,action='read',section, row,fields) {
 const p=getScoped(db,u,id,undefined,'project');assert(!p.deleted&&projectVisible(db,u,id),'Проект недоступен',403);
 if(section) requireAccess(db,u,action,id,section,row,fields);return p;
}
export function scoped(db,u,id,project,kind,{deleted=false}={}) {const r=getScoped(db,u,id,project,kind);assert(deleted||!r.deleted,'Запись удалена',409);return r;}
export function members(db,u,project) {
 project=typeof project==='object'?project.id:project;
 projectAccess(db,u,project);
 return db.prepare('SELECT * FROM users WHERE agency_id=? AND disabled=0 ORDER BY name,id').all(u.agency_id).filter(person=>projectVisible(db,person,project)).map(({id,name})=>({id,name}));
}
export function validateMembers(db,u,project,ids) {
 assert(Array.isArray(ids)&&ids.length<=100&&new Set(ids).size===ids.length,'Проверьте участников');const allowed=new Set(members(db,u,project).map(x=>x.id));
 assert(ids.every(id=>allowed.has(id)),'Участник больше не имеет доступа к проекту',409);return ids;
}
export function visible(db,u,row,section,action='read') {
 if(row.deleted||!can(db,u,action,row.project_id,section,row.id)) return null;
 const data=Object.fromEntries(Object.entries(row.data).filter(([key])=>can(db,u,action,row.project_id,section,row.id,key)));
 return {...row,data};
}
export function listPage(rows,{offset=0,limit=50}={}) {
 offset=Number(offset);limit=Number(limit);assert(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=200,'Проверьте страницу');
 return {items:rows.slice(offset,offset+limit),total:rows.length,offset,limit,nextOffset:offset+limit<rows.length?offset+limit:null};
}
export function sectionRows(db,u,project,kind,section,query={}) {projectAccess(db,u,project);return listPage(entities(db,u.agency_id,project,kind).map(r=>visible(db,u,r,section)).filter(Boolean),query);}
export function timeZone(value='Europe/Moscow') {assert(typeof value==='string'&&value.length<=100,'Проверьте часовой пояс');try{new Intl.DateTimeFormat('en',{timeZone:value}).format();}catch{assert(false,'Неизвестный часовой пояс');}return value;}
export function addDays(value,count) {date(value,false);assert(Number.isInteger(count)&&Math.abs(count)<=36600,'Проверьте число дней');const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);}
export function localDate(instant=Date.now(),zone='Europe/Moscow') {return new Intl.DateTimeFormat('sv-SE',{timeZone:timeZone(zone),year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));}
export function localParts(instant,zone) {const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timeZone(zone),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
// Resolve wall-clock time explicitly, rejecting DST gaps and requiring an offset choice for folds.
export function zonedInstant(day,time,zone='Europe/Moscow',choice) {
 date(day,false);timeZone(zone);assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(time),'Проверьте время');
 const target=day+'T'+time;const center=Date.parse(target+':00Z'), offsets=new Set();
 for(const delta of [-172800000,-86400000,0,86400000,172800000]){const at=center+delta,p=localParts(at,zone);offsets.add(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`)-at);}
 const candidates=[...offsets].map(offset=>center-offset).filter(at=>{const p=localParts(at,zone);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`===target;}).sort((a,b)=>a-b);
 assert(candidates.length,'Это местное время не существует из-за перевода часов');
 assert(candidates.length===1||choice==='earlier'||choice==='later','Это время встречается дважды. Выберите первое или второе вхождение.',409,{candidates:candidates.map(n=>new Date(n).toISOString())});
 return new Date(candidates[choice==='later'?candidates.length-1:0]).toISOString();
}

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Fault, assert, change, entity, entities, insert, now, transaction, uid, version } from '../../db.mjs';
import { can, digest, requireAccess } from '../../auth.mjs';
import { validateRow } from '../../model.mjs';
import { addDays, currentUser, executeModule, projectAccess, scoped, zonedInstant } from '../common.mjs';

const RSVP = new Set(['unanswered','confirmed','declined','tentative']);
const SEMANTIC_KEYS = ['guestName','rsvpStatus','diet','allergies','transfer','accommodation','contact','comment','invitationStatus','seatingTable','seatIndex'];
const PUBLIC_SEMANTICS = ['guestName','rsvpStatus','diet','allergies','transfer','accommodation','contact','comment'];
const PROTECTED = new Set(['rsvpStatus','diet','allergies','transfer','accommodation','contact','comment','invitationStatus','seatingTable','seatIndex']);
const sha = value => createHash('sha256').update(value).digest('hex');
const rawToken = () => randomBytes(32).toString('base64url');
let guestHooks = { onRespond: null };
// Root installs a synchronous durable-outbox writer. It is called inside the RSVP transaction.
export function configureGuestHooks(hooks={}) {
  assert(!hooks.onRespond || typeof hooks.onRespond==='function','Некорректный обработчик гостей');
  guestHooks={onRespond:hooks.onRespond||null};
}
// `executeModule` persists command results for idempotent replay.  The root
// dispatcher must call this before persistence while returning the original
// result to the initial caller, so a one-time raw invitation token never
// lands in `commands` or in a replay response.
export function redactGuestCommandResult(operation, result) {
  if (!result || typeof result!=='object' || !['guestInvite.create','guestInvite.rotate'].includes(operation)) return result;
  const {token,...safe}=result;
  return safe;
}
const ms = value => typeof value === 'number' ? value : Date.parse(value);
const text = (value, label, max=2000, optional=true) => {
  if ((value === undefined || value === null || value === '') && optional) return '';
  assert(typeof value === 'string' && value.trim().length && value.length <= max, `${label}: проверьте текст`);
  return value.trim();
};
const integer = (value, label, min, max) => { const n=Number(value); assert(Number.isInteger(n)&&n>=min&&n<=max,`${label}: недопустимое значение`); return n; };
const finite = (value,label,min,max) => { const n=Number(value); assert(Number.isFinite(n)&&n>=min&&n<=max,`${label}: недопустимое значение`); return n; };

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guest_invites(
      id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, agency_id TEXT NOT NULL, project_id TEXT NOT NULL,
      guest_table_id TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at TEXT, created_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS guest_invites_scope ON guest_invites(agency_id,project_id,guest_table_id);
    CREATE TABLE IF NOT EXISTS guest_invite_rows(invite_id TEXT NOT NULL, guest_row_id TEXT NOT NULL, is_plus_one INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(invite_id,guest_row_id));
    CREATE TABLE IF NOT EXISTS guest_sessions(digest TEXT PRIMARY KEY, invite_id TEXT NOT NULL, expires_at INTEGER NOT NULL, invite_version INTEGER NOT NULL, csrf_digest TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS guest_sessions_invite ON guest_sessions(invite_id);
    CREATE TABLE IF NOT EXISTS guest_commands(invite_id TEXT NOT NULL, command_id TEXT NOT NULL, payload_digest TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(invite_id,command_id));
  `);
}

function table(db,u,id,project) { const t=scoped(db,u,id,project,'table'); assert(t.data.key==='guests'||t.data.semanticMap,'Выберите реестр гостей'); return t; }
function rows(db, agency, project, tableId, deleted=false) { return entities(db,agency,project,'row',deleted).filter(row=>row.parent_id===tableId); }
function mapping(t) { const map=t.data.semanticMap||{}; return map; }
function column(t,id) { return t.data.columns.find(c=>c.id===id); }
function mappingValue(map,key) { return typeof map[key]==='string'&&map[key] ? map[key] : null; }
function publicMappedFields(map) { return PUBLIC_SEMANTICS.map(key=>mappingValue(map,key)).filter(Boolean); }
function semanticValue(map, key, row) {
  const id=mappingValue(map,key); if(!id) return undefined;
  if(key==='rsvpStatus') {
    const value=row.data[id];
    if(RSVP.has(value)) return value;
    for(const [status,label] of Object.entries(map.rsvpValues||{})) if(label===value) return status;
    if(value==='Подтвердил') return 'confirmed'; if(value==='Отказ') return 'declined'; if(value==='Пока не знает') return 'tentative';
    return 'unanswered';
  }
  return row.data[id];
}
function statusWrite(map,status) { return (map.rsvpValues&&map.rsvpValues[status]) || status; }
function mappedFields(map) { return new Set(SEMANTIC_KEYS.map(key=>mappingValue(map,key)).filter(Boolean)); }
function guestAudit(db, invite, row, before, action) {
  const hasActorType=new Set(db.prepare('PRAGMA table_info(audit)').all().map(x=>x.name)).has('actor_type');
  if(hasActorType) db.prepare('INSERT INTO audit(id,agency_id,project_id,actor_id,entity_id,kind,action,before_json,after_json,created_at,actor_type,actor_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid(),invite.agency_id,invite.project_id,'',row.id,row.kind,action,before?JSON.stringify(before):null,JSON.stringify(row),now(),'guest_invite',invite.id);
  else db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid(),invite.agency_id,invite.project_id,invite.id,row.id,row.kind,action,before?JSON.stringify(before):null,JSON.stringify(row),now());
}
function guestChange(db, invite, row, data, action) {
  db.prepare('UPDATE entities SET data=?,version=version+1,deleted=?,updated_at=? WHERE id=?').run(JSON.stringify(data),Number(row.deleted),now(),row.id);
  const saved=entity(db,row.id); guestAudit(db,invite,saved,row,action); return saved;
}
function requireEditableGuest(db,u,t,row,fields) {
  requireAccess(db,u,'edit',t.project_id,t.id,row.id,fields);
  projectAccess(db,u,t.project_id,'edit',t.id,row.id,fields);
}
function readableGuest(db,u,t,row,field) { return !!field&&can(db,u,'read',t.project_id,t.id,row.id,field); }
function safeGuestDto(db,u,t,map,row) {
  const data=Object.fromEntries(Object.entries(row.data).filter(([key])=>readableGuest(db,u,t,row,key)));
  const dto={id:row.id,version:row.version,data};
  if(readableGuest(db,u,t,row,mappingValue(map,'rsvpStatus'))) dto.rsvp=semanticValue(map,'rsvpStatus',row);
  if(readableGuest(db,u,t,row,mappingValue(map,'seatingTable'))) dto.tableId=semanticValue(map,'seatingTable',row)||null;
  if(readableGuest(db,u,t,row,mappingValue(map,'seatIndex'))) dto.seatIndex=semanticValue(map,'seatIndex',row)||null;
  return dto;
}
function microsite(db,agency,project,shareId) {
  const list=entities(db,agency,project,'microsite');
  const found=shareId?list.find(x=>x.data.shareId===shareId):list[0];
  assert(found&&found.data.status==='published'&&found.data.publishedRevisionId,'Страница сейчас недоступна',404);
  publishedRevision(db,found,agency,project);
  return found;
}
function publishedRevision(db,site,agency=site.agency_id,project=site.project_id) {
  const revision=entity(db,site.data.publishedRevisionId);
  assert(revision&&!revision.deleted&&revision.agency_id===agency&&revision.project_id===project&&revision.kind==='micrositeRevision'&&revision.parent_id===site.id,'Страница сейчас недоступна',404);
  return revision;
}
function publicRsvpFields(db,site) {
  const display=publishedRevision(db,site).data.displayFields||{};
  return {meal:display.mealEnabled===true,transport:display.transportEnabled===true};
}
function activeInvite(db, invite, shareId) {
  assert(invite&&!invite.revoked_at&&invite.expires_at>Date.now(),'Ссылка недействительна',404);
  assert(typeof shareId==='string'&&shareId.length>=16,'Ссылка недействительна',404);
  const project=entity(db,invite.project_id);assert(project&&!project.deleted,'Ссылка недействительна',404);
  const site=microsite(db,invite.agency_id,invite.project_id,shareId);
  assert(!site.data.closesAt || ms(site.data.closesAt)>Date.now(),'Страница сейчас недоступна',404);
  return site;
}
function publicRows(db,invite,enabled={meal:false,transport:false}) {
  const t=entity(db,invite.guest_table_id);assert(t&&!t.deleted,'Состав приглашения больше недоступен',404);
  const allowed=new Map(db.prepare('SELECT guest_row_id,is_plus_one FROM guest_invite_rows WHERE invite_id=?').all(invite.id).map(x=>[x.guest_row_id,!!x.is_plus_one])),map=mapping(t);
  const fields={name:'guestName',rsvp:'rsvpStatus',diet:'diet',allergies:'allergies',transfer:'transfer',accommodation:'accommodation',contact:'contact',comment:'comment'};
  return rows(db,invite.agency_id,invite.project_id,t.id).filter(row=>allowed.has(row.id)).map(row=>({id:row.id,version:row.version,isPlusOne:allowed.get(row.id),...Object.fromEntries(Object.entries(fields).filter(([key,field])=>mappingValue(map,field)&&(!['diet','allergies'].includes(key)||enabled.meal)&&(key!=='transfer'||enabled.transport)).map(([key,field])=>[key,semanticValue(map,field,row)||'']))}));
}

function canRespond(site,invite,session,zone='Europe/Moscow') {
  if(!site.data.rsvpDeadline) return false;
  const end = new Date(`${site.data.rsvpDeadline}T12:00:00Z`); end.setUTCDate(end.getUTCDate()+1);
  // The date string describes a project day.  Intl gives the local next-day boundary without device time-zone dependence.
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now()));
  const today=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const local=`${today.year}-${today.month}-${today.day}`;
  return local<=site.data.rsvpDeadline && invite.expires_at>Date.now() && session.expires_at>Date.now();
}
function ensurePlan(db,u,project,planId) { const p=scoped(db,u,planId,project,'seatingPlan'); assert(!p.deleted,'План удалён'); return p; }
function seatingTables(db,u,project,plan) { return entities(db,u.agency_id,project,'seatingTable').filter(x=>x.parent_id===plan.id); }
function checkBounds(plan,d) { const rad=(d.rotationDeg||0)*Math.PI/180,c=Math.abs(Math.cos(rad)),s=Math.abs(Math.sin(rad)),w=d.shape==='round'?Math.hypot(d.widthM*c,d.heightM*s):d.widthM*c+d.heightM*s,h=d.shape==='round'?Math.hypot(d.widthM*s,d.heightM*c):d.widthM*s+d.heightM*c,cx=d.xM+d.widthM/2,cy=d.yM+d.heightM/2;assert(cx-w/2>=-1e-9&&cy-h/2>=-1e-9&&cx+w/2<=plan.data.widthM+1e-9&&cy+h/2<=plan.data.heightM+1e-9,'Стол выходит за границы зала',409); }
function tableData(d,plan) {
  const shape=['round','rect'].includes(d.shape)?d.shape:'round'; const capacity=integer(d.capacity,'Вместимость',1,30);
  const out={label:text(d.label,'Название',120,false),shape,xM:finite(d.xM,'X',0,1000),yM:finite(d.yM,'Y',0,1000),widthM:finite(d.widthM??(shape==='round'?1.6:2),'Ширина',.4,20),heightM:finite(d.heightM??(shape==='round'?1.6:1.2),'Высота',.4,20),rotationDeg:finite(d.rotationDeg??0,'Поворот',-360,360),capacity}; checkBounds(plan,out); return out;
}
function assignments(db,agency,project,t,map) { const tableId=mappingValue(map,'seatingTable'),seatId=mappingValue(map,'seatIndex'); if(!tableId||!seatId)return[]; return rows(db,agency,project,t.id).filter(row=>row.data[tableId]).map(row=>({row,tableId:row.data[tableId],seatIndex:row.data[seatId]})); }

export function validateGuestSchemaMutation(before, after, {confirm=false,disabled=[]}={}) {
  const oldMap=mapping(before), newMap=mapping(after), protectedIds=mappedFields(oldMap);
  if(!protectedIds.size) return {ok:true};
  const oldCols=new Map((before.data.columns||[]).map(c=>[c.id,c])); const newCols=new Map((after.data.columns||[]).map(c=>[c.id,c]));
  const impacts=[];
  const statusColumn=newCols.get(newMap.rsvpStatus);if(statusColumn?.type==='select'&&Object.values(newMap.rsvpValues||{}).some(value=>!statusColumn.options.includes(value)))return {ok:false,code:'guestMappingRebindRequired',impacts:[{id:newMap.rsvpStatus,semantic:'rsvpStatus'}]};
  for(const id of protectedIds) if(!newCols.has(id)||newCols.get(id).type!==oldCols.get(id)?.type) impacts.push({id,semantic:SEMANTIC_KEYS.find(k=>oldMap[k]===id)});
  if(impacts.length&&!confirm) return {ok:false,code:'guestMappingRebindRequired',impacts};
  const explicitlyDisabled=new Set(Array.isArray(disabled)?disabled:[]);
  for(const key of SEMANTIC_KEYS) if(oldMap[key]&&oldMap[key]!==newMap[key]) {
    if(!confirm || (!newMap[key]&&!explicitlyDisabled.has(key))) return {ok:false,code:'guestMappingRebindRequired',impacts:[{id:oldMap[key],semantic:key}]};
  }
  return {ok:true,impacts};
}
export function validateGuestRowMutation(t, before, next, changedKeys, {specialized=false}={}) {
  const m=mapping(t),protectedIds=new Set(['rsvpStatus','seatingTable','seatIndex'].map(key=>mappingValue(m,key)).filter(Boolean));
  const attempted=(changedKeys||Object.keys(next||{})).filter(k=>protectedIds.has(k));
  assert(specialized||!attempted.length,'Это поле меняется через RSVP или рассадку',409,{code:'guestMappedFieldProtected',fields:attempted});
  return true;
}

function authorizeMapping(db,u,c) { const t=table(db,u,c.guestTableId||c.entityId,c.projectId); projectAccess(db,u,c.projectId,'structure',t.id); }
function runMapping(db,u,c) {
  const t=table(db,u,c.guestTableId||c.entityId,c.projectId); version(t,c.schemaVersion??c.version);
  const input=c.data?.semanticMap||c.semanticMap; assert(input&&typeof input==='object'&&!Array.isArray(input),'Передайте сопоставление полей');
  const disableAll=input.disable===true, disableInput=disableAll?SEMANTIC_KEYS:(input.disable||[]);
  const disabled=new Set(disableInput); assert(Array.isArray(disableInput)&&[...disabled].every(key=>SEMANTIC_KEYS.includes(key)),'Некорректное отключение поля');
  assert(disableAll?c.confirm===true:!disabled.has('guestName')&&!disabled.has('rsvpStatus'),'Имя и RSVP нельзя отключить без полного отключения RSVP');
  const oldMap=mapping(t), next={...t.data,semanticMap:{}};
  for(const key of SEMANTIC_KEYS) {
    const supplied=Object.hasOwn(input,key);
    if(disabled.has(key)) { assert(c.confirm===true&&!input[key],'Отключение поля требует явного подтверждения',409,{key}); continue; }
    const selected=supplied?input[key]:oldMap[key];
    assert(!supplied||typeof selected==='string','Некорректное сопоставление поля',409,{key});
    if(selected) { assert(column(t,selected),'Выбрана отсутствующая колонка',409,{key}); next.semanticMap[key]=selected; }
  }
  if(!disableAll) {
    assert(next.semanticMap.guestName&&next.semanticMap.rsvpStatus,'Укажите имя и статус RSVP');
    const rsvpColumn=column(t,next.semanticMap.rsvpStatus); assert(['text','select'].includes(rsvpColumn.type),'Статус RSVP должен быть текстом или списком');
    if(next.semanticMap.seatingTable) assert(column(t,next.semanticMap.seatingTable).type==='relation','Стол должен быть связанной колонкой');
    if(next.semanticMap.seatIndex) assert(['number','text'].includes(column(t,next.semanticMap.seatIndex).type),'Номер места должен быть числом или текстом');
    assert(Boolean(next.semanticMap.seatingTable)===Boolean(next.semanticMap.seatIndex),'Стол и номер места подключаются или отключаются вместе',409);
    const bound=SEMANTIC_KEYS.map(key=>next.semanticMap[key]).filter(Boolean);assert(new Set(bound).size===bound.length,'Для каждого поля выберите отдельную колонку');
    for(const key of PUBLIC_SEMANTICS.filter(key=>key!=='rsvpStatus'))if(next.semanticMap[key])assert(column(t,next.semanticMap[key]).type==='text','Для имени и дополнительных ответов выберите текстовые колонки');
    const defaults={unanswered:'Нет ответа',confirmed:'Подтвердил',declined:'Отказ',tentative:'Пока не знает'};
    if(rsvpColumn.type==='select'){if(!rsvpColumn.options.includes(defaults.unanswered)&&rsvpColumn.options.includes('Не отправлено'))defaults.unanswered='Не отправлено';if(!rsvpColumn.options.includes(defaults.tentative)&&rsvpColumn.options.includes('Приглашён'))defaults.tentative='Приглашён';}
    next.semanticMap.rsvpValues={...defaults,...(oldMap.rsvpValues||{}),...(input.rsvpValues||{})};
    const values=[...RSVP].map(key=>next.semanticMap.rsvpValues[key]);assert(values.every(value=>typeof value==='string'&&value.length>0&&value.length<=100)&&new Set(values).size===4,'Укажите четыре разных значения RSVP');if(rsvpColumn.type==='select')assert(values.every(value=>rsvpColumn.options.includes(value)),'Сопоставьте статусы RSVP с вариантами выбранной колонки');
  }
  const guard=validateGuestSchemaMutation(t,{...t,data:next},{confirm:c.confirm===true,disabled:[...disabled]}); assert(guard.ok,'Изменение подключённого поля требует перепривязки или отключения RSVP',409,guard);
  if(disableAll) {
    const inviteIds=db.prepare('SELECT id FROM guest_invites WHERE agency_id=? AND project_id=? AND guest_table_id=?').all(u.agency_id,c.projectId,t.id).map(row=>row.id);
    db.prepare('UPDATE guest_invites SET revoked_at=?,version=version+1 WHERE agency_id=? AND project_id=? AND guest_table_id=? AND revoked_at IS NULL').run(now(),u.agency_id,c.projectId,t.id);
    for(const inviteId of inviteIds) db.prepare('DELETE FROM guest_sessions WHERE invite_id=?').run(inviteId);
  }
  return change(db,u,t,next,false,'guest_mapping_save');
}
function selectedInviteRows(db,u,t,c) {
  const ids=c.guestRowIds; assert(Array.isArray(ids)&&ids.length>=1&&ids.length<=100&&new Set(ids).size===ids.length,'Выберите от 1 до 100 гостей');
  const available=new Map(rows(db,u.agency_id,c.projectId,t.id).map(r=>[r.id,r])); assert(ids.every(id=>available.has(id)),'В приглашении есть недоступная строка',404);
  const fields=publicMappedFields(mapping(t));
  for(const id of ids) requireAccess(db,u,'manageGuestInvites',c.projectId,t.id,id,fields);
  const plus=new Set(c.plusOneRowIds||[]); assert([...plus].every(id=>ids.includes(id)),'Дополнительный гость должен быть в составе приглашения');
  return {ids,available};
}
function authorizeInvite(db,u,c) { const t=table(db,u,c.guestTableId,c.projectId); version(t,c.schemaVersion); requireAccess(db,u,'manageGuestInvites',c.projectId,t.id); selectedInviteRows(db,u,t,c); }
function storedInvite(db,u,c) {
  const invite=db.prepare('SELECT * FROM guest_invites WHERE id=? AND agency_id=? AND project_id=?').get(c.entityId||c.inviteId,u.agency_id,c.projectId);
  assert(invite,'Приглашение не найдено',404);
  const t=table(db,u,invite.guest_table_id,c.projectId); requireAccess(db,u,'manageGuestInvites',c.projectId,t.id);
  const ids=db.prepare('SELECT guest_row_id,is_plus_one FROM guest_invite_rows WHERE invite_id=?').all(invite.id);
  selectedInviteRows(db,u,t,{...c,guestRowIds:ids.map(row=>row.guest_row_id),plusOneRowIds:ids.filter(row=>row.is_plus_one).map(row=>row.guest_row_id)});
  return {invite,t,ids};
}
function authorizeStoredInvite(db,u,c) { storedInvite(db,u,c); }
function createInvite(db,u,c,rotateFrom=null) {
  const t=table(db,u,c.guestTableId,c.projectId); version(t,c.schemaVersion);
  const {ids,available}=selectedInviteRows(db,u,t,c);
  const site=microsite(db,u.agency_id,c.projectId); assert(site.data.shareId,'Сначала сохраните сайт свадьбы',409);
  const project=entity(db,c.projectId),zone=project?.data.timeZone||'Europe/Moscow';
  const expiry=c.expiresAt?ms(c.expiresAt):Date.parse(zonedInstant(addDays(project.data.date,8),'00:00',zone))-1; assert(Number.isFinite(expiry)&&expiry>Date.now()&&expiry<=Date.now()+3660*86400000,'Укажите будущий срок ссылки');
  if(rotateFrom) { db.prepare('UPDATE guest_invites SET revoked_at=?,version=version+1 WHERE id=? AND agency_id=?').run(now(),rotateFrom.id,u.agency_id); db.prepare('DELETE FROM guest_sessions WHERE invite_id=?').run(rotateFrom.id); }
  const token=rawToken(),invite={id:uid(),digest:sha(token),agency_id:u.agency_id,project_id:c.projectId,guest_table_id:t.id,expires_at:expiry,created_by:u.id,version:1};
  db.prepare('INSERT INTO guest_invites(id,digest,agency_id,project_id,guest_table_id,expires_at,revoked_at,created_by,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(invite.id,invite.digest,invite.agency_id,invite.project_id,invite.guest_table_id,invite.expires_at,null,invite.created_by,1,now());
  const plus=new Set(c.plusOneRowIds||[]);
  const st=db.prepare('INSERT INTO guest_invite_rows(invite_id,guest_row_id,is_plus_one) VALUES(?,?,?)'); for(const id of ids) st.run(invite.id,id,Number(plus.has(id)));
  return {inviteId:invite.id,version:1,token,shareId:site.data.shareId,expiresAt:new Date(expiry).toISOString(),affected:ids.map(id=>({id,version:available.get(id).version}))};
}
function revokeInvite(db,u,c) { const {invite}=storedInvite(db,u,c); assert(!invite.revoked_at,'Ссылка уже отозвана',409); assert(c.version===undefined||Number(c.version)===invite.version,'Ссылка уже изменилась',409); db.prepare('UPDATE guest_invites SET revoked_at=?,version=version+1 WHERE id=?').run(now(),invite.id);db.prepare('DELETE FROM guest_sessions WHERE invite_id=?').run(invite.id);return {inviteId:invite.id,revoked:true}; }
function rotateInvite(db,u,c) { const {invite:old,ids}=storedInvite(db,u,c);assert(!old.revoked_at&&old.version===c.version,'Ссылка уже изменилась',409); return createInvite(db,u,{...c,guestTableId:old.guest_table_id,guestRowIds:ids.map(x=>x.guest_row_id),plusOneRowIds:ids.filter(x=>x.is_plus_one).map(x=>x.guest_row_id),schemaVersion:c.schemaVersion},old); }

function authorizePlan(db,u,c) { projectAccess(db,u,c.projectId,'edit','seating'); }
function seatAssignmentState(db,u,c,{nextData}={}) {
  authorizePlan(db,u,c);
  const guest=table(db,u,c.guestTableId,c.projectId),map=mapping(guest),tableField=mappingValue(map,'seatingTable'),seatField=mappingValue(map,'seatIndex');
  assert(tableField&&seatField,'Сначала подключите поля рассадки',409); version(guest,c.schemaVersion);
  const row=scoped(db,u,c.guestRowId,c.projectId,'row'); assert(row.parent_id===guest.id,'Гость не из этого реестра',409); version(row,c.rowVersion);
  requireEditableGuest(db,u,guest,row,[tableField,seatField]);
  assert(c.tableId&&c.tableVersion!==undefined,'Для назначения укажите стол и его актуальную версию',409);
  const target=scoped(db,u,c.tableId,c.projectId,'seatingTable'); version(target,c.tableVersion);
  const plan=ensurePlan(db,u,c.projectId,target.parent_id); assert(guest.id===plan.data.guestTableId||!plan.data.guestTableId,'План связан с другим реестром',409);
  const rsvp=semanticValue(map,'rsvpStatus',{data:nextData||row.data}); assert(rsvp!=='declined','Нельзя посадить отказавшегося гостя',409);
  assert(rsvp==='confirmed'||c.confirmNonConfirmed===true,'Подтвердите посадку гостя без подтверждённого RSVP',409,{code:'nonConfirmedSeatConfirmation',rowId:row.id,rsvp});
  const seat=integer(c.seatIndex,'Место',1,target.data.capacity),used=assignments(db,u.agency_id,c.projectId,guest,map);
  assert(!used.some(x=>x.row.id!==row.id&&x.tableId===target.id&&Number(x.seatIndex)===seat),'Это место уже занято',409);
  return {guest,map,row,target,tableField,seatField,seat};
}
function authorizeSeatMutation(db,u,c) {authorizePlan(db,u,c);const t=table(db,u,c.guestTableId,c.projectId),row=scoped(db,u,c.guestRowId,c.projectId,'row'),m=mapping(t);assert(row.parent_id===t.id,'Гость не из этого реестра',404);requireEditableGuest(db,u,t,row,[m.seatingTable,m.seatIndex]);if(c.tableId){const target=scoped(db,u,c.tableId,c.projectId,'seatingTable');requireAccess(db,u,'read',c.projectId,'seating',target.id,null);}}
function authorizeRsvp(db,u,c) { const t=table(db,u,c.guestTableId,c.projectId),row=scoped(db,u,c.guestRowId,c.projectId,'row'),map=mapping(t),values=c.data?.values||c.values||{};assert(row.parent_id===t.id,'Гость не из этого реестра',404);const semantic={rsvp:'rsvpStatus',diet:'diet',allergies:'allergies',transfer:'transfer',accommodation:'accommodation',contact:'contact',comment:'comment'};const fields=Object.keys(values).map(key=>mappingValue(map,semantic[key])).filter(Boolean);requireEditableGuest(db,u,t,row,fields); }
function planData(data) {
 const result={name:text(data.name||'План рассадки','Название',120,false),widthM:finite(data.widthM,'Ширина зала',2,100),heightM:finite(data.heightM,'Высота зала',2,100),scale:finite(data.scale??1,'Масштаб',.1,10),guestTableId:data.guestTableId||null};
 assert(!data.zones||Array.isArray(data.zones)&&data.zones.length<=50,'Не более 50 зон');
 result.zones=(data.zones||[]).map(z=>{assert(z&&typeof z==='object','Проверьте зону');const zone={id:z.id?text(z.id,'Зона',100,false):uid(),label:text(z.label||'Зона','Название зоны',120,false),xM:finite(z.xM??0,'X зоны',0,100),yM:finite(z.yM??0,'Y зоны',0,100),widthM:finite(z.widthM??1,'Ширина зоны',.1,100),heightM:finite(z.heightM??1,'Высота зоны',.1,100),rotationDeg:finite(z.rotationDeg??0,'Поворот зоны',-360,360)};checkBounds({data:result},{...zone,shape:'rect'});return zone;});
 assert(new Set(result.zones.map(z=>z.id)).size===result.zones.length,'Зоны должны иметь разные идентификаторы');return result;
}
function savePlan(db,u,c) { let p=c.entityId?scoped(db,u,c.entityId,c.projectId,'seatingPlan'):null; if(p){version(p,c.version); const next=planData({...p.data,...c.data}); for(const t of seatingTables(db,u,c.projectId,p)) checkBounds({data:next},t.data); return change(db,u,p,next,false,'seating_plan_save');} return insert(db,u,'seatingPlan',planData(c.data),c.projectId); }
function createTable(db,u,c) { const p=ensurePlan(db,u,c.projectId,c.planId); version(p,c.planVersion); const d=tableData(c.data,p); assert(!seatingTables(db,u,c.projectId,p).some(t=>t.data.label===d.label),'Такой стол уже есть',409); return insert(db,u,'seatingTable',d,c.projectId,p.id); }
function createMany(db,u,c) { const p=ensurePlan(db,u,c.projectId,c.planId);version(p,c.planVersion);assert(Array.isArray(c.tables)&&c.tables.length>=1&&c.tables.length<=20,'Можно создать от 1 до 20 столов');const existing=new Set(seatingTables(db,u,c.projectId,p).map(t=>t.data.label));const prepared=c.tables.map(item=>tableData(item,p));assert(new Set(prepared.map(x=>x.label)).size===prepared.length&&prepared.every(x=>!existing.has(x.label)),'Повторяются названия столов');return {items:prepared.map(d=>insert(db,u,'seatingTable',d,c.projectId,p.id)),affected:[{id:p.id,version:p.version}]}; }
function editTable(db,u,c) { const t=scoped(db,u,c.entityId,c.projectId,'seatingTable');version(t,c.version);const p=ensurePlan(db,u,c.projectId,t.parent_id);const next=tableData({...t.data,...c.data},p);const guest=table(db,u,c.guestTableId||p.data.guestTableId,c.projectId),map=mapping(guest),used=assignments(db,u.agency_id,c.projectId,guest,map).filter(x=>x.tableId===t.id);assert(used.length<=next.capacity,'Нельзя уменьшить вместимость: сначала пересадьте гостей',409,{code:'capacityBelowOccupants',rows:used.map(x=>({id:x.row.id,version:x.row.version}))});return change(db,u,t,next,false,'seating_table_edit'); }
function deleteTable(db,u,c) { const t=scoped(db,u,c.entityId,c.projectId,'seatingTable'),p=ensurePlan(db,u,c.projectId,t.parent_id);version(t,c.version);const guest=table(db,u,c.guestTableId||p.data.guestTableId,c.projectId),map=mapping(guest),used=assignments(db,u.agency_id,c.projectId,guest,map).filter(x=>x.tableId===t.id);if(used.length&&!c.confirmUnassign) assert(false,'Сначала подтвердите снятие гостей со стола',409,{code:'requiresUnassignConfirmation',rows:used.map(x=>({id:x.row.id,version:x.row.version}))});if(used.length){assert(Array.isArray(c.rows)&&used.every(x=>c.rows.some(r=>r.id===x.row.id&&r.version===x.row.version)),'Список назначений изменился',409);for(const x of used){const next={...x.row.data,[mappingValue(map,'seatingTable')]:'',[mappingValue(map,'seatIndex')]:''};change(db,u,x.row,next,false,'seating_unassign');}}return change(db,u,t,t.data,true,'seating_table_delete'); }
function assignSeat(db,u,c) { const {row,tableField,seatField,target,seat}=seatAssignmentState(db,u,c);return change(db,u,row,{...row.data,[tableField]:target.id,[seatField]:seat},false,'seating_assign'); }
function unassignSeat(db,u,c) { const guest=table(db,u,c.guestTableId,c.projectId),map=mapping(guest),row=scoped(db,u,c.guestRowId,c.projectId,'row');version(guest,c.schemaVersion);version(row,c.rowVersion);const tableField=mappingValue(map,'seatingTable'),seatField=mappingValue(map,'seatIndex');assert(tableField&&seatField,'Сначала подключите поля рассадки',409);requireEditableGuest(db,u,guest,row,[tableField,seatField]);return change(db,u,row,{...row.data,[tableField]:'',[seatField]:''},false,'seating_unassign'); }
function guestRowEditState(db,u,c) {
  const t=table(db,u,c.guestTableId,c.projectId),map=mapping(t),row=scoped(db,u,c.guestRowId,c.projectId,'row');
  version(t,c.schemaVersion); version(row,c.rowVersion); assert(row.parent_id===t.id,'Гость не из этого реестра',404);
  const patch=c.data; assert(patch&&typeof patch==='object'&&!Array.isArray(patch),'Передайте изменённые ячейки');
  const keys=Object.keys(patch); assert(keys.length>0&&keys.every(key=>column(t,key)),'Колонка удалена или недоступна',409);
  const rsvpField=mappingValue(map,'rsvpStatus'),tableField=mappingValue(map,'seatingTable'),seatField=mappingValue(map,'seatIndex');
  const next={...row.data,...patch};
  if(rsvpField&&Object.hasOwn(patch,rsvpField)) { assert(RSVP.has(patch[rsvpField]),'Выберите RSVP: confirmed, declined или tentative'); next[rsvpField]=statusWrite(map,patch[rsvpField]); }
  const hasTable=!!tableField&&Object.hasOwn(patch,tableField),hasSeat=!!seatField&&Object.hasOwn(patch,seatField);
  assert(hasTable===hasSeat,'Стол и место меняются одной командой',409);
  let assignSeatRequested=false;
  if(hasTable) {
    const clear=[null,''].includes(patch[tableField])&&[null,''].includes(patch[seatField]);
    assert(clear||(![null,''].includes(patch[tableField])&&![null,''].includes(patch[seatField])),'Для снятия назначения очистите стол и место вместе',409);
    if(clear) { next[tableField]=null; next[seatField]=null; }
    else assignSeatRequested=true;
  }
  if(semanticValue(map,'rsvpStatus',{data:next})==='declined'&&tableField&&seatField) { next[tableField]=null; next[seatField]=null; assignSeatRequested=false; }
  const changed=Object.keys(next).filter(key=>next[key]!==row.data[key]), accessFields=new Set(keys);
  if(semanticValue(map,'rsvpStatus',{data:next})==='declined') { if(tableField) accessFields.add(tableField); if(seatField) accessFields.add(seatField); }
  for(const field of accessFields) { requireAccess(db,u,'read',c.projectId,t.id,row.id,field); requireEditableGuest(db,u,t,row,[field]); }
  const assignment=assignSeatRequested?seatAssignmentState(db,u,{...c,tableId:patch[tableField],seatIndex:patch[seatField]}, {nextData:next}):null;
  validateGuestRowMutation(t,row,next,changed,{specialized:true}); validateRow(db,u,t,next,changed);
  return {t,row,next,changed,assignment};
}
function authorizeGuestRowEdit(db,u,c) {const t=table(db,u,c.guestTableId,c.projectId),row=scoped(db,u,c.guestRowId,c.projectId,'row');assert(row.parent_id===t.id,'Гость не из этого реестра',404);const fields=Object.keys(c.data||{});requireEditableGuest(db,u,t,row,fields);requireAccess(db,u,'read',c.projectId,t.id,row.id,fields);if([mapping(t).seatingTable,mapping(t).seatIndex].some(key=>fields.includes(key)))authorizePlan(db,u,c);}
function guestRowEdit(db,u,c) { const {row,next}=guestRowEditState(db,u,c); return change(db,u,row,next,false,'guest_row_edit'); }
function setGuestRsvp(db,u,c) { const t=table(db,u,c.guestTableId,c.projectId),map=mapping(t),row=scoped(db,u,c.guestRowId,c.projectId,'row');version(t,c.schemaVersion);version(row,c.rowVersion);const allowed=['rsvp','diet','allergies','transfer','accommodation','contact','comment'];const values=c.data?.values||c.values;assert(values&&typeof values==='object','Передайте значения RSVP');const next={...row.data};for(const [key,value] of Object.entries(values)){assert(allowed.includes(key),'Поле RSVP недоступно',403);const semantic={rsvp:'rsvpStatus',diet:'diet',allergies:'allergies',transfer:'transfer',accommodation:'accommodation',contact:'contact',comment:'comment'}[key];const field=mappingValue(map,semantic);assert(field,'Поле не сопоставлено',409);requireEditableGuest(db,u,t,row,[field]);if(key==='rsvp'){assert(RSVP.has(value),'Выберите статус');next[field]=statusWrite(map,value);}else next[field]=text(value,key==='allergies'?'Ограничения':key,key==='comment'?2000:key==='allergies'?1000:1000,true);}if(semanticValue(map,'rsvpStatus',{data:next})==='declined'&&mappingValue(map,'seatingTable')){next[mappingValue(map,'seatingTable')]='';next[mappingValue(map,'seatIndex')]='';}validateRow(db,u,t,next,Object.keys(next).filter(key=>next[key]!==row.data[key]));return change(db,u,row,next,false,'guest_rsvp_set'); }
export function legacySeatingPreview(db,user,projectId,guestTableId,columnId) { const u=currentUser(db,user),t=table(db,u,guestTableId,projectId),selectedColumn=column(t,columnId);projectAccess(db,u,projectId,'read',t.id);assert(readableGuest(db,u,t,{id:null},columnId)||can(db,u,'read',projectId,t.id,undefined,columnId),'Нет доступа к старой колонке',403);assert(selectedColumn&&['text','select'].includes(selectedColumn.type),'Выберите текстовую колонку старого стола');const groups=new Map();for(const row of rows(db,u.agency_id,projectId,t.id)){if(!can(db,u,'read',projectId,t.id,row.id,columnId))continue;const value=typeof row.data[columnId]==='string'?row.data[columnId].trim():'';if(!value)continue;const group=groups.get(value)||{sourceValue:value,rowIds:[],originalValues:[]};group.rowIds.push(row.id);group.originalValues.push({rowId:row.id,version:row.version,value});groups.set(value,group)}return {guestTableId:t.id,schemaVersion:t.version,columnId,groups:[...groups.values()]}; }
function legacyImportState(db,u,c) {
  const t=table(db,u,c.guestTableId,c.projectId),map=mapping(t),plan=ensurePlan(db,u,c.projectId,c.planId);
  version(t,c.schemaVersion); version(plan,c.planVersion);
  const preview=legacySeatingPreview(db,u,c.projectId,t.id,c.columnId),seatTable=mappingValue(map,'seatingTable'),seatIndex=mappingValue(map,'seatIndex');
  assert(seatTable&&seatIndex,'Сначала подключите поля рассадки',409);
  assert(Array.isArray(c.tables)&&c.tables.length===preview.groups.length,'Подтвердите вместимость каждого старого стола');
  const listed=new Map(c.tables.map(x=>[x.sourceValue,x])); assert(listed.size===c.tables.length&&preview.groups.every(group=>listed.has(group.sourceValue)),'Не хватает подтверждения вместимости');
  assert(Array.isArray(c.rowVersions),'Передайте актуальные версии всех строк',409);
  const expected=preview.groups.flatMap(group=>group.originalValues), supplied=new Map(c.rowVersions.map(item=>[item?.id,item?.version]));
  assert(supplied.size===c.rowVersions.length&&expected.length===supplied.size&&expected.every(item=>supplied.has(item.rowId)),'Передайте актуальные версии всех строк',409);
  const pending=[];
  for(const item of expected) {
    const row=scoped(db,u,item.rowId,c.projectId,'row'); assert(row.parent_id===t.id,'Гость не из этого реестра',404); version(row,supplied.get(row.id));
    requireAccess(db,u,'read',c.projectId,t.id,row.id,c.columnId); requireEditableGuest(db,u,t,row,[seatTable,seatIndex]);
    assert(!row.data[seatTable]&&!row.data[seatIndex],'У гостя уже есть место; сначала пересадьте или снимите назначение',409,{code:'legacySeatAlreadyAssigned',rowId:row.id,version:row.version});
    const status=semanticValue(map,'rsvpStatus',row); assert(status!=='declined','Нельзя посадить отказавшегося гостя',409,{rowId:row.id});
    if(status!=='confirmed') pending.push(row.id);
  }
  assert(!pending.length||c.confirmNonConfirmed===true,'Подтвердите импорт гостей без подтверждённого RSVP',409,{code:'legacyNonConfirmedConfirmation',rowIds:pending});
  return {t,map,plan,preview,seatTable,seatIndex,listed};
}
function authorizeLegacyImport(db,u,c) { authorizePlan(db,u,c); legacyImportState(db,u,c); }
function importLegacy(db,u,c) { const {plan,preview,seatTable,seatIndex,listed}=legacyImportState(db,u,c);const added=[];for(let i=0;i<preview.groups.length;i++){const group=preview.groups[i],spec=listed.get(group.sourceValue),capacity=integer(spec.capacity,'Вместимость',1,30);assert(capacity>=group.rowIds.length,'Вместимость меньше числа импортируемых гостей',409,{sourceValue:group.sourceValue});const d=tableData({label:text(spec.label||group.sourceValue,'Название',120,false),shape:spec.shape||'round',capacity,xM:spec.xM??.4+(i%4)*2,yM:spec.yM??.4+Math.floor(i/4)*2,widthM:spec.widthM??1.6,heightM:spec.heightM??1.6,rotationDeg:0},plan);added.push({group,table:insert(db,u,'seatingTable',d,c.projectId,plan.id)});}for(const item of added)for(const [index,rowId] of item.group.rowIds.entries()){const row=scoped(db,u,rowId,c.projectId,'row');change(db,u,row,{...row.data,[seatTable]:item.table.id,[seatIndex]:index+1},false,'seating_legacy_import');}return change(db,u,plan,{...plan.data,legacyImport:{columnId:c.columnId,importedAt:now(),originalValues:preview.groups.flatMap(x=>x.originalValues)}},false,'seating_legacy_import'); }

export const operations={
  'guestMapping.save':{authorize:authorizeMapping,run:runMapping},
  'guestInvite.create':{authorize:authorizeInvite,run:(db,u,c)=>createInvite(db,u,c)},
  'guestInvite.revoke':{authorize:authorizeStoredInvite,run:revokeInvite},
  'guestInvite.rotate':{authorize:authorizeStoredInvite,run:rotateInvite},
  'guest.row.edit':{authorize:authorizeGuestRowEdit,run:guestRowEdit},
  'guest.rsvp.set':{authorize:authorizeRsvp,run:setGuestRsvp},
  'seating.legacyImport':{authorize:authorizeLegacyImport,run:importLegacy},
  'seatingPlan.save':{authorize:authorizePlan,run:savePlan},
  'seatingTable.create':{authorize:authorizePlan,run:createTable},
  'seatingTable.createMany':{authorize:authorizePlan,run:createMany},
  'seatingTable.edit':{authorize:authorizePlan,run:editTable},
  'seatingTable.delete':{authorize:authorizePlan,run:deleteTable},
  'seating.assign':{authorize:authorizeSeatMutation,run:assignSeat},
  'seating.unassign':{authorize:authorizeSeatMutation,run:unassignSeat}
};
export const execute=(db,user,command)=>executeModule(db,user,command,operations);

export function guestList(db,user,projectId,guestTableId,query={}) { const u=currentUser(db,user),t=table(db,u,guestTableId,projectId),map=mapping(t);projectAccess(db,u,projectId,'read',t.id);const canInvitation=readableGuest(db,u,t,{id:undefined},mappingValue(map,'invitationStatus'));const invites=canInvitation?new Set(db.prepare('SELECT guest_row_id FROM guest_invite_rows ir JOIN guest_invites i ON i.id=ir.invite_id WHERE i.agency_id=? AND i.project_id=? AND i.revoked_at IS NULL AND i.expires_at>?').all(u.agency_id,projectId,Date.now()).map(x=>x.guest_row_id)):new Set();let items=rows(db,u.agency_id,projectId,t.id).filter(row=>can(db,u,'read',projectId,t.id,row.id)).map(row=>({...safeGuestDto(db,u,t,map,row),...(canInvitation?{invited:invites.has(row.id)}:{})}));if(query.rsvp) items=items.filter(item=>item.rsvp===query.rsvp);if(query.invited!==undefined){assert(canInvitation,'Нет доступа к статусу приглашения',403);items=items.filter(item=>item.invited===Boolean(query.invited));}const offset=integer(query.offset??0,'Смещение',0,100000),limit=integer(query.limit??50,'Размер страницы',1,200);return {items:items.slice(offset,offset+limit),total:items.length,offset,limit,nextOffset:offset+limit<items.length?offset+limit:null}; }
export function guestInvites(db,user,projectId,guestTableId) { const u=currentUser(db,user),t=table(db,u,guestTableId,projectId),fields=publicMappedFields(mapping(t));requireAccess(db,u,'manageGuestInvites',projectId,t.id);return db.prepare('SELECT id,expires_at,revoked_at,version,created_at FROM guest_invites WHERE agency_id=? AND project_id=? AND guest_table_id=? ORDER BY created_at DESC').all(u.agency_id,projectId,t.id).filter(invite=>{const ids=db.prepare('SELECT guest_row_id FROM guest_invite_rows WHERE invite_id=?').all(invite.id);return ids.length&&ids.every(row=>can(db,u,'manageGuestInvites',projectId,t.id,row.guest_row_id,fields));}).map(invite=>({...invite,guestCount:db.prepare('SELECT count(*) AS n FROM guest_invite_rows WHERE invite_id=?').get(invite.id).n,status:invite.revoked_at?'revoked':invite.expires_at<=Date.now()?'expired':'issued'})); }
export function seatingSnapshot(db,user,projectId,planId,query={}) { const u=currentUser(db,user),plan=ensurePlan(db,u,projectId,planId);projectAccess(db,u,projectId,'read','seating');const guest=table(db,u,plan.data.guestTableId,projectId),map=mapping(guest),nameField=mappingValue(map,'guestName'),rsvpField=mappingValue(map,'rsvpStatus'),seatField=mappingValue(map,'seatingTable'),readable=rows(db,u.agency_id,projectId,guest.id).filter(r=>can(db,u,'read',projectId,guest.id,r.id)),seatReadable=readable.filter(row=>readableGuest(db,u,guest,row,nameField)&&readableGuest(db,u,guest,row,seatField)),assigned=new Set(assignments(db,u.agency_id,projectId,guest,map).filter(x=>seatReadable.some(r=>r.id===x.row.id)).map(x=>x.row.id));const mayName=seatReadable.length>0;const unseated=seatReadable.filter(r=>!assigned.has(r.id)&&(!readableGuest(db,u,guest,r,rsvpField)||semanticValue(map,'rsvpStatus',r)!=='declined')).map(r=>({id:r.id,name:semanticValue(map,'guestName',r),...(readableGuest(db,u,guest,r,rsvpField)?{rsvp:semanticValue(map,'rsvpStatus',r)}:{}),version:r.version}));return {plan,tables:seatingTables(db,u,projectId,plan),unseated,guestNamesVisible:mayName,query}; }

export function exchange(db,{shareId,token,ip='local'}) { assert(typeof token==='string'&&token.length>=32,'Ссылка недействительна',404);const invite=db.prepare('SELECT * FROM guest_invites WHERE digest=?').get(sha(token));const site=activeInvite(db,invite,shareId);const raw=rawToken(),csrf=rawToken(),expires=Math.min(Date.now()+86400000,invite.expires_at);db.prepare('INSERT INTO guest_sessions(digest,invite_id,expires_at,invite_version,csrf_digest,created_at) VALUES(?,?,?,?,?,?)').run(sha(raw),invite.id,expires,invite.version,sha(csrf),now());return {sessionToken:raw,csrfToken:csrf,expiresAt:new Date(expires).toISOString(),shareId:site.data.shareId}; }
function session(db,raw,csrf) { assert(raw&&csrf,'Сессия недействительна',403);const s=db.prepare('SELECT * FROM guest_sessions WHERE digest=?').get(sha(raw));assert(s&&s.expires_at>Date.now()&&timingSafeEqual(Buffer.from(s.csrf_digest),Buffer.from(sha(csrf))),'Сессия недействительна',403);const invite=db.prepare('SELECT * FROM guest_invites WHERE id=?').get(s.invite_id);assert(invite&&!invite.revoked_at&&invite.version===s.invite_version,'Ссылка недействительна',403);return {s,invite}; }
export function context(db,{shareId,sessionToken,csrfToken}) { const {s,invite}=session(db,sessionToken,csrfToken),site=activeInvite(db,invite,shareId),project=entity(db,invite.project_id),enabled=publicRsvpFields(db,site);const canWrite=canRespond(site,invite,s,project?.data.timeZone||'Europe/Moscow');return {inviteVersion:invite.version,schemaVersion:entity(db,invite.guest_table_id).version,canRespond:canWrite,enabledFields:enabled,guests:publicRows(db,invite,enabled),deadline:site.data.rsvpDeadline||null}; }
function respondInternal(db,{shareId,sessionToken,csrfToken,commandId,inviteVersion,schemaVersion,changes}) { assert(/^[a-zA-Z0-9_-]{8,100}$/.test(commandId||''),'Команда должна иметь уникальный ID');return transaction(db,()=>{const {s,invite}=session(db,sessionToken,csrfToken),site=activeInvite(db,invite,shareId),t=entity(db,invite.guest_table_id),project=entity(db,invite.project_id),enabled=publicRsvpFields(db,site);assert(canRespond(site,invite,s,project?.data.timeZone||'Europe/Moscow'),'Срок ответов завершён',409);assert(Number(inviteVersion)===invite.version,'Приглашение изменилось',409);version(t,schemaVersion);assert(Array.isArray(changes)&&changes.length&&changes.length<=100,'Проверьте ответы');const payload=digest(JSON.stringify({inviteVersion,schemaVersion,changes})),prior=db.prepare('SELECT * FROM guest_commands WHERE invite_id=? AND command_id=?').get(invite.id,commandId);if(prior){assert(prior.payload_digest===payload,'ID команды уже использован',409);return JSON.parse(prior.result);}const allowed=new Set(db.prepare('SELECT guest_row_id FROM guest_invite_rows WHERE invite_id=?').all(invite.id).map(x=>x.guest_row_id));const map=mapping(t),out=[];assert(new Set(changes.map(x=>x.rowId)).size===changes.length&&changes.every(x=>allowed.has(x.rowId)),'Строка не входит в приглашение',403);for(const item of changes){const row=entity(db,item.rowId);assert(row&&!row.deleted&&row.parent_id===t.id,'Строка недоступна',409);version(row,item.rowVersion);const values=item.values;assert(values&&typeof values==='object'&&!Array.isArray(values),'Проверьте ответ');const next={...row.data};for(const [key,value] of Object.entries(values)){assert(['name','rsvp','diet','allergies','transfer','accommodation','contact','comment'].includes(key),'Поле недоступно',404);assert(!['diet','allergies'].includes(key)||enabled.meal,'Поле недоступно',404);assert(key!=='transfer'||enabled.transport,'Поле недоступно',404);const semantic={name:'guestName',rsvp:'rsvpStatus',diet:'diet',allergies:'allergies',transfer:'transfer',accommodation:'accommodation',contact:'contact',comment:'comment'}[key];const id=mappingValue(map,semantic);assert(id,'Это поле не включено в форму',409);if(key==='rsvp'){assert(RSVP.has(value),'Выберите статус');next[id]=statusWrite(map,value);}else next[id]=text(value,key==='allergies'?'Ограничения':key,key==='comment'?2000:key==='allergies'?1000:1000,true);}validateGuestRowMutation(t,row,next,Object.keys(next).filter(k=>next[k]!==row.data[k]),{specialized:true});validateRow(db,{id:invite.created_by,agency_id:invite.agency_id},t,next,Object.keys(next).filter(k=>next[k]!==row.data[k]));const saved=guestChange(db,invite,row,next,'guest_rsvp');if(semanticValue(map,'rsvpStatus',saved)==='declined'&&mappingValue(map,'seatingTable')){const clear={...saved.data,[mappingValue(map,'seatingTable')]:'',[mappingValue(map,'seatIndex')]:''};const cleared=guestChange(db,invite,saved,clear,'guest_declined_unassign');out.push({id:cleared.id,version:cleared.version});}else out.push({id:saved.id,version:saved.version});}const guestActor={actorType:'guest_invite',actorRef:invite.id,inviteId:invite.id};if(guestHooks.onRespond){const hookResult=guestHooks.onRespond(db,guestActor,invite.project_id,out,commandId);assert(!hookResult?.then,'Обработчик RSVP должен быть синхронным');}const result={affected:out.map(row=>({id:row.id,version:row.version})),canRespond:true};db.prepare('INSERT INTO guest_commands(invite_id,command_id,payload_digest,result,created_at) VALUES(?,?,?,?,?)').run(invite.id,commandId,payload,JSON.stringify(result),now());return result;}); }
export function revoke(db,u,body) { return transaction(db,()=>revokeInvite(db,currentUser(db,u),body)); }

export function respond(db,input){try{return respondInternal(db,input)}catch(error){if(error instanceof Fault&&error.details){let current;try{current=context(db,input)}catch{}throw new Fault(error.message,error.status,current?{code:'guest_conflict',current}:undefined)}throw error}}

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { assert, change, entity, entities, insert, now, transaction, uid, version } from '../../db.mjs';
import { can, digest, requireAccess } from '../../auth.mjs';
import { validateRow } from '../../model.mjs';
import { executeModule, projectAccess, scoped, sectionRows } from '../common.mjs';

const RSVP = new Set(['unanswered','confirmed','declined','tentative']);
const SEMANTIC_KEYS = ['guestName','rsvpStatus','diet','allergies','transfer','accommodation','contact','comment','invitationStatus','seatingTable','seatIndex'];
const PROTECTED = new Set(['rsvpStatus','diet','allergies','transfer','accommodation','contact','comment','invitationStatus','seatingTable','seatIndex']);
const sha = value => createHash('sha256').update(value).digest('hex');
const rawToken = () => randomBytes(32).toString('base64url');
let guestHooks = { onRespond: null };
// Root installs a synchronous durable-outbox writer. It is called inside the RSVP transaction.
export function configureGuestHooks(hooks={}) {
  assert(!hooks.onRespond || typeof hooks.onRespond==='function','Некорректный обработчик гостей');
  guestHooks={onRespond:hooks.onRespond||null};
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
    .run(uid(),invite.agency_id,invite.project_id,invite.id,row.id,row.kind,action,before?JSON.stringify(before):null,JSON.stringify(row),now(),'guest_invite',invite.id);
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
function microsite(db,agency,project,shareId) {
  const list=entities(db,agency,project,'microsite');
  const found=list.find(x=>x.data.shareId===shareId)||list[0];
  assert(found&&found.data.status==='published'&&found.data.publishedRevisionId,'Страница сейчас недоступна',404);
  return found;
}
function activeInvite(db, invite, shareId) {
  assert(invite&&!invite.revoked_at&&invite.expires_at>Date.now(),'Ссылка недействительна',404);
  const site=microsite(db,invite.agency_id,invite.project_id,shareId);
  assert(!site.data.closesAt || ms(site.data.closesAt)>Date.now(),'Страница сейчас недоступна',404);
  return site;
}
function publicRows(db,invite) {
  const t=entity(db,invite.guest_table_id); assert(t&&!t.deleted,'Состав приглашения больше недоступен',404);
  const allowed=new Map(db.prepare('SELECT guest_row_id,is_plus_one FROM guest_invite_rows WHERE invite_id=?').all(invite.id).map(x=>[x.guest_row_id,!!x.is_plus_one]));
  const map=mapping(t);
  return rows(db,invite.agency_id,invite.project_id,t.id).filter(row=>allowed.has(row.id)).map(row=>({
    id:row.id,version:row.version,isPlusOne:allowed.get(row.id),name:semanticValue(map,'guestName',row)||'',
    rsvp:semanticValue(map,'rsvpStatus',row),diet:semanticValue(map,'diet',row)||'', allergies:semanticValue(map,'allergies',row)||'',
    transfer:semanticValue(map,'transfer',row)||'', accommodation:semanticValue(map,'accommodation',row)||'', contact:semanticValue(map,'contact',row)||'', comment:semanticValue(map,'comment',row)||''
  }));
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
function checkBounds(plan,d) { assert(d.xM>=0&&d.yM>=0&&d.xM+d.widthM<=plan.data.widthM&&d.yM+d.heightM<=plan.data.heightM,'Стол выходит за границы зала',409); }
function tableData(d,plan) {
  const shape=['round','rect'].includes(d.shape)?d.shape:'round'; const capacity=integer(d.capacity,'Вместимость',1,30);
  const out={label:text(d.label,'Название',120,false),shape,xM:finite(d.xM,'X',0,1000),yM:finite(d.yM,'Y',0,1000),widthM:finite(d.widthM??(shape==='round'?1.6:2),'Ширина',.4,20),heightM:finite(d.heightM??(shape==='round'?1.6:1.2),'Высота',.4,20),rotationDeg:finite(d.rotationDeg??0,'Поворот',-360,360),capacity}; checkBounds(plan,out); return out;
}
function assignments(db,agency,project,t,map) { const tableId=mappingValue(map,'seatingTable'),seatId=mappingValue(map,'seatIndex'); if(!tableId||!seatId)return[]; return rows(db,agency,project,t.id).filter(row=>row.data[tableId]).map(row=>({row,tableId:row.data[tableId],seatIndex:row.data[seatId]})); }

export function validateGuestSchemaMutation(before, after, {confirm=false}={}) {
  const oldMap=mapping(before), newMap=mapping(after), protectedIds=mappedFields(oldMap);
  if(!protectedIds.size) return {ok:true};
  const oldCols=new Map((before.data.columns||[]).map(c=>[c.id,c])); const newCols=new Map((after.data.columns||[]).map(c=>[c.id,c]));
  const impacts=[];
  for(const id of protectedIds) if(!newCols.has(id)||newCols.get(id).type!==oldCols.get(id)?.type) impacts.push({id,semantic:SEMANTIC_KEYS.find(k=>oldMap[k]===id)});
  if(impacts.length&&!confirm) return {ok:false,code:'guestMappingRebindRequired',impacts};
  for(const key of SEMANTIC_KEYS) if(oldMap[key]&&oldMap[key]!==newMap[key]&&!confirm) return {ok:false,code:'guestMappingRebindRequired',impacts:[{id:oldMap[key],semantic:key}]};
  return {ok:true,impacts};
}
export function validateGuestRowMutation(t, before, next, changedKeys, {specialized=false}={}) {
  const protectedIds=mappedFields(mapping(t));
  const attempted=(changedKeys||Object.keys(next||{})).filter(k=>protectedIds.has(k));
  assert(specialized||!attempted.length,'Это поле меняется через RSVP или рассадку',409,{code:'guestMappedFieldProtected',fields:attempted});
  return true;
}

function authorizeMapping(db,u,c) { const t=table(db,u,c.guestTableId||c.entityId,c.projectId); projectAccess(db,u,c.projectId,'structure',t.id); }
function runMapping(db,u,c) {
  const t=table(db,u,c.guestTableId||c.entityId,c.projectId); version(t,c.schemaVersion??c.version);
  const input=c.data?.semanticMap||c.semanticMap; assert(input&&typeof input==='object'&&!Array.isArray(input),'Передайте сопоставление полей');
  const next={...t.data,semanticMap:{}};
  for(const key of SEMANTIC_KEYS) if(input[key]) { assert(typeof input[key]==='string'&&column(t,input[key]),'Выбрана отсутствующая колонка',409,{key}); next.semanticMap[key]=input[key]; }
  assert(next.semanticMap.guestName&&next.semanticMap.rsvpStatus,'Укажите имя и статус RSVP');
  const rsvpColumn=column(t,next.semanticMap.rsvpStatus); assert(['text','select'].includes(rsvpColumn.type),'Статус RSVP должен быть текстом или списком');
  if(next.semanticMap.seatingTable) assert(column(t,next.semanticMap.seatingTable).type==='relation','Стол должен быть связанной колонкой');
  if(next.semanticMap.seatIndex) assert(['number','text'].includes(column(t,next.semanticMap.seatIndex).type),'Номер места должен быть числом или текстом');
  next.semanticMap.rsvpValues={...{unanswered:'Нет ответа',confirmed:'Подтвердил',declined:'Отказ',tentative:'Пока не знает'},...(input.rsvpValues||{})};
  const guard=validateGuestSchemaMutation(t,{...t,data:next},{confirm:c.confirm===true}); assert(guard.ok,'Изменение подключённого поля требует перепривязки или отключения RSVP',409,guard);
  return change(db,u,t,next,false,'guest_mapping_save');
}
function authorizeInvite(db,u,c) { const t=table(db,u,c.guestTableId,c.projectId); requireAccess(db,u,'manageGuestInvites',c.projectId,t.id); }
function createInvite(db,u,c,rotateFrom=null) {
  const t=table(db,u,c.guestTableId,c.projectId); version(t,c.schemaVersion);
  const ids=c.guestRowIds; assert(Array.isArray(ids)&&ids.length>=1&&ids.length<=100&&new Set(ids).size===ids.length,'Выберите от 1 до 100 гостей');
  const available=new Map(rows(db,u.agency_id,c.projectId,t.id).map(r=>[r.id,r])); assert(ids.every(id=>available.has(id)),'В приглашении есть недоступная строка',404);
  for(const row of ids) requireAccess(db,u,'read',c.projectId,t.id,row);
  const expiry=ms(c.expiresAt); assert(Number.isFinite(expiry)&&expiry>Date.now()&&expiry<=Date.now()+3660*86400000,'Укажите будущий срок ссылки');
  if(rotateFrom) { db.prepare('UPDATE guest_invites SET revoked_at=?,version=version+1 WHERE id=? AND agency_id=?').run(now(),rotateFrom.id,u.agency_id); db.prepare('DELETE FROM guest_sessions WHERE invite_id=?').run(rotateFrom.id); }
  const token=rawToken(),invite={id:uid(),digest:sha(token),agency_id:u.agency_id,project_id:c.projectId,guest_table_id:t.id,expires_at:expiry,created_by:u.id,version:1};
  db.prepare('INSERT INTO guest_invites(id,digest,agency_id,project_id,guest_table_id,expires_at,revoked_at,created_by,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(invite.id,invite.digest,invite.agency_id,invite.project_id,invite.guest_table_id,invite.expires_at,null,invite.created_by,1,now());
  const plus=new Set(c.plusOneRowIds||[]); assert([...plus].every(id=>ids.includes(id)),'Дополнительный гость должен быть в составе приглашения');
  const st=db.prepare('INSERT INTO guest_invite_rows(invite_id,guest_row_id,is_plus_one) VALUES(?,?,?)'); for(const id of ids) st.run(invite.id,id,Number(plus.has(id)));
  return {inviteId:invite.id,version:1,token,expiresAt:new Date(expiry).toISOString(),affected:ids.map(id=>({id,version:available.get(id).version}))};
}
function revokeInvite(db,u,c) { const invite=db.prepare('SELECT * FROM guest_invites WHERE id=? AND agency_id=? AND project_id=?').get(c.entityId||c.inviteId,u.agency_id,c.projectId); assert(invite,'Приглашение не найдено',404); const t=table(db,u,invite.guest_table_id,c.projectId); requireAccess(db,u,'manageGuestInvites',c.projectId,t.id); assert(!invite.revoked_at,'Ссылка уже отозвана',409); assert(c.version===undefined||Number(c.version)===invite.version,'Ссылка уже изменилась',409); db.prepare('UPDATE guest_invites SET revoked_at=?,version=version+1 WHERE id=?').run(now(),invite.id);db.prepare('DELETE FROM guest_sessions WHERE invite_id=?').run(invite.id);return {inviteId:invite.id,revoked:true}; }
function rotateInvite(db,u,c) { const old=db.prepare('SELECT * FROM guest_invites WHERE id=? AND agency_id=? AND project_id=?').get(c.entityId||c.inviteId,u.agency_id,c.projectId);assert(old,'Приглашение не найдено',404);assert(!old.revoked_at&&old.version===c.version,'Ссылка уже изменилась',409); const ids=db.prepare('SELECT guest_row_id,is_plus_one FROM guest_invite_rows WHERE invite_id=?').all(old.id); return createInvite(db,u,{...c,guestTableId:old.guest_table_id,guestRowIds:ids.map(x=>x.guest_row_id),plusOneRowIds:ids.filter(x=>x.is_plus_one).map(x=>x.guest_row_id),schemaVersion:c.schemaVersion},old); }

function authorizePlan(db,u,c) { projectAccess(db,u,c.projectId,'edit','seating'); }
function planData(data) { return {name:text(data.name||'План рассадки','Название',120,false),widthM:finite(data.widthM,'Ширина зала',2,100),heightM:finite(data.heightM,'Высота зала',2,100),scale:finite(data.scale??1,'Масштаб',.1,10),zones:Array.isArray(data.zones)?data.zones.slice(0,50):[],guestTableId:data.guestTableId||null}; }
function savePlan(db,u,c) { let p=c.entityId?scoped(db,u,c.entityId,c.projectId,'seatingPlan'):null; if(p){version(p,c.version); const next=planData({...p.data,...c.data}); for(const t of seatingTables(db,u,c.projectId,p)) checkBounds({data:next},t.data); return change(db,u,p,next,false,'seating_plan_save');} return insert(db,u,'seatingPlan',planData(c.data),c.projectId); }
function createTable(db,u,c) { const p=ensurePlan(db,u,c.projectId,c.planId); version(p,c.planVersion); const d=tableData(c.data,p); assert(!seatingTables(db,u,c.projectId,p).some(t=>t.data.label===d.label),'Такой стол уже есть',409); return insert(db,u,'seatingTable',d,c.projectId,p.id); }
function createMany(db,u,c) { const p=ensurePlan(db,u,c.projectId,c.planId);version(p,c.planVersion);assert(Array.isArray(c.tables)&&c.tables.length>=1&&c.tables.length<=20,'Можно создать от 1 до 20 столов');const existing=new Set(seatingTables(db,u,c.projectId,p).map(t=>t.data.label));const prepared=c.tables.map(item=>tableData(item,p));assert(new Set(prepared.map(x=>x.label)).size===prepared.length&&prepared.every(x=>!existing.has(x.label)),'Повторяются названия столов');return {items:prepared.map(d=>insert(db,u,'seatingTable',d,c.projectId,p.id)),affected:[{id:p.id,version:p.version}]}; }
function editTable(db,u,c) { const t=scoped(db,u,c.entityId,c.projectId,'seatingTable');version(t,c.version);const p=ensurePlan(db,u,c.projectId,t.parent_id);return change(db,u,t,tableData({...t.data,...c.data},p),false,'seating_table_edit'); }
function deleteTable(db,u,c) { const t=scoped(db,u,c.entityId,c.projectId,'seatingTable'),p=ensurePlan(db,u,c.projectId,t.parent_id);version(t,c.version);const guest=table(db,u,c.guestTableId||p.data.guestTableId,c.projectId),map=mapping(guest),used=assignments(db,u.agency_id,c.projectId,guest,map).filter(x=>x.tableId===t.id);if(used.length&&!c.confirmUnassign) assert(false,'Сначала подтвердите снятие гостей со стола',409,{code:'requiresUnassignConfirmation',rows:used.map(x=>({id:x.row.id,version:x.row.version}))});if(used.length){assert(Array.isArray(c.rows)&&used.every(x=>c.rows.some(r=>r.id===x.row.id&&r.version===x.row.version)),'Список назначений изменился',409);for(const x of used){const next={...x.row.data,[mappingValue(map,'seatingTable')]:'',[mappingValue(map,'seatIndex')]:''};change(db,u,x.row,next,false,'seating_unassign');}}return change(db,u,t,t.data,true,'seating_table_delete'); }
function assignSeat(db,u,c) { const guest=table(db,u,c.guestTableId,c.projectId),map=mapping(guest),tableField=mappingValue(map,'seatingTable'),seatField=mappingValue(map,'seatIndex');assert(tableField&&seatField,'Сначала подключите поля рассадки',409);const row=scoped(db,u,c.guestRowId,c.projectId,'row');assert(row.parent_id===guest.id,'Гость не из этого реестра',409);version(row,c.rowVersion);requireEditableGuest(db,u,guest,row,[tableField,seatField]);const target=scoped(db,u,c.tableId,c.projectId,'seatingTable');const plan=ensurePlan(db,u,c.projectId,target.parent_id);assert(guest.id===plan.data.guestTableId||!plan.data.guestTableId,'План связан с другим реестром',409);const rsvp=semanticValue(map,'rsvpStatus',row);assert(rsvp!=='declined','Нельзя посадить отказавшегося гостя',409);const seat=integer(c.seatIndex,'Место',1,target.data.capacity);const used=assignments(db,u.agency_id,c.projectId,guest,map);assert(!used.some(x=>x.row.id!==row.id&&x.tableId===target.id&&Number(x.seatIndex)===seat),'Это место уже занято',409);const next={...row.data,[tableField]:target.id,[seatField]:seat};return change(db,u,row,next,false,'seating_assign'); }
function unassignSeat(db,u,c) { const guest=table(db,u,c.guestTableId,c.projectId),map=mapping(guest),row=scoped(db,u,c.guestRowId,c.projectId,'row');version(row,c.rowVersion);const tableField=mappingValue(map,'seatingTable'),seatField=mappingValue(map,'seatIndex');assert(tableField&&seatField,'Сначала подключите поля рассадки',409);requireEditableGuest(db,u,guest,row,[tableField,seatField]);return change(db,u,row,{...row.data,[tableField]:'',[seatField]:''},false,'seating_unassign'); }

export const operations={
  'guestMapping.save':{authorize:authorizeMapping,run:runMapping},
  'guestInvite.create':{authorize:authorizeInvite,run:(db,u,c)=>createInvite(db,u,c)},
  'guestInvite.revoke':{authorize:(db,u,c)=>projectAccess(db,u,c.projectId,'manageGuestInvites'),run:revokeInvite},
  'guestInvite.rotate':{authorize:(db,u,c)=>projectAccess(db,u,c.projectId,'manageGuestInvites'),run:rotateInvite},
  'seatingPlan.save':{authorize:authorizePlan,run:savePlan},
  'seatingTable.create':{authorize:authorizePlan,run:createTable},
  'seatingTable.createMany':{authorize:authorizePlan,run:createMany},
  'seatingTable.edit':{authorize:authorizePlan,run:editTable},
  'seatingTable.delete':{authorize:authorizePlan,run:deleteTable},
  'seating.assign':{authorize:authorizePlan,run:assignSeat},
  'seating.unassign':{authorize:authorizePlan,run:unassignSeat}
};
export const execute=(db,user,command)=>executeModule(db,user,command,operations);

export function guestList(db,u,projectId,guestTableId,query={}) { const t=table(db,u,guestTableId,projectId),map=mapping(t);projectAccess(db,u,projectId,'read',t.id);const invites=new Set(db.prepare('SELECT guest_row_id FROM guest_invite_rows ir JOIN guest_invites i ON i.id=ir.invite_id WHERE i.agency_id=? AND i.project_id=? AND i.revoked_at IS NULL AND i.expires_at>?').all(u.agency_id,projectId,Date.now()).map(x=>x.guest_row_id));let items=rows(db,u.agency_id,projectId,t.id).filter(row=>can(db,u,'read',projectId,t.id,row.id)).map(row=>({id:row.id,version:row.version,data:row.data,invited:invites.has(row.id),rsvp:semanticValue(map,'rsvpStatus',row),tableId:semanticValue(map,'seatingTable',row)||null,seatIndex:semanticValue(map,'seatIndex',row)||null}));if(query.rsvp) items=items.filter(item=>item.rsvp===query.rsvp);if(query.invited!==undefined) items=items.filter(item=>item.invited===Boolean(query.invited));const offset=integer(query.offset??0,'Смещение',0,100000),limit=integer(query.limit??50,'Размер страницы',1,200);return {items:items.slice(offset,offset+limit),total:items.length,offset,limit,nextOffset:offset+limit<items.length?offset+limit:null}; }
export function seatingSnapshot(db,u,projectId,planId,query={}) { const plan=ensurePlan(db,u,projectId,planId);projectAccess(db,u,projectId,'read','seating');const guest=table(db,u,plan.data.guestTableId,projectId),map=mapping(guest),readable=rows(db,u.agency_id,projectId,guest.id).filter(r=>can(db,u,'read',projectId,guest.id,r.id));const assigned=new Set(assignments(db,u.agency_id,projectId,guest,map).map(x=>x.row.id));return {plan,tables:seatingTables(db,u,projectId,plan),unseated:readable.filter(r=>!assigned.has(r.id)&&semanticValue(map,'rsvpStatus',r)!=='declined').map(r=>({id:r.id,name:semanticValue(map,'guestName',r),rsvp:semanticValue(map,'rsvpStatus',r),version:r.version})),query}; }

export function exchange(db,{shareId,token,ip='local'}) { assert(typeof token==='string'&&token.length>=32,'Ссылка недействительна',404);const invite=db.prepare('SELECT * FROM guest_invites WHERE digest=?').get(sha(token));const site=activeInvite(db,invite,shareId);const raw=rawToken(),csrf=rawToken(),expires=Math.min(Date.now()+86400000,invite.expires_at);db.prepare('INSERT INTO guest_sessions(digest,invite_id,expires_at,invite_version,csrf_digest,created_at) VALUES(?,?,?,?,?,?)').run(sha(raw),invite.id,expires,invite.version,sha(csrf),now());return {sessionToken:raw,csrfToken:csrf,expiresAt:new Date(expires).toISOString(),shareId:site.data.shareId}; }
function session(db,raw,csrf) { assert(raw&&csrf,'Сессия недействительна',403);const s=db.prepare('SELECT * FROM guest_sessions WHERE digest=?').get(sha(raw));assert(s&&s.expires_at>Date.now()&&timingSafeEqual(Buffer.from(s.csrf_digest),Buffer.from(sha(csrf))),'Сессия недействительна',403);const invite=db.prepare('SELECT * FROM guest_invites WHERE id=?').get(s.invite_id);assert(invite&&!invite.revoked_at&&invite.version===s.invite_version,'Ссылка недействительна',403);return {s,invite}; }
export function context(db,{shareId,sessionToken,csrfToken}) { const {s,invite}=session(db,sessionToken,csrfToken),site=activeInvite(db,invite,shareId),project=entity(db,invite.project_id);const canWrite=canRespond(site,invite,s,project?.data.timeZone||'Europe/Moscow');return {inviteVersion:invite.version,schemaVersion:entity(db,invite.guest_table_id).version,canRespond:canWrite,guests:publicRows(db,invite),deadline:site.data.rsvpDeadline||null}; }
export function respond(db,{shareId,sessionToken,csrfToken,commandId,inviteVersion,schemaVersion,changes}) { assert(/^[a-zA-Z0-9_-]{8,100}$/.test(commandId||''),'Команда должна иметь уникальный ID');return transaction(db,()=>{const {s,invite}=session(db,sessionToken,csrfToken),site=activeInvite(db,invite,shareId),t=entity(db,invite.guest_table_id),project=entity(db,invite.project_id);assert(canRespond(site,invite,s,project?.data.timeZone||'Europe/Moscow'),'Срок ответов завершён',409);assert(Number(inviteVersion)===invite.version,'Приглашение изменилось',409);version(t,schemaVersion);assert(Array.isArray(changes)&&changes.length&&changes.length<=100,'Проверьте ответы');const payload=digest(JSON.stringify({inviteVersion,schemaVersion,changes})),prior=db.prepare('SELECT * FROM guest_commands WHERE invite_id=? AND command_id=?').get(invite.id,commandId);if(prior){assert(prior.payload_digest===payload,'ID команды уже использован',409);return JSON.parse(prior.result);}const allowed=new Set(db.prepare('SELECT guest_row_id FROM guest_invite_rows WHERE invite_id=?').all(invite.id).map(x=>x.guest_row_id));const map=mapping(t),out=[];assert(new Set(changes.map(x=>x.rowId)).size===changes.length&&changes.every(x=>allowed.has(x.rowId)),'Строка не входит в приглашение',403);for(const item of changes){const row=entity(db,item.rowId);assert(row&&!row.deleted&&row.parent_id===t.id,'Строка недоступна',409);version(row,item.rowVersion);const values=item.values;assert(values&&typeof values==='object'&&!Array.isArray(values),'Проверьте ответ');const next={...row.data};for(const [key,value] of Object.entries(values)){assert(['name','rsvp','diet','allergies','transfer','accommodation','contact','comment'].includes(key),'Поле недоступно',403);const semantic={name:'guestName',rsvp:'rsvpStatus',diet:'diet',allergies:'allergies',transfer:'transfer',accommodation:'accommodation',contact:'contact',comment:'comment'}[key];const id=mappingValue(map,semantic);assert(id,'Это поле не включено в форму',409);if(key==='rsvp'){assert(RSVP.has(value),'Выберите статус');next[id]=statusWrite(map,value);}else next[id]=text(value,key==='allergies'?'Ограничения':key,key==='comment'?2000:key==='allergies'?1000:1000,true);}validateGuestRowMutation(t,row,next,Object.keys(next).filter(k=>next[k]!==row.data[k]),{specialized:true});validateRow(db,{id:invite.created_by,agency_id:invite.agency_id},t,next,Object.keys(next).filter(k=>next[k]!==row.data[k]));const saved=guestChange(db,invite,row,next,'guest_rsvp');if(semanticValue(map,'rsvpStatus',saved)==='declined'&&mappingValue(map,'seatingTable')){const clear={...saved.data,[mappingValue(map,'seatingTable')]:'',[mappingValue(map,'seatIndex')]:''};const cleared=guestChange(db,invite,saved,clear,'guest_declined_unassign');out.push({id:cleared.id,version:cleared.version});}else out.push({id:saved.id,version:saved.version});}const guestActor={actorType:'guest_invite',actorRef:invite.id,inviteId:invite.id};if(guestHooks.onRespond){const hookResult=guestHooks.onRespond(db,guestActor,invite.project_id,out,commandId);assert(!hookResult?.then,'Обработчик RSVP должен быть синхронным');}const result={affected:out,canRespond:true};db.prepare('INSERT INTO guest_commands(invite_id,command_id,payload_digest,result,created_at) VALUES(?,?,?,?,?)').run(invite.id,commandId,payload,JSON.stringify(result),now());return result;}); }
export function revoke(db,u,body) { return transaction(db,()=>revokeInvite(db,u,body)); }

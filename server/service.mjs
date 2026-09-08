import { assert, transaction, entity, entities, insert, change, version, uid, now, audit } from './db.mjs';
import { token, digest, passwordHash, checkPassword, createSession, publicUser, defaults, grant, grants, can, requireAccess, rateLimit } from './auth.mjs';
import { text, amount, date, safeUrl, getScoped, projectVisible, createProject, initialTemplate, validateColumns, validateRow, financials, validateLedger, sectionOf, accessRowId } from './model.mjs';
import { permissions, projectPermissions } from '../src/shared.js';
import { operations as v2Operations, typedKinds } from './v2/index.mjs';
import { executeModule, members as assignableMembers } from './v2/common.mjs';
import { queueChanges, notifications } from './v2/calendar/index.mjs';

export function bootstrap(db,b) {
  return transaction(db,()=>{
    assert(!db.prepare('SELECT id FROM agencies LIMIT 1').get(),'Настройка уже выполнена',409);
    const id=uid(),slug=text(b.slug,'Адрес агентства').toLowerCase(); assert(/^[a-z0-9-]{2,50}$/.test(slug),'Адрес: латинские буквы, цифры и дефис');
    db.prepare('INSERT INTO agencies(id,slug,name,settings) VALUES(?,?,?,?)').run(id,slug,text(b.agencyName),JSON.stringify({tagline:'Свадьба, собранная вместе',description:'Организация свадьбы от первой идеи до последнего танца.',contact:'',services:['Организация под ключ','Координация свадебного дня','Концепция и оформление'],portfolio:[]}));
    const user={id:uid(),agency_id:id,email:email(b.email),name:text(b.name),protected:1,disabled:0};
    db.prepare('INSERT INTO users(id,agency_id,email,name,password,protected) VALUES(?,?,?,?,?,1)').run(user.id,id,user.email,user.name,passwordHash(b.password));
    const roles=defaults(db,id); grant(db,user,roles[0].id); insert(db,user,'template',initialTemplate());
    for(const name of ['Гонорары','Аренда','Зарплата','Продвижение','Прочее']) insert(db,user,'category',{name,scope:'agency',archived:false});
    const saved=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    return {user:publicUser(saved),token:createSession(db,saved)};
  });
}
function email(v) { const e=text(v,'Email',3,200).toLowerCase(); assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),'Проверьте email'); return e; }
function applicationData(data) {
  assert(data&&typeof data==='object'&&!Array.isArray(data),'Проверьте заявку');
  return {name:text(data.name),date:date(data.date,false),contact:text(data.contact,'Контакт',3,500),message:text(data.message,'Пожелания',1,4000)};
}
function settingsData(settings) {
  assert(settings&&typeof settings==='object'&&!Array.isArray(settings),'Проверьте настройки');
  const services=settings.services;
  assert(Array.isArray(services)&&services.length<=20,'Проверьте услуги');
  const portfolio=settings.portfolio;
  assert(Array.isArray(portfolio)&&portfolio.length<=40,'Проверьте портфолио');
  return {
    tagline:text(settings.tagline,'Заголовок',1,160),
    description:text(settings.description,'Описание',1,5000),
    contact:settings.contact?text(settings.contact,'Контакт',1,1000):'',
    services:services.map(item=>text(item,'Услуга',1,240)),
    portfolio:portfolio.map(item=>{
      assert(item&&typeof item==='object'&&!Array.isArray(item),'Проверьте портфолио');
      const image=safeUrl(item.image); assert(image,'Добавьте ссылку на изображение');
      return {title:text(item.title),image,description:item.description?text(item.description,'Описание проекта',1,2000):''};
    })
  };
}
export function authenticate(db,b,ip='local') {
  rateLimit(db,'login:'+ip,40); const agency=db.prepare('SELECT id FROM agencies WHERE slug=?').get(b.slug||'tie');
  const u=agency&&db.prepare('SELECT * FROM users WHERE agency_id=? AND email=?').get(agency.id,String(b.email).toLowerCase().trim());
  assert(u && !u.disabled && checkPassword(b.password,u.password),'Неверные данные для входа',401);
  return {user:publicUser(u),token:createSession(db,u)};
}
export function register(db,b,ip='local') {
  rateLimit(db,'register:'+ip,30);
  return transaction(db,()=>{
    const agency=db.prepare('SELECT id FROM agencies WHERE slug=?').get(b.slug||'tie'); assert(agency,'Агентство не найдено',404);
    const u={id:uid(),agency_id:agency.id,name:text(b.name),email:email(b.email),protected:0,disabled:0};
    assert(!db.prepare('SELECT id FROM users WHERE agency_id=? AND email=?').get(agency.id,u.email),'Этот email уже зарегистрирован. Войдите в аккаунт.',409);
    db.prepare('INSERT INTO users(id,agency_id,email,name,password) VALUES(?,?,?,?,?)').run(u.id,u.agency_id,u.email,u.name,passwordHash(b.password));
    if(b.invitation) acceptInvitation(db,u,b.invitation);
    const saved=db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
    return {user:publicUser(saved),token:createSession(db,saved)};
  });
}
function acceptInvitation(db,u,raw) {
  const invite=db.prepare('SELECT * FROM invitations WHERE digest=? AND agency_id=?').get(digest(raw),u.agency_id);
  assert(invite && !invite.revoked && invite.expires>Date.now() && (!invite.used_by||invite.used_by===u.id) && invite.email===u.email,'Приглашение недействительно, истекло, отозвано или выписано на другой email',403);
  const role=db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(invite.role_id,u.agency_id); assert(role&&!role.protected,'Роль приглашения недоступна',403);
  const p=getScoped(db,u,invite.project_id,undefined,'project'); assert(!p.deleted,'Проект удалён');
  const creator=invite.created_by&&db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(invite.created_by,u.agency_id);
  assert(creator&&can(db,creator,'invite',invite.project_id),'Создатель приглашения больше не может подключать участников',403);
  if(!can(db,creator,'access')) assert(role.key==='couple'&&JSON.parse(role.permissions).every(permission=>projectPermissions.includes(permission)),'Роль приглашения больше недоступна создателю',403);
  if(!invite.used_by) grant(db,u,invite.role_id,invite.project_id,JSON.parse(invite.restrictions));
  db.prepare('UPDATE invitations SET used_by=? WHERE digest=?').run(u.id,digest(raw)); return {projectId:invite.project_id};
}
export function publicInfo(db,slug='tie') {
  const a=db.prepare('SELECT * FROM agencies WHERE slug=?').get(slug);
  return a?{id:a.id,slug:a.slug,name:a.name,...Object.fromEntries(Object.entries(JSON.parse(a.settings)).filter(([key])=>['tagline','description','contact','services','portfolio'].includes(key))),setup:false}:{setup:!db.prepare('SELECT id FROM agencies LIMIT 1').get(),notFound:true};
}
function filteredRow(db,u,r) {
  const section=sectionOf(r);
  const accessRow=accessRowId(r);
  const required=r.kind==='obligation'||r.kind==='movement'||r.kind==='category'?['read','finance']:r.kind==='file'?['read','files']:['read'];
  if(!can(db,u,required,r.project_id,section,accessRow)) return null;
  const table=r.kind==='row'?entity(db,r.parent_id):null;
  const liveFields=table&&!table.deleted?new Set(table.data.columns.map(column=>column.id)):null;
  const data={}; for(const [key,v] of Object.entries(r.data)) if((!liveFields||liveFields.has(key))&&can(db,u,required,r.project_id,section,accessRow,key)) data[key]=v;
  return {...r,data};
}
function filteredProject(db,u,p) {
  const data={name:p.data.name,date:p.data.date,status:p.data.status};
  for(const key of ['location','limit','offline','notes']) if(can(db,u,'read',p.id,'project',p.id,key)) data[key]=p.data[key];
  return {...p,data};
}
function canHoldFunds(db,user,project) {
  if(user.protected) return true;
  return grants(db,user).some(grant=>{
    if(grant.role_key==='couple'||!grant.permissions.includes('finance')) return false;
    if(grant.project_id!==null&&grant.project_id!==project) return false;
    const restrictions=grant.restrictions;
    if(restrictions.sections?.length&&!restrictions.sections.includes('budget')) return false;
    return !restrictions.rows?.length&&!restrictions.fields?.length;
  });
}
function visibleTable(db,u,project,table) {
  if(!can(db,u,'read',project,table.id)) return null;
  const columns=table.data.columns.filter(column=>{
    const dependencies=column.type==='formula'?[...column.formula.matchAll(/\{([^}]+)\}/g)].map(match=>match[1]):[];
    return can(db,u,'read',project,table.id,undefined,[column.id,...dependencies]);
  });
  const rowOrder=(table.data.rowOrder||[]).filter(rowId=>{ const row=entity(db,rowId); return row&&!row.deleted&&row.parent_id===table.id&&can(db,u,'read',project,table.id,rowId); });
  return {...table,data:{...table.data,columns,rowOrder}};
}
export function snapshot(db,u,project=null,offline=false) {
  u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(u.id,u.agency_id);
  assert(u,'Доступ отозван',403);
  const agency=db.prepare('SELECT * FROM agencies WHERE id=?').get(u.agency_id);
  const result={user:publicUser(u),agency:{id:agency.id,slug:agency.slug,name:agency.name,settings:JSON.parse(agency.settings),version:agency.version},grants:grants(db,u),time:now()};
  if(project) {
    assert(projectVisible(db,u,project),'Проект недоступен',403);
    const p=getScoped(db,u,project,undefined,'project'), all=entities(db,u.agency_id,project);
    result.project=filteredProject(db,u,p);
    const liveSections=new Set(all.filter(r=>r.kind==='section').map(r=>r.id));
    const tables=all.filter(r=>r.kind==='table'&&liveSections.has(r.data.sectionId)).map(r=>visibleTable(db,u,project,r)).filter(Boolean);
    const tableIds=new Set(tables.map(t=>t.id));
    const prepared=tables.filter(t=>t.data.offline).map(t=>t.id);
    const offlineKinds=new Set(p.data.offline||[]);
    const payouts=offline && offlineKinds.has('payouts') && can(db,u,['read','finance'],project,'budget');
    const budget=offline && offlineKinds.has('budget') && can(db,u,['read','finance'],project,'budget');
    const vendors=offline && offlineKinds.has('vendors') && can(db,u,'read',project,'vendors');
    const files=offline && offlineKinds.has('files') && can(db,u,['read','files'],project,'files');
    result.entities=[];
    for(const row of all) {
      if(['task','approval','approvalRevision','comment','meeting','microsite','micrositeRevision','publicRevision','notification'].includes(row.kind)) continue;
      if(row.kind==='table') { const t=tables.find(t=>t.id===row.id); if(t&&(!offline||prepared.includes(t.id))) result.entities.push(t); continue; }
      if(row.kind==='section') {
        const hasVisibleTable=tables.some(table=>(!offline||prepared.includes(table.id))&&table.data.sectionId===row.id);
        const directlyVisible=!offline&&can(db,u,'read',project,sectionOf(row),accessRowId(row));
        if(hasVisibleTable||directlyVisible) result.entities.push({...row,data:{name:row.data.name,order:row.data.order,archived:row.data.archived}});
        continue;
      }
      if(row.kind==='row'&&!tableIds.has(row.parent_id)) continue;
      if(offline) {
        if(row.kind==='row'&&!prepared.includes(row.parent_id)) continue;
        if(['obligation','category','movement'].includes(row.kind)&&!budget&&!payouts) continue;
        if(row.kind==='movement'&&!budget) continue;
        if(row.kind==='category'&&!budget) continue;
        if(row.kind==='selection'&&!vendors) continue;
        if(row.kind==='file'&&!files) continue;
        if(!['row','obligation','category','movement','selection','file','section'].includes(row.kind)) continue;
      }
      const filtered=filteredRow(db,u,row); if(filtered) result.entities.push(filtered);
    }
    // Payouts are a separate, limited view; do not preload the full estimate/ledger.
    if(payouts&&!budget) {
      const f=financials(all);
      result.entities=result.entities.map(r=>r.kind==='obligation'?{...r,data:Object.fromEntries(Object.entries({...r.data,paid:f.paid[r.id]||0,due:(r.data.agreed||0)-(f.paid[r.id]||0)}).filter(([k])=>['title','agreed','priceKind','dueDate','condition','responsible','fee','paid','due'].includes(k)&&can(db,u,'read',project,'budget',r.id,k)))}:r);
    }
    const fullFinance=can(db,u,['read','finance'],project,'budget',null,null);
    if((!offline||budget)&&fullFinance) result.financials=financials(result.entities);
    const mayInvite=can(db,u,'invite',project);
    const mayUseFinance=can(db,u,'finance',project,'budget');
    const projectPeople=db.prepare('SELECT * FROM users WHERE agency_id=? AND disabled=0 ORDER BY name').all(u.agency_id).filter(person=>projectVisible(db,person,project));
    const custodians=projectPeople.filter(person=>canHoldFunds(db,person,project)).map(({id,name})=>({id,name}));
    result.custodians=mayUseFinance?custodians:[];
    if(!offline) result.assignableMembers=assignableMembers(db,u,project);
    if(mayInvite) {
      result.members=projectPeople.map(({id,name,email})=>({id,name,email}));
      const allRoles=db.prepare('SELECT id,name,permissions,key FROM roles WHERE agency_id=? AND protected=0 ORDER BY name').all(u.agency_id);
      result.inviteRoles=allRoles.filter(role=>can(db,u,'access')||role.key==='couple').map(({id,name})=>({id,name}));
    } else result.members=mayUseFinance?custodians:[];
    if(!offline && can(db,u,'history',project)) result.history=db.prepare(`SELECT a.*,u.name AS author,e.version AS current_version,e.deleted AS current_deleted
      FROM audit a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN entities e ON e.id=a.entity_id AND e.agency_id=a.agency_id
      WHERE a.agency_id=? AND a.project_id=? ORDER BY a.created_at DESC LIMIT 200`).all(u.agency_id,project);
    if(offline) { result.offline=true; result.expiresAt=Date.now()+7*86400000; result.project={...result.project,data:{name:p.data.name,date:p.data.date,offline:p.data.offline}}; result.agency={id:agency.id,name:agency.name}; }
    return result;
  }
  result.projects=entities(db,u.agency_id,null,'project').filter(p=>projectVisible(db,u,p.id)).map(p=>filteredProject(db,u,p));
  result.applications=entities(db,u.agency_id,null,'application').filter(a=>a.data.userId===u.id||can(db,u,'applications'));
  result.notifications=notifications(db,u,{limit:50}).items;
  result.global=entities(db,u.agency_id,null).filter(r=>(['vendor','vendorCategory'].includes(r.kind)&&can(db,u,['read','catalog']))||(r.kind==='template'&&can(db,u,['read','templates']))||(['movement','category'].includes(r.kind)&&can(db,u,['read','agencyFinance'])));
  if(can(db,u,['read','agencyFinance'])) {
    const fees=db.prepare("SELECT * FROM entities WHERE agency_id=? AND kind='movement' AND deleted=0 AND json_extract(data,'$.type')='fee'").all(u.agency_id).map(r=>({...r,data:JSON.parse(r.data)}));
    result.global.push(...fees); result.financials=financials(result.global);
  }
  if(can(db,u,['read','catalog'])) result.vendorHistory=db.prepare("SELECT id,project_id,data FROM entities WHERE agency_id=? AND kind='selection' AND deleted=0").all(u.agency_id).map(r=>({...r,data:JSON.parse(r.data)}));
  if(can(db,u,'access')) {
    result.users=db.prepare('SELECT id,agency_id,email,name,protected,disabled,version FROM users WHERE agency_id=?').all(u.agency_id);
    result.roles=db.prepare('SELECT * FROM roles WHERE agency_id=?').all(u.agency_id).map(r=>({...r,permissions:JSON.parse(r.permissions)}));
    result.assignments=db.prepare('SELECT * FROM grants WHERE agency_id=?').all(u.agency_id).map(g=>({...g,restrictions:JSON.parse(g.restrictions)}));
  }
  return result;
}

function validateRestrictions(r={}) {
  assert(r&&typeof r==='object'&&!Array.isArray(r),'Проверьте область доступа');
  for(const k of ['sections','rows','fields']) if(r[k]!==undefined) assert(Array.isArray(r[k])&&r[k].length<=200&&r[k].every(x=>typeof x==='string'&&x.length<=100),'Проверьте ограничения');
  return {sections:r.sections||[],rows:r.rows||[],fields:r.fields||[]};
}
function permissionFor(kind,project) { if(project) return ['obligation','movement','category'].includes(kind)?'finance':kind==='file'?'files':['table','section'].includes(kind)?'structure':null; return ({vendor:'catalog',vendorCategory:'catalog',template:'templates',category:'agencyFinance',movement:'agencyFinance'})[kind]; }
function validateData(db,u,kind,data,p,parent,current=null) {
  assert(data&&typeof data==='object'&&!Array.isArray(data),'Проверьте данные'); const d=structuredClone(data);
  if(['section','table','vendor','category','vendorCategory','template'].includes(kind)) d.name=text(d.name);
  if(kind==='project') {
    d.name=text(d.name); d.date=date(d.date,false); d.location=d.location?text(d.location,'Место',1,1000):''; d.notes=d.notes?text(d.notes,'Заметка',1,8000):'';
    d.limit=amount(d.limit??null,true); assert(['planning','confirmed','completed','archived'].includes(d.status),'Неизвестный статус');
    assert(Array.isArray(d.offline)&&d.offline.length<=60&&d.offline.every(s=>['payouts','budget','vendors','files'].includes(s)),'Проверьте офлайн-разделы'); d.offline=[...new Set(d.offline)];
  }
  if(kind==='section') { d.order=Number(d.order??0); assert(Number.isFinite(d.order),'Проверьте порядок раздела'); d.archived=!!d.archived; }
  if(kind==='table') {
    d.key=text(d.key,'Ключ таблицы'); assert(/^[a-zA-Z0-9_-]{1,80}$/.test(d.key),'Ключ таблицы: латинские буквы, цифры, дефис или подчёркивание');
    assert(!entities(db,u.agency_id,p,'table').some(table=>table.id!==current?.id&&table.data.key===d.key),'Ключ таблицы уже используется',409);
    validateColumns(d.columns); const s=getScoped(db,u,d.sectionId,p,'section'); assert(!s.deleted,'Раздел удалён'); d.order=Number(d.order??0); assert(Number.isFinite(d.order),'Проверьте порядок таблицы'); d.archived=!!d.archived; d.offline=!!d.offline;
    d.rowOrder=d.rowOrder??[]; assert(Array.isArray(d.rowOrder),'Проверьте порядок строк');
    const rowIds=new Set(entities(db,u.agency_id,p,'row',true).filter(row=>row.parent_id===current?.id).map(row=>row.id));
    assert(new Set(d.rowOrder).size===d.rowOrder.length&&d.rowOrder.length<=10000&&d.rowOrder.every(id=>typeof id==='string'&&rowIds.has(id)),'Порядок содержит неизвестные или повторяющиеся строки',409);
    if(current) {
      const incompatible=current.data.columns.filter(c=>!d.columns.some(n=>n.id===c.id&&n.type===c.type));
      if(incompatible.length) assert(d.confirmStructure===true,'Изменение затронет существующие значения. Подтвердите последствия.',409,{affectedRows:entities(db,u.agency_id,p,'row').filter(r=>r.parent_id===current.id).length,columns:incompatible.map(c=>c.name)});
      delete d.confirmStructure;
    }
  }
  if(kind==='row') { const t=getScoped(db,u,parent,p,'table'); assert(!t.deleted,'Таблица удалена',409); validateRow(db,u,t,d); }
  if(kind==='category'||kind==='vendorCategory') { d.archived=!!d.archived; if(p) d.scope='wedding'; }
  if(kind==='vendor') {
    d.contact=d.contact?text(d.contact,'Контакт',1,1000):''; d.portfolio=safeUrl(d.portfolio); d.price=amount(d.price??null,true); d.services=d.services?text(d.services,'Услуги',1,4000):''; d.terms=d.terms?text(d.terms,'Условия',1,8000):''; d.notes=d.notes?text(d.notes,'Заметки',1,8000):''; d.archived=!!d.archived;
    if(d.categoryId) getScoped(db,u,d.categoryId,null,'vendorCategory'); d.updatedOn=date(d.updatedOn||now().slice(0,10));
  }
  if(kind==='obligation') {
    d.title=text(d.title); assert(['unknown','included','amount'].includes(d.priceKind),'Выберите тип стоимости'); d.agreed=d.priceKind==='amount'?amount(d.agreed):null; d.planned=amount(d.planned??null,true); d.dueDate=date(d.dueDate); d.condition=d.condition?text(d.condition,'Условие оплаты',1,3000):''; d.fee=!!d.fee;
    if(d.categoryId) { const c=getScoped(db,u,d.categoryId,p,'category'); assert(!c.deleted,'Категория удалена'); }
    if(d.responsible) { const person=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(d.responsible,u.agency_id); assert(person&&projectVisible(db,person,p),'Ответственный не участвует в проекте'); }
  }
  if(kind==='selection') {
    d.title=text(d.title); if(d.vendorId) { const v=getScoped(db,u,d.vendorId,null,'vendor'); assert(!v.deleted,'Подрядчик удалён'); }
    d.price=amount(d.price??null,true); d.selected=!!d.selected; d.terms=d.terms?text(d.terms,'Условия',1,8000):''; d.dueDate=date(d.dueDate);
    if(current?.data.obligationId) d.obligationId=current.data.obligationId; else delete d.obligationId;
  }
  if(kind==='template') {
    d.offline=Array.isArray(d.offline)?d.offline:[];
    d.categories=Array.isArray(d.categories)?d.categories:[];
    assert(Array.isArray(d.sections)&&d.sections.length<=30&&Array.isArray(d.tables)&&d.tables.length<=50,'Проверьте разделы и таблицы шаблона');
    d.sections=d.sections.map((section,index)=>({key:text(section?.key,'Ключ раздела'),name:text(section?.name,'Название раздела'),order:Number(section?.order??index)}));
    const keys=new Set(); for(const s of d.sections) { assert(/^[a-zA-Z0-9_-]{1,80}$/.test(s.key),'Ключ раздела: латинские буквы, цифры, дефис или подчёркивание'); assert(Number.isFinite(s.order),'Проверьте порядок раздела'); assert(!keys.has(s.key),'Ключ раздела повторяется'); keys.add(s.key); }
    const tableKeys=new Set();
    d.tables=d.tables.map(table=>({key:text(table?.key,'Ключ таблицы'),name:text(table?.name,'Название таблицы'),section:text(table?.section,'Раздел таблицы'),offline:!!table?.offline,columns:structuredClone(table?.columns)}));
    for(const t of d.tables) { assert(/^[a-zA-Z0-9_-]{1,80}$/.test(t.key),'Ключ таблицы: латинские буквы, цифры, дефис или подчёркивание'); assert(!tableKeys.has(t.key),'Ключ таблицы повторяется'); tableKeys.add(t.key); assert(keys.has(t.section),'Раздел таблицы не найден'); validateColumns(t.columns); }
    assert(d.categories.length<=100,'Проверьте категории'); d.categories=[...new Set(d.categories.map(category=>text(category,'Категория',1,120)))];
    d.offline=[...new Set(d.offline.map(key=>text(key,'Офлайн-раздел',1,80)))];
    assert(Array.isArray(d.offline)&&d.offline.length<=60&&d.offline.every(key=>tableKeys.has(key)||['payouts','budget','vendors','files'].includes(key)),'Проверьте офлайн-разделы шаблона');
  }
  return d;
}
export function execute(db,user,cmd) {
  if(v2Operations[cmd?.op]) return executeModule(db,user,cmd,v2Operations);
  assert(cmd && typeof cmd==='object' && /^[a-zA-Z0-9_-]{8,100}$/.test(cmd.id||''),'Команда должна иметь уникальный ID');
  // All writes including duplicate checks run after current authorization, inside a transaction.
  return transaction(db,()=>{
    const u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(user.id,user.agency_id); assert(u,'Доступ отозван',403);
    const {op,projectId:p=null}=cmd;
    if(p) { const proj=getScoped(db,u,p,undefined,'project'); assert(!proj.deleted && projectVisible(db,u,p),'Проект недоступен',403); }
    authorizeCommand(db,u,cmd);
    const hash=digest(JSON.stringify(cmd)), previous=db.prepare('SELECT * FROM commands WHERE id=? AND user_id=?').get(cmd.id,u.id);
    if(previous) { assert(previous.digest===hash,'Этот ID уже использован для другого действия',409); return JSON.parse(previous.result); }
    const beforeAudit=db.prepare('SELECT coalesce(max(rowid),0) AS n FROM audit').get().n;
    let result;
    if(op==='project.create') { requireAccess(db,u,'projects'); const template=cmd.templateId?getScoped(db,u,cmd.templateId,null,'template'):null; result=createProject(db,u,cmd.data,template); }
    else if(op==='application.create') {
      assert(!entities(db,u.agency_id,null,'application').some(a=>a.data.userId===u.id&&['review','clarification','approved'].includes(a.data.status)),'У вас уже есть заявка',409);
      result=insert(db,u,'application',{userId:u.id,...applicationData(cmd.data),status:'review',reason:'',projectId:null});
    } else if(op==='application.respond') {
      const a=getScoped(db,u,cmd.entityId,null,'application'); assert(a.data.userId===u.id,'Можно изменить только свою заявку',403); version(a,cmd.version);
      assert(['clarification','rejected'].includes(a.data.status),'Эта заявка сейчас не ожидает исправления',409);
      result=change(db,u,a,{...a.data,...applicationData(cmd.data),status:'review',reason:'',projectId:null},false,'respond');
    } else if(op==='application.review') {
      requireAccess(db,u,'applications'); const a=getScoped(db,u,cmd.entityId,null,'application');
      if(a.data.status==='approved'&&cmd.status==='approved') result=a;
      else {
        version(a,cmd.version); assert(['approved','rejected','clarification'].includes(cmd.status),'Проверьте решение'); assert(a.data.status!=='approved','Проект уже создан',409);
        const reason=cmd.status==='approved'?(cmd.reason||''):text(cmd.reason,'Причина',3,1000); let projectId=null;
        if(cmd.status==='approved') {
          const project=createProject(db,u,{name:a.data.name,date:a.data.date}); projectId=project.id;
          const role=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='couple'").get(u.agency_id);
          const applicant=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=?').get(a.data.userId,u.agency_id); grant(db,applicant,role.id,projectId);
        }
        result=change(db,u,a,{...a.data,status:cmd.status,reason,projectId});
        insert(db,u,'notification',{userId:a.data.userId,title:cmd.status==='approved'?'Заявка одобрена. Ваш проект открыт.':cmd.status==='rejected'?'Заявка отклонена':'Уточните детали заявки',body:reason,projectId});
      }
    } else if(op==='invite.create') {
      assert(p,'Укажите проект');
      requireAccess(db,u,'invite',p); const defaultRole=db.prepare("SELECT * FROM roles WHERE agency_id=? AND key='couple'").get(u.agency_id); const role=cmd.roleId?db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(cmd.roleId,u.agency_id):defaultRole; assert(role,'Роль не найдена');
      assert(!role.protected,'Нельзя приглашать с ролью администратора');
      const restrictions=validateRestrictions(cmd.restrictions),raw=token();
      // Only access managers may delegate permissions outside the ordinary couple role.
      if(!can(db,u,'access')) assert(role.key==='couple','Выбор расширенной роли требует управления доступом',403);
      const expiresAt=Date.now()+7*86400000,id=digest(raw);
      db.prepare('INSERT INTO invitations(digest,agency_id,project_id,email,role_id,expires,used_by,restrictions,created_by,revoked) VALUES(?,?,?,?,?,?,NULL,?,?,0)').run(id,u.agency_id,p,email(cmd.email),role.id,expiresAt,JSON.stringify(restrictions),u.id); result={id,token:raw,email:email(cmd.email),expiresAt};
    } else if(op==='invite.revoke') {
      const invite=db.prepare('SELECT * FROM invitations WHERE digest=? AND agency_id=?').get(cmd.invitationId,u.agency_id); assert(invite,'Приглашение не найдено',404);
      assert(invite.created_by===u.id||can(db,u,'access'),'Можно отозвать только своё приглашение',403); requireAccess(db,u,'invite',invite.project_id); assert(!invite.used_by,'Приглашение уже принято',409);
      db.prepare('UPDATE invitations SET revoked=1 WHERE digest=?').run(invite.digest); result={id:invite.digest,revoked:true};
    } else if(op==='invite.accept') result=acceptInvitation(db,u,cmd.token);
    else if(op==='role.save') {
      requireAccess(db,u,'access'); assert(Array.isArray(cmd.permissions)&&cmd.permissions.every(x=>permissions.includes(x)),'Неизвестное разрешение'); const name=text(cmd.name),id=cmd.roleId||uid();
      const existing=db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(id,u.agency_id);
      if(existing) { assert(!existing.protected,'Роль администратора защищена',403); version(existing,cmd.version); db.prepare('UPDATE roles SET name=?,permissions=?,version=version+1 WHERE id=?').run(name,JSON.stringify(cmd.permissions),id); }
      else db.prepare('INSERT INTO roles(id,agency_id,name,permissions) VALUES(?,?,?,?)').run(id,u.agency_id,name,JSON.stringify(cmd.permissions));
      result={id,name}; audit(db,u,{id,kind:'role',project_id:null,data:{name,permissions:cmd.permissions}},existing,'access');
    } else if(op==='grants.save') {
      requireAccess(db,u,'access'); const target=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=?').get(cmd.userId,u.agency_id); assert(target,'Пользователь не найден'); assert(!target.protected,'Основной администратор защищён',403); version(target,cmd.version);
      assert(Array.isArray(cmd.grants)&&cmd.grants.length<=50,'Не более 50 назначений');
      for(const g of cmd.grants) { const r=db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(g.roleId,u.agency_id); assert(r,'Роль не найдена'); assert(!r.protected,'Роль администратора защищена',403); if(g.projectId) getScoped(db,u,g.projectId,undefined,'project'); else assert(!['couple','coordinator','contractor'].includes(r.key),'Этой роли нужно назначить конкретный проект'); validateRestrictions(g.restrictions); }
      const before=grants(db,target); db.prepare('DELETE FROM grants WHERE user_id=?').run(target.id);
      for(const g of cmd.grants) grant(db,target,g.roleId,g.projectId||null,validateRestrictions(g.restrictions));
      db.prepare('UPDATE users SET version=version+1,disabled=? WHERE id=?').run(Number(!!cmd.disabled),target.id); result={id:target.id}; audit(db,u,{id:target.id,kind:'grants',project_id:null,data:cmd.grants},before,'access');
    } else if(op==='settings.save') {
      requireAccess(db,u,'settings'); const a=db.prepare('SELECT * FROM agencies WHERE id=?').get(u.agency_id); version(a,cmd.version);
      const name=text(cmd.name),s=settingsData(cmd.settings);
      db.prepare('UPDATE agencies SET name=?,settings=?,version=version+1 WHERE id=?').run(name,JSON.stringify(s),u.agency_id); result={ok:true,name,settings:s}; audit(db,u,{id:u.agency_id,kind:'settings',project_id:null,data:s},a,'edit');
    } else if(op==='movement.save'||op==='movement.delete') result=movement(db,u,cmd);
    else if(op==='entity.create'||op==='entity.edit'||op==='entity.delete'||op==='entity.restore') result=mutateEntity(db,u,cmd);
    else assert(false,'Неизвестное действие');
    queueChanges(db,u,beforeAudit);
    db.prepare('INSERT INTO commands VALUES(?,?,?,?)').run(cmd.id,u.id,hash,JSON.stringify(result)); return result;
  });
}

function authorizeCommand(db,u,c) {
  const p=c.projectId||null;
  const actions={'project.create':'projects','application.review':'applications','role.save':'access','grants.save':'access','settings.save':'settings','invite.create':'invite'};
  if(actions[c.op]) requireAccess(db,u,actions[c.op],c.op==='invite.create'?p:null);
  if(c.op.startsWith('movement.')) {
    const old=c.entityId?getScoped(db,u,c.entityId,p,'movement'):null;
    const type=c.data?.type||old?.data.type;
    const fields=c.data?Object.keys(c.data):null;
    const action=c.op==='movement.delete'?'delete':old?'edit':'create';
    if(!p) requireAccess(db,u,[action,'agencyFinance'],null,'agencyFinance',null,fields);
    else {
      const obligationId=['payment','fee'].includes(type)?(c.data?.obligationId||old?.data.obligationId):null;
      requireAccess(db,u,[action,'finance'],p,'budget',obligationId,fields);
      if(old?.data.obligationId&&old.data.obligationId!==obligationId) requireAccess(db,u,[action,'finance'],p,'budget',old.data.obligationId,fields);
    }
  }
  if(c.op.startsWith('entity.')) {
    const row=c.entityId?getScoped(db,u,c.entityId):null,kind=row?.kind||c.kind;
    if(row) assert(row.project_id===p || kind==='project'&&row.id===p,'Область команды не совпадает с записью',403);
    const allowed=['project','section','table','row','obligation','category','vendorCategory','vendor','selection','template','file']; assert(allowed.includes(kind),'Этот тип записи меняется отдельным действием');
    const section=row?sectionOf(row):kind==='row'?c.parentId:kind==='table'?c.data?.sectionId:({obligation:'budget',selection:'vendors',file:'files'})[kind]||kind;
    const accessRow=row?accessRowId(row):null;
    const action=c.op==='entity.create'?'create':c.op==='entity.delete'?'delete':'edit';
    const fields=Object.keys(c.data||{});
    if(p) {
      const required=[action];
      const special=permissionFor(kind,p); if(special) required.push(special);
      if(row?.kind==='project') required.push('structure');
      if(c.op==='entity.restore') required.push('history');
      requireAccess(db,u,[...new Set(required)],p,section,accessRow,fields.length?fields:null);
    }
    const special=permissionFor(kind,p); if(!p&&special) requireAccess(db,u,[action,special],p,section,accessRow,fields.length?fields:null);
    assert(p || special,'Неизвестная область записи');
  }
}
function referencesEntity(db,u,p,row,targetId) {
  if(row.parent_id===targetId) return true;
  for(const key of ['sectionId','vendorId','categoryId','obligationId','selectionId','fileId']) if(row.data[key]===targetId) return true;
  if(row.kind!=='row') return false;
  const table=entity(db,row.parent_id); if(!table||table.agency_id!==u.agency_id||table.project_id!==p) return false;
  return table.data.columns.some(column=>['relation','file'].includes(column.type)&&row.data[column.id]===targetId);
}
function mutateEntity(db,u,c) {
  const p=c.projectId||null,old=c.entityId?getScoped(db,u,c.entityId):null,kind=old?.kind||c.kind;
  assert(!typedKinds.has(kind),'Используйте специальное действие этого раздела',409);
  if(old) version(old,c.version);
  assert(c.op==='entity.create'||old,'Запись не найдена',404);
  if(old&&c.op!=='entity.restore') assert(!old.deleted,'Запись удалена. Сначала восстановите её.',409);
  if(kind==='row') {
    const table=getScoped(db,u,old?.parent_id||c.parentId,p,'table');
    assert(!table.deleted,'Таблица удалена. Восстановите её перед сохранением.',409);
    assert(table.version===c.schemaVersion,'Структура таблицы изменилась. Проверьте правку перед повтором.',409,{table});
  }
  if(c.op==='entity.delete') {
    if(kind==='obligation') {
      assert(!entities(db,u.agency_id,p,'movement').some(m=>m.data.obligationId===old.id),'У статьи есть выплаты. Сначала исправьте или отмените их.',409);
      assert(!entities(db,u.agency_id,p,'selection').some(m=>m.data.obligationId===old.id),'Статья связана с выбранным подрядчиком. Сначала снимите выбор.',409);
    }
    if(kind==='selection'&&old.data.obligationId) {
      const obligation=getScoped(db,u,old.data.obligationId,p,'obligation');
      if(!obligation.deleted) {
        requireAccess(db,u,['finance','delete'],p,'budget',obligation.id,null);
        assert(!entities(db,u.agency_id,p,'movement').some(m=>m.data.obligationId===obligation.id),'У подрядчика есть выплаты: сначала исправьте их.',409);
        change(db,u,obligation,obligation.data,true,'delete');
      }
    }
    const references=entities(db,u.agency_id,p).filter(r=>r.id!==old.id&&referencesEntity(db,u,p,r,old.id));
    if(references.length) assert(c.confirm===true,'Есть связанные данные. Удаление скроет запись, история и связи сохранятся.',409,{references:references.map(r=>({id:r.id,kind:r.kind,name:r.data.name||r.data.title||r.id}))});
    return change(db,u,old,old.data,true,'delete');
  }
  let data={...(old?.data||{}),...(c.data||{})};
  if(c.op==='entity.restore') { assert(old.deleted || c.auditId,'Выберите удалённую запись или версию'); if(c.auditId) { const h=db.prepare('SELECT * FROM audit WHERE id=? AND entity_id=? AND agency_id=?').get(c.auditId,old.id,u.agency_id); assert(h,'Версия не найдена'); data=JSON.parse(h.before_json||h.after_json).data; } }
  if(kind==='row'&&old) {
    const table=getScoped(db,u,old.parent_id,p,'table'); validateRow(db,u,table,data,Object.keys(c.data||{}));
  } else data=validateData(db,u,kind,data,p,old?.parent_id||c.parentId,old);
  let result=old?change(db,u,old,data,false,c.op==='entity.restore'?'restore':'edit'):insert(db,u,kind,data,p,c.parentId||null);
  if(kind==='selection') {
    // Project prices are snapshots. General catalog updates never propagate here.
    const existing=data.obligationId?getScoped(db,u,data.obligationId,p,'obligation'):null;
    const obligationFields=['title','agreed','priceKind','dueDate','condition','fee','selectionId'];
    if(data.selected) {
      requireAccess(db,u,c.op==='entity.restore'?['finance','history']:['finance'],p,'budget',existing?.id??null,obligationFields);
      const obligationData={...(existing?.data||{}),title:data.title,agreed:data.price,priceKind:data.price===null?'unknown':'amount',planned:existing?.data.planned??null,dueDate:data.dueDate||'',condition:data.terms||'',fee:false,selectionId:result.id};
      const ob=existing?change(db,u,existing,obligationData,false,existing.deleted?'restore':'edit'):insert(db,u,'obligation',obligationData,p);
      result=change(db,u,result,{...data,obligationId:ob.id});
    } else if(existing) { requireAccess(db,u,['finance','delete'],p,'budget',existing.id,obligationFields); assert(!entities(db,u.agency_id,p,'movement').some(m=>m.data.obligationId===existing.id),'У подрядчика есть выплаты: сначала исправьте их.',409); change(db,u,existing,existing.data,true,'delete'); result=change(db,u,result,{...data,obligationId:null}); }
    validateLedger(entities(db,u.agency_id,p));
  }
  if(kind==='obligation') {
    if(data.selectionId) { const sel=getScoped(db,u,data.selectionId,p,'selection'); assert(!sel.deleted,'Выбранный подрядчик удалён',409); requireAccess(db,u,'edit',p,'vendors',sel.id,['title','price','terms']); change(db,u,sel,{...sel.data,title:data.title,price:data.agreed,terms:data.condition||''}); }
    validateLedger(entities(db,u.agency_id,p));
  }
  return result;
}
function movement(db,u,c) {
  const p=c.projectId||null,old=c.entityId?getScoped(db,u,c.entityId,p,'movement'):null;
  if(old) { version(old,c.version); assert(!old.deleted,'Операция уже удалена',409); }
  let d={...c.data};
  if(c.op==='movement.delete') {
    assert(old,'Операция не найдена');
    if(old.data.obligationId) { const ob=getScoped(db,u,old.data.obligationId,p,'obligation'); requireAccess(db,u,'finance',p,'budget',ob.id); change(db,u,ob,ob.data); }
    const r=change(db,u,old,old.data,true,'delete'); validateLedger(entities(db,u.agency_id,p)); return r;
  }
  assert(p?['deposit','payment','refund','transfer','fee'].includes(d.type):['income','expense'].includes(d.type),'Неверный вид операции');
  if(old?.data.obligationId&&['payment','fee'].includes(d.type)) assert(d.obligationId===old.data.obligationId,'Чтобы сменить статью выплаты, удалите операцию и создайте новую.',409);
  amount(d.amount); assert(d.amount>0,'Сумма должна быть больше нуля'); d.date=date(d.date,false); d.description=text(d.description,'Описание',1,3000);
  if(['deposit','refund','payment'].includes(d.type)) { if(d.counterparty!==undefined) d.counterparty=text(d.counterparty,'Участник',1,500); }
  else delete d.counterparty;
  if(d.method!==undefined) d.method=text(d.method,'Способ оплаты',1,100);
  d.source=p?(d.source||'custody'):'direct'; assert(['custody','direct'].includes(d.source),'Неверный источник');
  if(p&&['deposit','refund','transfer'].includes(d.type)) assert(d.source==='custody','Этот вид движения относится к средствам пары');
  if(d.type==='deposit'||d.type==='transfer') d.to=text(d.to,'Получатель');
  if(d.type==='transfer'||d.type==='refund'||(['payment','fee'].includes(d.type)&&d.source==='custody')) d.from=text(d.from,'Выдавший организатор');
  if(d.type==='transfer') assert(d.to!==d.from,'Выберите разных организаторов');
  for(const key of ['from','to']) if(d[key]) { const person=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(d[key],u.agency_id); assert(person&&(!p||canHoldFunds(db,person,p)),'Организатор не может учитывать средства этого проекта'); }
  if(d.fileId) { const file=getScoped(db,u,d.fileId,p,'file'); assert(!file.deleted,'Файл удалён'); requireAccess(db,u,['read','files'],p,'files',file.id); }
  if((!p||d.type==='fee')&&d.categoryId) { const category=getScoped(db,u,d.categoryId,null,'category'); assert(!category.deleted,'Категория удалена'); }
  if(p&&d.type!=='fee') delete d.categoryId;
  if(['payment','fee'].includes(d.type)) {
    const ob=getScoped(db,u,d.obligationId,p,'obligation'); assert(!ob.deleted,'Обязательство удалено',409); requireAccess(db,u,'finance',p,'budget',ob.id);
    version(ob,c.obligationVersion); change(db,u,ob,ob.data); // Independent device actions conflict, even with different command IDs.
    if(old&&old.data.obligationId!==ob.id) { const previous=getScoped(db,u,old.data.obligationId,p,'obligation'); change(db,u,previous,previous.data); }
  } else delete d.obligationId;
  if(old?.data.obligationId&&!['payment','fee'].includes(d.type)) { const ob=getScoped(db,u,old.data.obligationId,p,'obligation'); change(db,u,ob,ob.data); }
  if(!p) { delete d.from; delete d.to; delete d.obligationId; }
  else if(d.type==='deposit') { delete d.from; delete d.obligationId; }
  else if(d.type==='refund') { delete d.to; delete d.obligationId; }
  else if(d.type==='transfer') delete d.obligationId;
  else { delete d.to; if(d.source==='direct') delete d.from; }
  const row=old?change(db,u,old,d):insert(db,u,'movement',d,p); validateLedger(entities(db,u.agency_id,p)); return row;
}

export function upload(db,u,p,body) {
  u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(u.id,u.agency_id); assert(u,'Доступ отозван',403);
  assert(projectVisible(db,u,p),'Проект недоступен',403); requireAccess(db,u,['create','files'],p,'files',null,['name','size','mime']);
  const name=text(body.name,'Имя файла',1,200),bytes=Buffer.from(body.content||'','base64'); assert(bytes.length>0&&bytes.length<=8*1024*1024,'Размер файла: от 1 байта до 8 МБ');
  return transaction(db,()=>{ const r=insert(db,u,'file',{name,size:bytes.length,mime:body.mime||'application/octet-stream'},p); db.prepare('INSERT INTO blobs VALUES(?,?)').run(r.id,bytes); return r; });
}
export function download(db,u,id) {
  u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(u.id,u.agency_id); assert(u,'Доступ отозван',403);
  const r=getScoped(db,u,id,undefined,'file'); assert(!r.deleted,'Файл удалён',404); requireAccess(db,u,['read','files'],r.project_id,'files',id,Object.keys(r.data)); return {row:r,content:db.prepare('SELECT content FROM blobs WHERE id=?').get(id).content};
}

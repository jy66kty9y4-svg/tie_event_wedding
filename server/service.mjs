import { assert, transaction, entity, entities, insert, change, version, uid, now, audit } from './db.mjs';
import { token, digest, passwordHash, checkPassword, createSession, publicUser, defaults, grant, grants, can, requireAccess, rateLimit } from './auth.mjs';
import { text, amount, date, safeUrl, getScoped, projectVisible, createProject, initialTemplate, validateColumns, validateRow, financials, validateLedger, sectionOf } from './model.mjs';
import { permissions } from '../src/shared.js';

export function bootstrap(db,b) {
  return transaction(db,()=>{
    const id=uid(),slug=text(b.slug,'Адрес агентства').toLowerCase(); assert(/^[a-z0-9-]{2,50}$/.test(slug),'Адрес: латинские буквы, цифры и дефис');
    db.prepare('INSERT INTO agencies(id,slug,name,settings) VALUES(?,?,?,?)').run(id,slug,text(b.agencyName),JSON.stringify({tagline:'Свадьба, собранная вместе',description:'Организация свадьбы от первой идеи до последнего танца.',contact:'',services:['Организация под ключ','Координация свадебного дня','Концепция и оформление'],portfolio:[]}));
    const user={id:uid(),agency_id:id,email:email(b.email),name:text(b.name),protected:1,disabled:0};
    db.prepare('INSERT INTO users(id,agency_id,email,name,password,protected) VALUES(?,?,?,?,?,1)').run(user.id,id,user.email,user.name,passwordHash(b.password));
    const roles=defaults(db,id); grant(db,user,roles[0].id); insert(db,user,'template',initialTemplate());
    for(const name of ['Гонорары','Аренда','Зарплата','Продвижение','Прочее']) insert(db,user,'category',{name,scope:'agency',archived:false});
    return {user:publicUser(user),token:createSession(db,user)};
  });
}
function email(v) { const e=text(v,'Email',3,200).toLowerCase(); assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),'Проверьте email'); return e; }
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
    return {user:publicUser(u),token:createSession(db,u)};
  });
}
function acceptInvitation(db,u,raw) {
  const invite=db.prepare('SELECT * FROM invitations WHERE digest=? AND agency_id=?').get(digest(raw),u.agency_id);
  assert(invite && invite.expires>Date.now() && (!invite.used_by||invite.used_by===u.id) && invite.email===u.email,'Приглашение недействительно, истекло или выписано на другой email',403);
  const p=getScoped(db,u,invite.project_id,undefined,'project'); assert(!p.deleted,'Проект удалён');
  if(!invite.used_by) grant(db,u,invite.role_id,invite.project_id,JSON.parse(invite.restrictions));
  db.prepare('UPDATE invitations SET used_by=? WHERE digest=?').run(u.id,digest(raw)); return {projectId:invite.project_id};
}
export function publicInfo(db,slug='tie') {
  const a=db.prepare('SELECT * FROM agencies WHERE slug=?').get(slug);
  return a?{id:a.id,slug:a.slug,name:a.name,...JSON.parse(a.settings),setup:false}:{setup:!db.prepare('SELECT id FROM agencies LIMIT 1').get(),notFound:true};
}
function filteredRow(db,u,r) {
  const section=sectionOf(r);
  if(!can(db,u,'read',r.project_id,section,r.id)) return null;
  const data={}; for(const [key,v] of Object.entries(r.data)) if(can(db,u,'read',r.project_id,section,r.id,key)) data[key]=v;
  return {...r,data};
}
export function snapshot(db,u,project=null,offline=false) {
  const agency=db.prepare('SELECT * FROM agencies WHERE id=?').get(u.agency_id);
  const result={user:publicUser(u),agency:{id:agency.id,slug:agency.slug,name:agency.name,settings:JSON.parse(agency.settings),version:agency.version},grants:grants(db,u),time:now()};
  if(project) {
    assert(projectVisible(db,u,project),'Проект недоступен',403);
    const p=getScoped(db,u,project,undefined,'project'), all=entities(db,u.agency_id,project);
    result.project=p;
    const tables=all.filter(r=>r.kind==='table'&&can(db,u,'read',project,r.id)).map(r=>({...r,data:{...r.data,columns:r.data.columns.filter(c=>can(db,u,'read',project,r.id,null,c.id))}}));
    const prepared=tables.filter(t=>t.data.offline).map(t=>t.id);
    const payouts=offline && (p.data.offline||[]).includes('payouts') && can(db,u,'read',project,'budget');
    result.entities=[];
    for(const row of all) {
      if(row.kind==='table') { const t=tables.find(t=>t.id===row.id); if(t&&(!offline||prepared.includes(t.id))) result.entities.push(t); continue; }
      if(row.kind==='section') { if(!offline||tables.some(t=>prepared.includes(t.id)&&t.data.sectionId===row.id)) result.entities.push(row); continue; }
      if(offline) {
        if(row.kind==='row'&&!prepared.includes(row.parent_id)) continue;
        if(row.kind==='obligation'&&!payouts) continue;
        if(!['row','obligation','section'].includes(row.kind)) continue;
      }
      const filtered=filteredRow(db,u,row); if(filtered) result.entities.push(filtered);
    }
    // Payouts are a separate, limited view; do not preload the full estimate/ledger.
    if(payouts) {
      const f=financials(all);
      result.entities=result.entities.map(r=>r.kind==='obligation'?{...r,data:Object.fromEntries(Object.entries({...r.data,paid:f.paid[r.id]||0,due:(r.data.agreed||0)-(f.paid[r.id]||0)}).filter(([k])=>['title','agreed','priceKind','dueDate','condition','responsible','fee','paid','due'].includes(k)&&can(db,u,'read',project,'budget',r.id,k)))}:r);
    }
    if(!offline && can(db,u,'read',project,'budget') && can(db,u,'read',project,'budget',null,'amount') && can(db,u,'read',project,'budget',null,'agreed')) result.financials=financials(result.entities);
    result.members=can(db,u,'invite',project)?db.prepare('SELECT DISTINCT u.id,u.name,u.email FROM users u JOIN grants g ON g.user_id=u.id WHERE g.agency_id=? AND g.project_id=?').all(u.agency_id,project):[];
    if(!offline && can(db,u,'history',project)) result.history=db.prepare('SELECT a.*,u.name AS author FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.agency_id=? AND a.project_id=? ORDER BY a.created_at DESC LIMIT 200').all(u.agency_id,project);
    if(offline) { result.offline=true; result.expiresAt=Date.now()+7*86400000; result.project={...p,data:{name:p.data.name,date:p.data.date,offline:p.data.offline}}; result.agency={id:agency.id,name:agency.name}; }
    return result;
  }
  result.projects=entities(db,u.agency_id,null,'project').filter(p=>projectVisible(db,u,p.id));
  result.applications=entities(db,u.agency_id,null,'application').filter(a=>a.data.userId===u.id||can(db,u,'applications'));
  result.notifications=entities(db,u.agency_id,null,'notification').filter(n=>n.data.userId===u.id);
  result.global=entities(db,u.agency_id,null).filter(r=>(['vendor','vendorCategory'].includes(r.kind)&&can(db,u,'catalog'))||(r.kind==='template'&&can(db,u,'templates'))||(['movement','category'].includes(r.kind)&&can(db,u,'agencyFinance')));
  if(can(db,u,'agencyFinance')) {
    const fees=db.prepare("SELECT * FROM entities WHERE agency_id=? AND kind='movement' AND deleted=0 AND json_extract(data,'$.type')='fee'").all(u.agency_id).map(r=>({...r,data:JSON.parse(r.data)}));
    result.global.push(...fees); result.financials=financials(result.global);
  }
  if(can(db,u,'catalog')) result.vendorHistory=db.prepare("SELECT id,project_id,data FROM entities WHERE agency_id=? AND kind='selection' AND deleted=0").all(u.agency_id).map(r=>({...r,data:JSON.parse(r.data)}));
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
function permissionFor(kind,project) { if(project) return ['obligation','movement'].includes(kind)?'finance':kind==='file'?'files':['table','section'].includes(kind)?'structure':null; return ({vendor:'catalog',vendorCategory:'catalog',template:'templates',category:'agencyFinance',movement:'agencyFinance'})[kind]; }
function validateData(db,u,kind,data,p,parent,current=null) {
  assert(data&&typeof data==='object'&&!Array.isArray(data),'Проверьте данные'); const d=structuredClone(data);
  if(['section','table','vendor','category','vendorCategory','template'].includes(kind)) d.name=text(d.name);
  if(kind==='project') { d.name=text(d.name); d.date=date(d.date); d.limit=amount(d.limit??null,true); assert(['planning','confirmed','completed','archived'].includes(d.status),'Неизвестный статус'); assert(Array.isArray(d.offline)&&d.offline.every(s=>['payouts','budget','vendors','files'].includes(s)),'Проверьте офлайн-разделы'); }
  if(kind==='section') { d.order=Number(d.order)||0; d.archived=!!d.archived; }
  if(kind==='table') {
    validateColumns(d.columns); const s=getScoped(db,u,d.sectionId,p,'section'); assert(!s.deleted,'Раздел удалён'); d.order=Number(d.order)||0; d.archived=!!d.archived; d.offline=!!d.offline;
    if(current) {
      const incompatible=current.data.columns.filter(c=>!d.columns.some(n=>n.id===c.id&&n.type===c.type));
      if(incompatible.length) assert(d.confirmStructure===true,'Изменение затронет существующие значения. Подтвердите последствия.',409,{affectedRows:entities(db,u.agency_id,p,'row').filter(r=>r.parent_id===current.id).length,columns:incompatible.map(c=>c.name)});
      delete d.confirmStructure;
    }
  }
  if(kind==='row') { const t=getScoped(db,u,parent,p,'table'); assert(!t.deleted,'Таблица удалена',409); validateRow(db,u,t,d); }
  if(kind==='category'||kind==='vendorCategory') { d.archived=!!d.archived; if(p) d.scope='wedding'; }
  if(kind==='vendor') {
    d.contact=String(d.contact||''); d.portfolio=safeUrl(d.portfolio); d.price=amount(d.price??null,true); d.archived=!!d.archived;
    if(d.categoryId) getScoped(db,u,d.categoryId,null,'vendorCategory'); d.updatedOn=date(d.updatedOn||now().slice(0,10));
  }
  if(kind==='obligation') {
    d.title=text(d.title); assert(['unknown','included','amount'].includes(d.priceKind),'Выберите тип стоимости'); d.agreed=d.priceKind==='amount'?amount(d.agreed):null; d.planned=amount(d.planned??null,true); d.dueDate=date(d.dueDate); d.fee=!!d.fee;
    if(d.categoryId) { const c=getScoped(db,u,d.categoryId,p,'category'); assert(!c.deleted,'Категория удалена'); }
    if(d.responsible) { const person=db.prepare('SELECT id FROM users WHERE id=? AND agency_id=?').get(d.responsible,u.agency_id); assert(person,'Ответственный не найден'); }
  }
  if(kind==='selection') {
    d.title=text(d.title); if(d.vendorId) { const v=getScoped(db,u,d.vendorId,null,'vendor'); assert(!v.deleted,'Подрядчик удалён'); }
    d.price=amount(d.price??null,true); d.selected=!!d.selected;
    if(current?.data.obligationId) d.obligationId=current.data.obligationId; else delete d.obligationId;
  }
  if(kind==='template') {
    assert(Array.isArray(d.sections)&&d.sections.length<=30&&Array.isArray(d.tables)&&d.tables.length<=50,'Проверьте разделы и таблицы шаблона');
    const keys=new Set(); for(const s of d.sections) { text(s.key); text(s.name); assert(!keys.has(s.key),'Ключ раздела повторяется'); keys.add(s.key); }
    for(const t of d.tables) { text(t.name); text(t.key); assert(keys.has(t.section),'Раздел таблицы не найден'); validateColumns(t.columns); }
    assert(Array.isArray(d.categories)&&d.categories.length<=100&&d.categories.every(c=>typeof c==='string'&&c.length<=120),'Проверьте категории');
  }
  return d;
}
export function execute(db,user,cmd) {
  assert(cmd && typeof cmd==='object' && /^[a-zA-Z0-9_-]{8,100}$/.test(cmd.id||''),'Команда должна иметь уникальный ID');
  // All writes including duplicate checks run after current authorization, inside a transaction.
  return transaction(db,()=>{
    const u=db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(user.id); assert(u,'Доступ отозван',403);
    const {op,projectId:p=null}=cmd;
    if(p) { const proj=getScoped(db,u,p,undefined,'project'); assert(!proj.deleted && projectVisible(db,u,p),'Проект недоступен',403); }
    authorizeCommand(db,u,cmd);
    const hash=digest(JSON.stringify(cmd)), previous=db.prepare('SELECT * FROM commands WHERE id=? AND user_id=?').get(cmd.id,u.id);
    if(previous) { assert(previous.digest===hash,'Этот ID уже использован для другого действия',409); return JSON.parse(previous.result); }
    let result;
    if(op==='project.create') { requireAccess(db,u,'projects'); const template=cmd.templateId?getScoped(db,u,cmd.templateId,null,'template'):null; result=createProject(db,u,cmd.data,template); }
    else if(op==='application.create') {
      assert(!entities(db,u.agency_id,null,'application').some(a=>a.data.userId===u.id&&['review','clarification','approved'].includes(a.data.status)),'У вас уже есть заявка',409);
      result=insert(db,u,'application',{userId:u.id,name:text(cmd.data.name),date:date(cmd.data.date),contact:text(cmd.data.contact),message:text(cmd.data.message,'Пожелания',1,4000),status:'review',reason:'',projectId:null});
    } else if(op==='application.review') {
      requireAccess(db,u,'applications'); const a=getScoped(db,u,cmd.entityId,null,'application');
      if(a.data.status==='approved'&&cmd.status==='approved') result=a;
      else {
        version(a,cmd.version); assert(['approved','rejected','clarification'].includes(cmd.status),'Проверьте решение'); assert(a.data.status!=='approved','Проект уже создан',409);
        const reason=cmd.status==='approved'?(cmd.reason||''):text(cmd.reason,'Причина',3,1000); let projectId=null;
        if(cmd.status==='approved') {
          const project=createProject(db,u,{name:a.data.name,date:a.data.date}); projectId=project.id;
          const role=db.prepare("SELECT id FROM roles WHERE agency_id=? AND name='Участник пары'").get(u.agency_id);
          const applicant=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=?').get(a.data.userId,u.agency_id); grant(db,applicant,role.id,projectId);
        }
        result=change(db,u,a,{...a.data,status:cmd.status,reason,projectId});
        insert(db,u,'notification',{userId:a.data.userId,title:cmd.status==='approved'?'Заявка одобрена. Ваш проект открыт.':cmd.status==='rejected'?'Заявка отклонена':'Уточните детали заявки',body:reason,projectId});
      }
    } else if(op==='invite.create') {
      requireAccess(db,u,'invite',p); const role=db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(cmd.roleId,u.agency_id); assert(role,'Роль не найдена');
      assert(!role.protected,'Нельзя приглашать с ролью администратора');
      const restrictions=validateRestrictions(cmd.restrictions),raw=token();
      // Only access managers may delegate permissions outside the ordinary couple role.
      if(!can(db,u,'access')) assert(role.name==='Участник пары','Выбор расширенной роли требует управления доступом',403);
      db.prepare('INSERT INTO invitations VALUES(?,?,?,?,?,?,NULL,?)').run(digest(raw),u.agency_id,p,email(cmd.email),role.id,Date.now()+7*86400000,JSON.stringify(restrictions)); result={token:raw,email:cmd.email,expiresAt:Date.now()+7*86400000};
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
      for(const g of cmd.grants) { const r=db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(g.roleId,u.agency_id); assert(r,'Роль не найдена'); if(g.projectId) getScoped(db,u,g.projectId,undefined,'project'); else assert(!['Участник пары','Координатор','Подрядчик'].includes(r.name),'Этой роли нужно назначить конкретный проект'); validateRestrictions(g.restrictions); }
      const before=grants(db,target); db.prepare('DELETE FROM grants WHERE user_id=?').run(target.id);
      for(const g of cmd.grants) grant(db,target,g.roleId,g.projectId||null,validateRestrictions(g.restrictions));
      db.prepare('UPDATE users SET version=version+1,disabled=? WHERE id=?').run(Number(!!cmd.disabled),target.id); result={id:target.id}; audit(db,u,{id:target.id,kind:'grants',project_id:null,data:cmd.grants},before,'access');
    } else if(op==='settings.save') {
      requireAccess(db,u,'settings'); const a=db.prepare('SELECT * FROM agencies WHERE id=?').get(u.agency_id); version(a,cmd.version);
      const s=cmd.settings; text(s.tagline,'Заголовок',1,160); text(s.description,'Описание',1,5000); assert(Array.isArray(s.services)&&s.services.length<=20,'Проверьте услуги');
      assert(Array.isArray(s.portfolio)&&s.portfolio.length<=40,'Проверьте портфолио'); s.portfolio.forEach(x=>{text(x.title); safeUrl(x.image);});
      db.prepare('UPDATE agencies SET name=?,settings=?,version=version+1 WHERE id=?').run(text(cmd.name),JSON.stringify(s),u.agency_id); result={ok:true}; audit(db,u,{id:u.agency_id,kind:'settings',project_id:null,data:s},a,'edit');
    } else if(op==='movement.save'||op==='movement.delete') result=movement(db,u,cmd);
    else if(op==='entity.create'||op==='entity.edit'||op==='entity.delete'||op==='entity.restore') result=mutateEntity(db,u,cmd);
    else assert(false,'Неизвестное действие');
    db.prepare('INSERT INTO commands VALUES(?,?,?,?)').run(cmd.id,u.id,hash,JSON.stringify(result)); return result;
  });
}

function authorizeCommand(db,u,c) {
  const p=c.projectId||null;
  const actions={'project.create':'projects','application.review':'applications','role.save':'access','grants.save':'access','settings.save':'settings','invite.create':'invite'};
  if(actions[c.op]) requireAccess(db,u,actions[c.op],c.op==='invite.create'?p:null);
  if(c.op.startsWith('movement.')) requireAccess(db,u,p?'finance':'agencyFinance',p,p?'budget':null,c.data?.obligationId||null);
  if(c.op.startsWith('entity.')) {
    const row=c.entityId?getScoped(db,u,c.entityId,p===null?undefined:p):null,kind=row?.kind||c.kind;
    if(row) assert(row.project_id===p || kind==='project'&&row.id===p,'Область команды не совпадает с записью',403);
    const allowed=['project','section','table','row','obligation','category','vendorCategory','vendor','selection','template','file']; assert(allowed.includes(kind),'Этот тип записи меняется отдельным действием');
    const section=row?sectionOf(row):kind==='row'?c.parentId:({table:c.entityId,obligation:'budget',selection:'vendors',file:'files'})[kind]||kind;
    const action=c.op==='entity.create'?'create':c.op==='entity.delete'?'delete':'edit';
    if(p) {
      requireAccess(db,u,action,p,section,row?.id||null);
      if(row?.kind==='project') requireAccess(db,u,'structure',p);
      if(c.op==='entity.restore') requireAccess(db,u,'history',p,section);
    }
    const special=permissionFor(kind,p); if(special) requireAccess(db,u,special,p,section,row?.id||null);
    assert(p || special,'Неизвестная область записи');
    for(const key of Object.keys(c.data||{})) if(p) requireAccess(db,u,action,p,section,row?.id||null,key);
  }
}
function mutateEntity(db,u,c) {
  const p=c.projectId||null,old=c.entityId?getScoped(db,u,c.entityId):null,kind=old?.kind||c.kind;
  if(old) version(old,c.version);
  assert(c.op==='entity.create'||old,'Запись не найдена',404);
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
    const references=entities(db,u.agency_id,p).filter(r=>r.id!==old.id&&(r.parent_id===old.id||JSON.stringify(r.data).includes(old.id)));
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
    if(data.selected) {
      requireAccess(db,u,'finance',p,'budget');
      const obligationData={...(existing?.data||{}),title:data.title,agreed:data.price,priceKind:data.price===null?'unknown':'amount',planned:existing?.data.planned??null,dueDate:data.dueDate||'',condition:data.terms||'',fee:false,selectionId:result.id};
      const ob=existing?change(db,u,existing,obligationData):insert(db,u,'obligation',obligationData,p);
      result=change(db,u,result,{...data,obligationId:ob.id});
    } else if(existing) { assert(!entities(db,u.agency_id,p,'movement').some(m=>m.data.obligationId===existing.id),'У подрядчика есть выплаты: сначала исправьте их.',409); change(db,u,existing,existing.data,true,'delete'); result=change(db,u,result,{...data,obligationId:null}); }
  }
  if(kind==='obligation') {
    if(data.selectionId) { const sel=getScoped(db,u,data.selectionId,p,'selection'); change(db,u,sel,{...sel.data,title:data.title,price:data.agreed,terms:data.condition||''}); }
    validateLedger(entities(db,u.agency_id,p));
  }
  return result;
}
function movement(db,u,c) {
  const p=c.projectId||null,old=c.entityId?getScoped(db,u,c.entityId,p,'movement'):null;
  if(old) version(old,c.version);
  let d={...c.data};
  if(c.op==='movement.delete') {
    assert(old,'Операция не найдена');
    if(old.data.obligationId) { const ob=getScoped(db,u,old.data.obligationId,p,'obligation'); requireAccess(db,u,'finance',p,'budget',ob.id); change(db,u,ob,ob.data); }
    const r=change(db,u,old,old.data,true,'delete'); validateLedger(entities(db,u.agency_id,p)); return r;
  }
  assert(p?['deposit','payment','refund','transfer','fee'].includes(d.type):['income','expense'].includes(d.type),'Неверный вид операции');
  amount(d.amount); assert(d.amount>0,'Сумма должна быть больше нуля'); d.date=date(d.date,false); d.description=String(d.description||''); assert(d.description.length<=3000,'Описание слишком длинное');
  d.source=d.source||'custody'; assert(['custody','direct'].includes(d.source),'Неверный источник');
  if(d.type==='deposit'||d.type==='transfer') d.to=text(d.to,'Получатель');
  if(d.type==='transfer'||d.type==='refund'||(['payment','fee'].includes(d.type)&&d.source==='custody')) d.from=text(d.from,'Выдавший организатор');
  if(d.type==='transfer') assert(d.to!==d.from,'Выберите разных организаторов');
  for(const key of ['from','to']) if(d[key]) assert(db.prepare('SELECT id FROM users WHERE id=? AND agency_id=?').get(d[key],u.agency_id),'Организатор не найден');
  if(d.fileId) getScoped(db,u,d.fileId,p,'file');
  if(!p&&d.categoryId) getScoped(db,u,d.categoryId,null,'category');
  if(['payment','fee'].includes(d.type)) {
    const ob=getScoped(db,u,d.obligationId,p,'obligation'); assert(!ob.deleted,'Обязательство удалено',409); requireAccess(db,u,'finance',p,'budget',ob.id);
    version(ob,c.obligationVersion); change(db,u,ob,ob.data); // Independent device actions conflict, even with different command IDs.
    if(old&&old.data.obligationId!==ob.id) { const previous=getScoped(db,u,old.data.obligationId,p,'obligation'); change(db,u,previous,previous.data); }
  } else delete d.obligationId;
  if(old?.data.obligationId&&!['payment','fee'].includes(d.type)) { const ob=getScoped(db,u,old.data.obligationId,p,'obligation'); change(db,u,ob,ob.data); }
  const row=old?change(db,u,old,d):insert(db,u,'movement',d,p); validateLedger(entities(db,u.agency_id,p)); return row;
}

export function upload(db,u,p,body) {
  assert(projectVisible(db,u,p),'Проект недоступен',403); requireAccess(db,u,'files',p,'files'); requireAccess(db,u,'create',p,'files');
  const name=text(body.name,'Имя файла',1,200),bytes=Buffer.from(body.content||'','base64'); assert(bytes.length>0&&bytes.length<=8*1024*1024,'Размер файла: от 1 байта до 8 МБ');
  return transaction(db,()=>{ const r=insert(db,u,'file',{name,size:bytes.length,mime:body.mime||'application/octet-stream'},p); db.prepare('INSERT INTO blobs VALUES(?,?)').run(r.id,bytes); return r; });
}
export function download(db,u,id) {
  const r=getScoped(db,u,id,undefined,'file'); assert(!r.deleted,'Файл удалён',404); requireAccess(db,u,'read',r.project_id,'files',id); requireAccess(db,u,'files',r.project_id,'files',id); return {row:r,content:db.prepare('SELECT content FROM blobs WHERE id=?').get(id).content};
}

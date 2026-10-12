import {financeSheetColumns,obligationSheetColumns} from '../src/finance-sheet.js';
import {normalizeSheetLayout,GUEST_ACTIONS_COLUMN} from '../src/sheet.js';
import {validateTimingSchemaMutation} from './v2/timing.mjs';
import {guardProjectDateEdit,previewReschedule} from './v2/workflow/index.mjs';
import { assert, transaction, entity, entities, insert, change, version, uid, now, audit } from './db.mjs';
import { token, digest, passwordHash, checkPassword, createSession, publicUser, defaults, grant, grants, can, canHoldFunds, canUseTeamTiming, requireAccess, rateLimit, withAuthorizationRead } from './auth.mjs';
import { text, amount, date, safeUrl, getScoped, projectVisible, createProject, initialTemplate, validateColumns, validateRow, financials, validateLedger, sectionOf, accessRowId } from './model.mjs';
import { PROJECT_FILE_MAX_BYTES, permissions, projectPermissions } from '../src/shared.js';
import { operations as v2Operations, typedKinds } from './v2/index.mjs';
import {guestInvites,validateGuestSchemaMutation,validateGuestRowMutation} from './v2/guest/index.mjs';
import { executeModule, members as assignableMembers } from './v2/common.mjs';
import { queueChanges, notifications, queueAccountRegistration, processOutbox } from './v2/calendar/index.mjs';
import { DEFAULT_VENDOR_CATEGORIES } from '../src/vendor-categories.js';
import { imageOptions, questionnaireQuestions } from '../src/questionnaire.js';
import { coupleBudgetFind, coupleBudgetViewGroups, coupleBudgetDefaultName, coupleBudgetDefaultNote, coupleBudgetAmountFields, coupleBudgetOrganizerGroups, coupleBudgetAgencyFee, coupleBudgetColumns, coupleBudgetBaseColumns } from '../src/couple-budget.js';
import { normalizePhone } from '../src/auth-identity.js';
import { normalizeBudgetFormat, rebaseBudgetFormat } from '../src/budget-format.js';
import {normalizeVendorLinks} from '../src/vendor-profile.js';
import {validateVendorPhoto,validateVendorGallery} from './vendor-profile.mjs';
import {normalizeVenue} from '../src/venue-profile.js';
import {WEDDING_STAGES,STAGE_STATUSES} from '../src/wedding-control.js';
import {weddingTemplate,templateSettings,templateTableSettings,templateColumns,templateSemanticMap} from './wedding-template.mjs';

export function bootstrap(db,b,sessionContext = {}) {
  return transaction(db,()=>{
    assert(!db.prepare('SELECT id FROM agencies LIMIT 1').get(),'Настройка уже выполнена',409);
    const id=uid(),slug=text(b.slug,'Адрес агентства').toLowerCase(); assert(/^[a-z0-9-]{2,50}$/.test(slug),'Адрес: латинские буквы, цифры и дефис');
    db.prepare('INSERT INTO agencies(id,slug,name,settings) VALUES(?,?,?,?)').run(id,slug,text(b.agencyName),JSON.stringify({tagline:'Свадьба, собранная вместе',description:'Организация свадьбы от первой идеи до последнего танца.',contact:'',services:['Организация под ключ','Координация свадебного дня','Концепция и оформление'],portfolio:[]}));
    const user={id:uid(),agency_id:id,...accountIdentity(b),name:text(b.name),protected:1,disabled:0};
    db.prepare('INSERT INTO users(id,agency_id,email,phone,name,password,protected) VALUES(?,?,?,?,?,?,1)').run(user.id,id,user.email,user.phone,user.name,passwordHash(b.password));
    const roles=defaults(db,id); grant(db,user,roles[0].id); insert(db,user,'template',initialTemplate());
    for(const name of ['Гонорары','Аренда','Зарплата','Продвижение','Прочее']) insert(db,user,'category',{name,scope:'agency',archived:false});
    for(const name of DEFAULT_VENDOR_CATEGORIES) insert(db,user,'vendorCategory',{name,archived:false});
    const saved=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    return {user:publicUser(saved),token:createSession(db,saved,sessionContext)};
  });
}
function email(v) { const e=text(v,'Email',3,200).toLowerCase(); assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),'Проверьте email'); return e; }
function accountIdentity(body, requireBoth = false) {
  const address=body.email?email(body.email):null;
  const phone=body.phone?normalizePhone(body.phone):null;
  assert(!body.phone||phone,'Проверьте номер телефона');
  if (requireBoth) {
    assert(address&&phone,'Укажите почту и телефон');
    assert(/^\+7\d{10}$/.test(phone),'Введите телефон в формате +7 (XXX) XXX-XX-XX');
  }
  assert(address||phone,'Укажите телефон или почту');
  return {email:address,phone};
}
function canManageUsers(db,u){return !!u.protected||can(db,u,'access')||can(db,u,'projects')&&grants(db,u).some(g=>g.project_id===null&&g.role_key==='organizer');}
function managerPermissions(db,u){return new Set(permissions.filter(permission=>can(db,u,permission)));}
function canManageAccount(db,u,target,allowed=null){if(!target||target.protected||target.id===u.id||!(allowed||canManageUsers(db,u)))return false;if(u.protected)return true;const granted=allowed||managerPermissions(db,u);return grants(db,target).every(g=>g.role_key!=='admin'&&g.permissions.every(p=>granted.has(p)));}
function canAssignUserRole(db,u,role,allowed=null){if(!role||role.protected||!(allowed||canManageUsers(db,u)))return false;if(u.protected)return true;const granted=allowed||managerPermissions(db,u);return JSON.parse(role.permissions).every(p=>granted.has(p));}
function revokeUserSessions(db,userId){db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);db.prepare('UPDATE orbit_session_registry SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND revoked_at IS NULL').run(now(),userId);}
function applicationData(data,db,u) {
  assert(data&&typeof data==='object'&&!Array.isArray(data),'Проверьте заявку');
  const source={};for(const [key,kind] of [['sourceCaseId','publicCase'],['sourcePackageId','servicePackage']])if(data[key]){const row=entity(db,data[key]);assert(row&&row.agency_id===u.agency_id&&!row.deleted&&row.kind===kind&&row.data.status==='published'&&row.data.publishedRevisionId,'Публикация больше недоступна. Уберите источник и отправьте обычную заявку.',409);source[key]=row.id;}
  return {name:text(data.name),date:date(data.date),contact:text(data.contact,'Контакт',3,500),message:text(data.message,'Пожелания',1,4000),...source,...(Object.hasOwn(data,'questionnaire')?{questionnaire:validateQuestionnaire(data.questionnaire),questionnaireSubmittedAt:now()}: {})};
}
function validateQuestionnaire(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Проверьте анкету');
  assert(Object.keys(value).length===questionnaireQuestions.length&&Object.keys(value).every(key=>questionnaireQuestions.some(question=>question.id===key)),'Проверьте вопросы анкеты');
  const answers={};
  for(const {id,label} of questionnaireQuestions){
    if(id==='images'){
      const selected=value[id];
      assert(Array.isArray(selected)&&selected.length>=1&&selected.length<=6,'Выберите близкие вам образы');
      answers[id]=selected.map(answer=>text(answer,label,1,200));
      assert(new Set(answers[id]).size===answers[id].length&&answers[id].filter(answer=>!imageOptions.includes(answer)).length<=1,'Проверьте выбранные образы');
    } else answers[id]=text(value[id],label,1,2000);
  }
  return answers;
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
export function authenticate(db,b,ip='local',sessionContext = {}) {
  rateLimit(db,'login:'+ip,40); const agency=db.prepare('SELECT id FROM agencies WHERE slug=?').get(b.slug||'tie');
  const identifier=b.identifier??b.phone??b.email;
  const address=typeof identifier==='string'&&identifier.includes('@')?identifier.toLowerCase().trim():null;
  const phone=address?null:normalizePhone(identifier);
  const u=agency&&(address?db.prepare('SELECT * FROM users WHERE agency_id=? AND email=?').get(agency.id,address):phone?db.prepare('SELECT * FROM users WHERE agency_id=? AND phone=?').get(agency.id,phone):null);
  assert(u && !u.disabled && checkPassword(b.password,u.password),'Неверные данные для входа',401);
  return {user:publicUser(u),token:createSession(db,u,sessionContext)};
}
export function register(db,b,ip='local',sessionContext = {}) {
  rateLimit(db,'register:'+ip,30);
  let entryId;
  const result=transaction(db,()=>{
    const agency=db.prepare('SELECT id FROM agencies WHERE slug=?').get(b.slug||'tie'); assert(agency,'Агентство не найдено',404);
    const u={id:uid(),agency_id:agency.id,name:text(b.name),...accountIdentity(b,true),protected:0,disabled:0};
    assert(!u.email||!db.prepare('SELECT id FROM users WHERE agency_id=? AND email=?').get(agency.id,u.email),'Этот email уже зарегистрирован. Войдите в аккаунт.',409);
    assert(!u.phone||!db.prepare('SELECT id FROM users WHERE agency_id=? AND phone=?').get(agency.id,u.phone),'Этот телефон уже зарегистрирован. Войдите в аккаунт.',409);
    db.prepare('INSERT INTO users(id,agency_id,email,phone,name,password) VALUES(?,?,?,?,?,?)').run(u.id,u.agency_id,u.email,u.phone,u.name,passwordHash(b.password));
    if(b.invitation) acceptInvitation(db,u,b.invitation);
    const assignments=grants(db,u);
    if (!assignments.length || assignments.every(assignment=>assignment.role_key==='couple')) {
      const entry=insert(db,u,'accountOnboarding',{userId:u.id,status:'pending',projectId:assignments[0]?.project_id||null,approvedBy:null,approvedAt:null,questionnaire:null,questionnaireSubmittedAt:null});
      entryId=entry.id;queueAccountRegistration(db,u,entry);
    }
    const saved=db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
    return {user:publicUser(saved),token:createSession(db,saved,sessionContext)};
  });
  // The durable job commits with signup; an immediate delivery failure is retried by the worker.
  if(entryId)try{processOutbox(db,Date.now(),100,{sourceId:entryId});}catch{}
  return result;
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
function accountEntry(db,u) {
  return entities(db,u.agency_id,null,'accountOnboarding').find(row=>row.data.userId===u.id);
}
function accountEntryView(db,entry) {
  if (!entry) return null;
  const project=entry.data.projectId?entity(db,entry.data.projectId):null;
  return {id:entry.id,version:entry.version,...entry.data,project:project&&!project.deleted&&project.agency_id===entry.agency_id?{id:project.id,version:project.version,name:project.data.name,date:project.data.date}:null};
}
function filteredRow(db,u,r) {
  const section=sectionOf(r);
  const accessRow=accessRowId(r);
  const required=['obligation','movement','category','coupleBudget','financeSheet'].includes(r.kind)?['read','finance']:r.kind==='file'?['read','files']:['read'];
  if(!can(db,u,required,r.project_id,section,accessRow)) return null;
  const table=r.kind==='row'?entity(db,r.parent_id):null;
  const liveFields=table&&!table.deleted?new Set(table.data.columns.map(column=>column.id)):null;
  const data={}; for(const [key,v] of Object.entries(r.data)) {
    if(key==='cellFormats'&&['coupleBudget','row','movement','obligation'].includes(r.kind)){
      const formats=Object.fromEntries(Object.entries(v).filter(([field])=>(!liveFields||liveFields.has(field))&&can(db,u,required,r.project_id,section,accessRow,field)));
      if(Object.keys(formats).length)data.cellFormats=formats;
    }else if(key==='sheetValues'&&['movement','obligation'].includes(r.kind)){data[key]=Object.fromEntries(Object.entries(v).filter(([field])=>can(db,u,required,r.project_id,section,accessRow,field)));
    }else if(key==='columns'&&r.kind==='financeSheet'){data[key]=v.filter(column=>can(db,u,required,r.project_id,section,accessRow,[column.id,...(column.type==='formula'?[...column.formula.matchAll(/\{([^}]+)\}/g)].map(match=>match[1]):[])]));
    }else if(key==='extraColumns'&&r.kind==='coupleBudget'){data[key]=v.filter(column=>can(db,u,required,r.project_id,section,accessRow,column.id));
    }else if(key==='extraValues'&&r.kind==='coupleBudget'){data[key]=Object.fromEntries(Object.entries(v).filter(([field])=>can(db,u,required,r.project_id,section,accessRow,field)));
    }else if(!(key==='agencyCommission'&&['obligation','selection'].includes(r.kind)&&!canHoldFunds(db,u,r.project_id))&&(!liveFields||liveFields.has(key))&&can(db,u,required,r.project_id,section,accessRow,key))data[key]=v;
  }
  return {...r,data};
}
function filteredMutationResult(db,u,row) { if(row?.kind==='project')return filteredProject(db,u,row);return row?.project_id&&['obligation','selection'].includes(row.kind)&&!canHoldFunds(db,u,row.project_id)?filteredRow(db,u,row):row; }
function redactOrganizerJson(value) { if(!value)return value;try{const parsed=JSON.parse(value);if(parsed?.data){delete parsed.data.agencyCommission;if(parsed.kind==='project')delete parsed.data.limit;}return JSON.stringify(parsed);}catch{return value;} }
function redactWeddingControlJson(value) {
  if(!value)return value;
  try{const row=JSON.parse(value);if(row.kind==='project'&&row.data)delete row.data.weddingControl;return JSON.stringify(row)}catch{return value}
}
function filteredProject(db,u,p) {
  const data={name:p.data.name,date:p.data.date,status:p.data.status};
  for(const key of ['location','limit','offline','notes','timeZone','readinessPolicy','leadOrganizerUserId','staffIntervals','personalInvitationsEnabled','taskPhases']) if((key!=='limit'||canHoldFunds(db,u,p.id))&&can(db,u,'read',p.id,'project',p.id,key)) data[key]=p.data[key];
  const mayReadControl=canUseTeamTiming(db,u,p.id)&&can(db,u,'read',p.id,'project',p.id,'weddingControl');
  if(mayReadControl)data.weddingControl=p.data.weddingControl||{};
  return {...p,data,canManageWeddingControl:mayReadControl&&can(db,u,'edit',p.id,'project',p.id,'weddingControl')};
}
function agencyRevenueProjection(db,u,projects) {
  const cards=[];
  for(const project of projects) {
    const rows=entities(db,u.agency_id,project.id).map(row=>filteredRow(db,u,row)).filter(Boolean),selections=new Map(rows.filter(row=>row.kind==='selection').map(row=>[row.id,row])),feePayments=rows.filter(row=>row.kind==='movement'&&row.data.type==='fee').reduce((sum,row)=>sum+(row.data.amount||0),0),items=[];
    const sheet=rows.find(row=>row.kind==='coupleBudget'),budgetFee=coupleBudgetAgencyFee(sheet?.data);
    for(const obligation of rows.filter(row=>row.kind==='obligation')) {
      const data=obligation.data,selection=selections.get(data.selectionId),counterparty=selection?.data?.title||data.title,commission=Number(data.agencyCommission||0),honorarium=data.fee?(data.priceKind==='amount'?Number(data.agreed||0):Number(data.planned||0)):0;
      if(commission>0)items.push({id:`${obligation.id}:commission`,obligationId:obligation.id,type:'commission',title:data.title,counterparty,amount:commission,dueDate:data.dueDate||''});
      if(!budgetFee.amountConfigured&&honorarium>0)items.push({id:`${obligation.id}:fee`,obligationId:obligation.id,type:'fee',title:data.title,counterparty,amount:honorarium,dueDate:data.dueDate||''});
    }
    if(budgetFee.amountConfigured)for(const item of budgetFee.items)items.push({id:`${sheet.id}:${item.row}:fee`,budgetRow:item.row,type:'fee',title:item.title,counterparty:item.title,amount:item.amount,prepaid:item.prepaid,dueDate:'',source:'coupleBudget'});
    const commissionExpected=items.filter(item=>item.type==='commission').reduce((sum,item)=>sum+item.amount,0),feeExpected=items.filter(item=>item.type==='fee').reduce((sum,item)=>sum+item.amount,0);
    const feePrepaid=budgetFee.prepaidConfigured?budgetFee.feePrepaid:feePayments;
    cards.push({projectId:project.id,projectName:project.data.name,date:project.data.date,status:project.data.status,commissionExpected,feeExpected,feePrepaid,feeRemaining:feeExpected-feePrepaid,feeSource:budgetFee.amountConfigured?'coupleBudget':'ledger',prepaidSource:budgetFee.prepaidConfigured?'coupleBudget':'ledger',totalExpected:commissionExpected+feeExpected,received:feePayments,items});
  }
  return {totalExpected:cards.reduce((sum,card)=>sum+card.totalExpected,0),commissionExpected:cards.reduce((sum,card)=>sum+card.commissionExpected,0),feeExpected:cards.reduce((sum,card)=>sum+card.feeExpected,0),feePrepaid:cards.reduce((sum,card)=>sum+card.feePrepaid,0),feeRemaining:cards.reduce((sum,card)=>sum+card.feeRemaining,0),received:cards.reduce((sum,card)=>sum+card.received,0),projects:cards.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||a.projectName.localeCompare(b.projectName,'ru'))};
}
function visibleTable(db,u,project,table) {
  if(!can(db,u,'read',project,table.id)) return null;
  const columns=table.data.columns.filter(column=>{
    const dependencies=column.type==='formula'?[...column.formula.matchAll(/\{([^}]+)\}/g)].map(match=>match[1]):[];
    return can(db,u,'read',project,table.id,undefined,[column.id,...dependencies]);
  });
  const rowOrder=(table.data.rowOrder||[]).filter(rowId=>{ const row=entity(db,rowId); return row&&!row.deleted&&row.parent_id===table.id&&can(db,u,'read',project,table.id,rowId); });
  return {...table,data:{...table.data,columns,rowOrder,sheetLayout:{columnWidths:Object.fromEntries(Object.entries(table.data.sheetLayout?.columnWidths||{}).filter(([id])=>columns.some(column=>column.id===id)||table.data.key==='guests'&&id===GUEST_ACTIONS_COLUMN)),rowHeights:Object.fromEntries(Object.entries(table.data.sheetLayout?.rowHeights||{}).filter(([id])=>{const row=entity(db,id);return row&&!row.deleted&&can(db,u,'read',project,table.id,id)}))}}};
}
export function snapshot(db,u,project=null,offline=false) {
  return withAuthorizationRead(db, () => readSnapshot(db,u,project,offline));
}
function readSnapshot(db,u,project,offline) {
  u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(u.id,u.agency_id);
  assert(u,'Доступ отозван',403);
  const agency=db.prepare('SELECT * FROM agencies WHERE id=?').get(u.agency_id);
  const stablePositions=new Map(db.prepare("SELECT id,rowid AS position FROM entities WHERE agency_id=? AND project_id IS ? AND kind IN ('row','movement','obligation')").all(u.agency_id,project).map(row=>[row.id,row.position]));
  const stableRow=row=>['row','movement','obligation'].includes(row.kind)?{...row,sheetOrder:stablePositions.get(row.id)}:row;
  const result={user:publicUser(u),agency:{id:agency.id,slug:agency.slug,name:agency.name,settings:JSON.parse(agency.settings),version:agency.version},grants:grants(db,u),time:now()};
  result.onboarding=accountEntryView(db,accountEntry(db,u));
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
    if(!offline){const site=all.find(r=>r.kind==='microsite');if(site&&can(db,u,'read',project,'microsite',site.id,null))result.microsite={id:site.id,version:site.version,shareId:site.data.shareId,status:site.data.status,rsvpDeadline:site.data.rsvpDeadline};const guestTable=all.find(r=>r.kind==='table'&&r.data.key==='guests');if(p.data.personalInvitationsEnabled===true&&guestTable&&can(db,u,'manageGuestInvites',project,guestTable.id,null,null))result.guestInvites=guestInvites(db,u,project,guestTable.id);}

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
        if(['obligation','category','movement','coupleBudget'].includes(row.kind)&&!budget&&!payouts) continue;
        if(row.kind==='movement'&&!budget) continue;
        if(row.kind==='category'&&!budget) continue;
        if(row.kind==='coupleBudget'&&!budget) continue;
        if(row.kind==='selection'&&!vendors) continue;
        if(row.kind==='file'&&!files) continue;
        if(!['row','obligation','category','movement','coupleBudget','selection','file','section'].includes(row.kind)) continue;
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
    else if(!offline){const f=financials(all);result.entities=result.entities.map(row=>row.kind==='obligation'?{...row,data:{...row.data,...(can(db,u,['read','finance'],project,'budget',row.id,'paid')?{paid:f.paid[row.id]||0}:{}),...(can(db,u,['read','finance'],project,'budget',row.id,'due')?{due:Math.max(0,(all.find(item=>item.id===row.id)?.data.agreed||0)-(f.paid[row.id]||0))}:{})}}:row);}
    const mayInvite=can(db,u,'invite',project);
    const mayUseFinance=can(db,u,'finance',project,'budget');
    result.canViewAgencyCommission=mayUseFinance&&canHoldFunds(db,u,project);
    result.canViewBudgetLimit=canHoldFunds(db,u,project);
    result.canManageGuestInvitations=can(db,u,'settings',null)&&can(db,u,'edit',project,'project',p.id,'personalInvitationsEnabled');
    result.canManageWeddingDetails=can(db,u,'projects',null)&&can(db,u,'edit',project,'project',p.id);
    const projectPeople=db.prepare('SELECT * FROM users WHERE agency_id=? AND disabled=0 ORDER BY name').all(u.agency_id).filter(person=>projectVisible(db,person,project));
    const custodians=projectPeople.filter(person=>canHoldFunds(db,person,project)).map(({id,name})=>({id,name}));
    result.custodians=mayUseFinance?custodians:[];
    if(!offline){
      result.assignableMembers=assignableMembers(db,u,project);
      result.templates=can(db,u,['read','templates'])?entities(db,u.agency_id,null,'template').filter(t=>can(db,u,'read',null,'template',t.id,null)):[];
      // Organizers need the reusable agency catalog while working inside a wedding.
      // Couples only receive the category snapshot stored on each proposed selection.
      result.catalog=can(db,u,['read','catalog'])?entities(db,u.agency_id,null).filter(row=>['vendor','vendorCategory'].includes(row.kind)).map(row=>filteredRow(db,u,row)).filter(Boolean):[];
    }
    if(mayInvite) {
      result.members=projectPeople.map(({id,name,email})=>({id,name,email}));
      const allRoles=db.prepare('SELECT id,name,permissions,key FROM roles WHERE agency_id=? AND protected=0 ORDER BY name').all(u.agency_id);
      result.inviteRoles=allRoles.filter(role=>can(db,u,'access')||role.key==='couple').map(({id,name})=>({id,name}));
    } else result.members=mayUseFinance?custodians:[];
    const mayViewHistory=can(db,u,'history',project);
    if(!offline && mayViewHistory) {result.history=db.prepare(`SELECT a.*,u.name AS author,e.version AS current_version,e.deleted AS current_deleted
      FROM audit a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN entities e ON e.id=a.entity_id AND e.agency_id=a.agency_id
      WHERE a.agency_id=? AND a.project_id=? ORDER BY a.created_at DESC LIMIT 200`).all(u.agency_id,project);
      if(!canUseTeamTiming(db,u,project))result.history=result.history.filter(item=>item.kind!=='row'||[item.before_json,item.after_json].every(value=>{if(!value)return true;const row=JSON.parse(value);return row.data?.audience!=='Команда'||entity(db,row.parent_id)?.data.key!=='timing'}));
      if(!canHoldFunds(db,u,project))result.history=result.history.map(item=>({...item,before_json:redactOrganizerJson(item.before_json),after_json:redactOrganizerJson(item.after_json)}));
      if(!canUseTeamTiming(db,u,project)||!can(db,u,'read',project,'project',p.id,'weddingControl'))result.history=result.history.map(item=>({...item,before_json:redactWeddingControlJson(item.before_json),after_json:redactWeddingControlJson(item.after_json)}));}
    if(offline) { result.offline=true; result.expiresAt=Date.now()+7*86400000; result.project={...result.project,data:{name:p.data.name,date:p.data.date,offline:p.data.offline}}; result.agency={id:agency.id,name:agency.name}; }
    result.entities=result.entities.map(stableRow);
    if(!offline&&can(db,u,['read','history','finance'],project,'budget',null,null))result.deletedFinanceRows=entities(db,u.agency_id,project,null,true).filter(row=>row.deleted&&['movement','obligation'].includes(row.kind)).map(row=>filteredRow(db,u,row)).filter(Boolean);
    return result;
  }
  result.projects=entities(db,u.agency_id,null,'project').filter(p=>projectVisible(db,u,p.id)).map(p=>filteredProject(db,u,p));
  result.applications=entities(db,u.agency_id,null,'application').filter(a=>a.data.userId===u.id||can(db,u,'applications'));
  if(can(db,u,'applications')||can(db,u,'access')) {
    const coupleRole=db.prepare("SELECT * FROM roles WHERE agency_id=? AND key='couple'").get(u.agency_id);
    result.accountRegistrations=entities(db,u.agency_id,null,'accountOnboarding').flatMap(entry=>{
      const target=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(entry.data.userId,u.agency_id);
      return target?[{...accountEntryView(db,entry),user:publicUser(target),canApprove:can(db,u,'access')&&canManageAccount(db,u,target)&&canAssignUserRole(db,u,coupleRole)}]:[];
    });
  }
  result.notifications=notifications(db,u,{limit:50}).items;
  result.global=entities(db,u.agency_id,null).filter(r=>(['vendor','vendorCategory'].includes(r.kind)&&can(db,u,['read','catalog']))||(r.kind==='template'&&can(db,u,['read','templates']))||(['movement','category','financeSheet'].includes(r.kind)&&can(db,u,['read','agencyFinance'])));
  if(can(db,u,['read','agencyFinance'])) {
    const fees=db.prepare("SELECT * FROM entities WHERE agency_id=? AND kind='movement' AND deleted=0 AND json_extract(data,'$.type')='fee'").all(u.agency_id).map(r=>({...r,data:JSON.parse(r.data)}));
    result.global.push(...fees); result.financials=financials(result.global); result.agencyRevenue=agencyRevenueProjection(db,u,result.projects);
  }
  if(can(db,u,['read','history','agencyFinance'],null,'agencyFinance',null,null))result.deletedFinanceRows=entities(db,u.agency_id,null,'movement',true).filter(row=>row.deleted).map(row=>financeSheetRow(db,u,row)).filter(Boolean);
  result.global=result.global.map(row=>row.kind==='movement'&&row.project_id==null?financeSheetRow(db,u,row):['vendor','vendorCategory'].includes(row.kind)?filteredRow(db,u,row):row).filter(Boolean).map(stableRow);
  if(!can(db,u,['read','agencyFinance'],null,'agencyFinance',null,null))delete result.financials;
  if(can(db,u,['read','catalog'])) result.vendorHistory=db.prepare("SELECT id,project_id,data FROM entities WHERE agency_id=? AND kind='selection' AND deleted=0").all(u.agency_id).map(r=>({...r,data:JSON.parse(r.data)}));
  result.canManageUsers=canManageUsers(db,u);
  if(result.canManageUsers) {
    const allowed=u.protected?null:managerPermissions(db,u);
    result.users=db.prepare('SELECT id,agency_id,email,phone,name,protected,disabled,version FROM users WHERE agency_id=? ORDER BY name,email,phone').all(u.agency_id).map(target=>{
      const manageable=canManageAccount(db,u,target,allowed);
      return {...target,manageable,onboarding:manageable?accountEntryView(db,accountEntry(db,target)):null};
    });
    result.roles=db.prepare('SELECT * FROM roles WHERE agency_id=?').all(u.agency_id).filter(role=>u.protected||canAssignUserRole(db,u,role,allowed)).map(r=>({...r,permissions:JSON.parse(r.permissions)}));
    if(can(db,u,'access'))result.assignments=db.prepare('SELECT * FROM grants WHERE agency_id=?').all(u.agency_id).map(g=>({...g,restrictions:JSON.parse(g.restrictions)}));
  }
  return result;
}

function validateRestrictions(r={}) {
  assert(r&&typeof r==='object'&&!Array.isArray(r),'Проверьте область доступа');
  for(const k of ['sections','rows','fields']) if(r[k]!==undefined) assert(Array.isArray(r[k])&&r[k].length<=200&&r[k].every(x=>typeof x==='string'&&x.length<=100),'Проверьте ограничения');
  return {sections:r.sections||[],rows:r.rows||[],fields:r.fields||[]};
}
function permissionFor(kind,project) { if(project) return ['obligation','movement','category','coupleBudget'].includes(kind)?'finance':kind==='file'?'files':['table','section'].includes(kind)?'structure':null; return ({vendor:'catalog',vendorCategory:'catalog',template:'templates',category:'agencyFinance',movement:'agencyFinance'})[kind]; }
function validateData(db,u,kind,data,p,parent,current=null) {
  assert(data&&typeof data==='object'&&!Array.isArray(data),'Проверьте данные'); const d=structuredClone(data);
  if(['section','table','vendor','category','vendorCategory','template'].includes(kind)) d.name=text(d.name);
  if(kind==='project') {
    assert(current||!Object.hasOwn(d,'weddingControl'),'Для изменения этапов свадьбы используйте специальное действие',409);
    d.name=text(d.name); d.date=date(d.date); d.location=d.location?text(d.location,'Место',1,1000):''; d.notes=d.notes?text(d.notes,'Заметка',1,8000):'';
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
    if(d.sheetLayout){if(current)d.sheetLayout.columnWidths=Object.fromEntries(Object.entries(d.sheetLayout.columnWidths||{}).filter(([id])=>d.columns.some(column=>column.id===id)||!current.data.columns.some(column=>column.id===id)));try{d.sheetLayout=normalizeSheetLayout(d.sheetLayout,[...d.columns.map(column=>column.id),...(d.key==='guests'?[GUEST_ACTIONS_COLUMN]:[])],[...rowIds])}catch(error){assert(false,error.message)}}
    if(current) {
      const incompatible=current.data.columns.filter(c=>!d.columns.some(n=>n.id===c.id&&n.type===c.type));
      if(incompatible.length) assert(d.confirmStructure===true,'Изменение затронет существующие значения. Подтвердите последствия.',409,{affectedRows:entities(db,u.agency_id,p,'row').filter(r=>r.parent_id===current.id).length,columns:incompatible.map(c=>c.name)});
      delete d.confirmStructure;
    }
  }
  if(kind==='row') { const t=getScoped(db,u,parent,p,'table'); assert(!t.deleted,'Таблица удалена',409); validateRow(db,u,t,d); }
  if(kind==='category'||kind==='vendorCategory') { d.archived=!!d.archived; if(p) d.scope='wedding'; }
  if(kind==='vendorCategory'&&!d.archived&&(!current||d.name!==current.data.name||current.data.archived)) {
    const key=d.name.toLocaleLowerCase('ru');
    assert(!entities(db,u.agency_id,null,'vendorCategory').some(category=>category.id!==current?.id&&!category.data.archived&&category.data.name.toLocaleLowerCase('ru')===key),'Категория с таким названием уже есть.',409);
  }
  if(kind==='vendor') {
    d.contact=d.contact?text(d.contact,'Контакт',1,1000):''; d.portfolio=safeUrl(d.portfolio); d.price=amount(d.price??null,true); d.services=d.services?text(d.services,'Услуги',1,4000):''; d.terms=d.terms?text(d.terms,'Условия',1,8000):''; d.notes=d.notes?text(d.notes,'Заметки',1,8000):''; d.archived=!!d.archived;
    if(d.categoryId) getScoped(db,u,d.categoryId,null,'vendorCategory'); d.updatedOn=date(d.updatedOn||now().slice(0,10));
    if(d.links!==undefined){try{d.links=normalizeVendorLinks(d.links)}catch(error){assert(false,error.message)}d.portfolio=d.links[0]?.url||'';}
    if(d.photoId!==undefined)d.photoId=validateVendorPhoto(db,u,d.photoId,null,current);
    if(d.photoIds!==undefined){d.photoIds=validateVendorGallery(db,u,d.photoIds,null,current);assert(d.photoId==null||d.photoIds.includes(d.photoId),'Обложка должна быть в галерее');}
    if(d.venue!==undefined){try{d.venue=normalizeVenue(d.venue)}catch(error){assert(false,error.message)}}
  }
  if(kind==='obligation') {
    d.title=text(d.title); assert(['unknown','included','amount'].includes(d.priceKind),'Выберите тип стоимости'); d.agreed=d.priceKind==='amount'?amount(d.agreed):null; d.planned=amount(d.planned??null,true); d.agencyCommission=amount(d.agencyCommission??null,true); d.dueDate=date(d.dueDate); d.condition=d.condition?text(d.condition,'Условие оплаты',1,3000):''; d.fee=!!d.fee;
    if(d.categoryId) { const c=getScoped(db,u,d.categoryId,p,'category'); assert(!c.deleted,'Категория удалена'); }
    if(d.responsible) { const person=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(d.responsible,u.agency_id); assert(person&&projectVisible(db,person,p),'Ответственный не участвует в проекте'); }
  }
  if(kind==='selection') {
    d.title=text(d.title);
    let vendor=null;
    if(d.vendorId) { vendor=getScoped(db,u,d.vendorId,null,'vendor'); assert(!vendor.deleted,'Подрядчик удалён'); }
    if(vendor&&(!current||d.vendorId!==current.data.vendorId)) {
      requireAccess(db,u,['read','catalog'],null,'vendor',vendor.id,null);
      assert(!entities(db,u.agency_id,p,'selection').some(item=>item.id!==current?.id&&!item.data.archived&&item.data.vendorId===vendor.id),'Этот подрядчик уже добавлен в свадьбу. Откройте существующую карточку.',409);
      if(d.links===undefined&&vendor.data.links!==undefined)d.links=structuredClone(vendor.data.links);
      if(d.photoId===undefined&&vendor.data.photoId)d.photoId=vendor.data.photoId;
      if(d.photoIds===undefined&&vendor.data.photoIds!==undefined){requireAccess(db,u,['read','catalog'],null,'vendor',vendor.id,['photoIds']);requireAccess(db,u,current?'edit':'create',p,'vendors',current?.id||null,['photoIds']);d.photoIds=structuredClone(vendor.data.photoIds);}
      if(d.venue===undefined&&vendor.data.venue!==undefined){requireAccess(db,u,['read','catalog'],null,'vendor',vendor.id,['venue']);requireAccess(db,u,current?'edit':'create',p,'vendors',current?.id||null,['venue']);d.venue=structuredClone(vendor.data.venue);}
    }
    if(d.links!==undefined){try{d.links=normalizeVendorLinks(d.links)}catch(error){assert(false,error.message)}d.portfolio=d.links[0]?.url||'';}
    if(d.photoId!==undefined)d.photoId=validateVendorPhoto(db,u,d.photoId,p,current,vendor);
    if(d.photoIds!==undefined){d.photoIds=validateVendorGallery(db,u,d.photoIds,p,current,vendor);assert(d.photoId==null||d.photoIds.includes(d.photoId),'Обложка должна быть в галерее');}
    if(d.venue!==undefined){try{d.venue=normalizeVenue(d.venue)}catch(error){assert(false,error.message)}}
    if(!d.categoryId&&vendor?.data.categoryId)d.categoryId=vendor.data.categoryId;
    if(d.categoryId){const category=getScoped(db,u,d.categoryId,null,'vendorCategory');assert(!category.deleted,'Категория подрядчика удалена');d.categoryName=category.data.name;}
    else {d.categoryId='';d.categoryName='Без категории';}
    d.price=amount(d.price??null,true); d.agencyCommission=amount(d.agencyCommission??null,true); d.selected=!!d.selected; d.terms=d.terms?text(d.terms,'Условия',1,8000):''; d.dueDate=date(d.dueDate);
    if(current?.data.obligationId) d.obligationId=current.data.obligationId; else delete d.obligationId;
  }
  if(kind==='template') {
    if(d.taskPhases!==undefined){assert(Array.isArray(d.taskPhases)&&d.taskPhases.length<=40,'Не более 40 этапов');const keys=new Set();for(const phase of d.taskPhases){text(phase.key,'Ключ этапа',1,80);text(phase.name,'Название этапа',1,120);assert(!keys.has(phase.key),'Ключ этапа повторяется');keys.add(phase.key);}}
    if(d.taskBlueprints!==undefined){assert(Array.isArray(d.taskBlueprints)&&d.taskBlueprints.length<=300,'Не более 300 задач шаблона');const keys=new Set(d.taskBlueprints.map(x=>x.key));assert(keys.size===d.taskBlueprints.length,'Ключ задачи повторяется');for(const task of d.taskBlueprints){text(task.key,'Ключ задачи',1,80);text(task.title,'Название задачи');assert(task.dueMode===undefined||['none','relative'].includes(task.dueMode),'Проверьте срок задачи шаблона');assert(task.priority===undefined||['low','normal','high','urgent'].includes(task.priority),'Проверьте приоритет задачи');assert(Number.isInteger(task.offsetDays)&&Math.abs(task.offsetDays)<=1095,'Смещение срока: от -1095 до 1095');assert(!d.taskPhases?.length||d.taskPhases.some(p=>p.key===task.phaseKey),'Этап задачи отсутствует');assert(Array.isArray(task.dependencyKeys||[])&&(task.dependencyKeys||[]).every(k=>keys.has(k)&&k!==task.key),'Проверьте зависимости задач');}const visit=(key,path=new Set())=>{assert(!path.has(key),'Зависимости шаблона образуют цикл');const next=new Set([...path,key]);for(const dependency of d.taskBlueprints.find(x=>x.key===key)?.dependencyKeys||[])visit(dependency,next)};for(const key of keys)visit(key);}

    d.offline=Array.isArray(d.offline)?d.offline:[];
    d.categories=Array.isArray(d.categories)?d.categories:[];
    assert(Array.isArray(d.sections)&&d.sections.length<=30&&Array.isArray(d.tables)&&d.tables.length<=50,'Проверьте разделы и таблицы шаблона');
    d.sections=d.sections.map((section,index)=>({key:text(section?.key,'Ключ раздела'),name:text(section?.name,'Название раздела'),order:Number(section?.order??index)}));
    const keys=new Set(); for(const s of d.sections) { assert(/^[a-zA-Z0-9_-]{1,80}$/.test(s.key),'Ключ раздела: латинские буквы, цифры, дефис или подчёркивание'); assert(Number.isFinite(s.order),'Проверьте порядок раздела'); assert(!keys.has(s.key),'Ключ раздела повторяется'); keys.add(s.key); }
    const tableKeys=new Set();
    d.tables=d.tables.map(table=>({key:text(table?.key,'Ключ таблицы'),name:text(table?.name,'Название таблицы'),section:text(table?.section,'Раздел таблицы'),offline:!!table?.offline,columns:templateColumns(table?.columns),...templateSemanticMap({...table,columns:table?.columns||[]}),...templateTableSettings({...table,columns:table?.columns||[]})}));
    for(const t of d.tables) { assert(/^[a-zA-Z0-9_-]{1,80}$/.test(t.key),'Ключ таблицы: латинские буквы, цифры, дефис или подчёркивание'); assert(!tableKeys.has(t.key),'Ключ таблицы повторяется'); tableKeys.add(t.key); assert(keys.has(t.section),'Раздел таблицы не найден'); validateColumns(t.columns); }
    assert(d.categories.length<=100,'Проверьте категории'); d.categories=[...new Set(d.categories.map(category=>text(category,'Категория',1,120)))];
    d.offline=[...new Set(d.offline.map(key=>text(key,'Офлайн-раздел',1,80)))];
    assert(Array.isArray(d.offline)&&d.offline.length<=60&&d.offline.every(key=>tableKeys.has(key)||['payouts','budget','vendors','files'].includes(key)),'Проверьте офлайн-разделы шаблона');
    Object.assign(d,templateSettings(d));
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
    if(previous) { assert(previous.digest===hash,'Этот ID уже использован для другого действия',409); const replay=JSON.parse(previous.result);return replay?.kind==='project'?filteredProject(db,u,replay):replay; }
    const beforeAudit=db.prepare('SELECT coalesce(max(rowid),0) AS n FROM audit').get().n;
    let result;
    if(op==='account.approve') {
      requireAccess(db,u,'access');
      const entry=getScoped(db,u,cmd.entityId,null,'accountOnboarding');version(entry,cmd.version);
      assert(!entry.deleted&&['pending','questionnaire'].includes(entry.data.status),'Аккаунт уже подключён',409);
      const target=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(entry.data.userId,u.agency_id);
      assert(target&&!target.protected,'Аккаунт недоступен',409);
      assert(canManageAccount(db,u,target),'Вы не можете управлять этим аккаунтом',403);
      const project=getScoped(db,u,cmd.weddingId,null,'project');assert(!project.deleted,'Свадьба удалена',409);
      const role=db.prepare("SELECT * FROM roles WHERE agency_id=? AND key='couple'").get(u.agency_id);assert(role,'Роль пары не найдена',409);
      assert(canAssignUserRole(db,u,role),'Вы не можете назначить эту роль',403);
      db.prepare('DELETE FROM grants WHERE user_id=?').run(target.id);grant(db,target,role.id,project.id);
      db.prepare('UPDATE users SET version=version+1 WHERE id=?').run(target.id);
      result=change(db,u,entry,{...entry.data,status:'questionnaire',projectId:project.id,approvedBy:u.id,approvedAt:now()});
    } else if(op==='account.questionnaire') {
      const entry=getScoped(db,u,cmd.entityId,null,'accountOnboarding');
      assert(entry.data.userId===u.id,'Можно заполнить только свою анкету',403);version(entry,cmd.version);
      assert(entry.data.status==='questionnaire','Сначала дождитесь подтверждения аккаунта и назначения свадьбы',409);
      const project=getScoped(db,u,entry.data.projectId,null,'project');assert(!project.deleted,'Свадьба недоступна. Свяжитесь с организатором.',409);
      assert(db.prepare('SELECT id FROM grants WHERE user_id=? AND agency_id=? AND project_id=?').get(u.id,u.agency_id,project.id),'Свадьба больше не назначена. Свяжитесь с организатором.',409);
      const weddingDate=Object.hasOwn(cmd,'weddingDate')?date(cmd.weddingDate):project.data.date;
      if(Object.hasOwn(cmd,'weddingDate')){
        version(project,cmd.projectVersion);
        assert(!project.data.date||weddingDate===project.data.date,'Дата свадьбы уже согласована. Обновите анкету; изменить дату можно в настройках свадьбы.',409);
      }
      result=change(db,u,entry,{...entry.data,status:'complete',questionnaire:validateQuestionnaire(cmd.answers),weddingDate,questionnaireSubmittedAt:now()},false,'questionnaire');
      // Completion unlocks the existing approved grant. Date assignment then uses
      // the normal permission-checked reschedule engine in this same transaction.
      if(weddingDate!==project.data.date){
        const preview=previewReschedule(db,u,{projectId:project.id,newDate:weddingDate});
        v2Operations['project.reschedule.apply'].run(db,u,{projectId:project.id,newDate:weddingDate,projectVersion:preview.projectVersion,previewDigest:preview.digest});
      }
    } else if(op==='project.control.save') {
      const project=getScoped(db,u,p,null,'project');version(filteredProject(db,u,project),cmd.version);
      const control=structuredClone(project.data.weddingControl||{});
      assert(cmd.stage||cmd.info,'Укажите этап или заметки свадьбы');
      if(cmd.stage){
        const stage=cmd.stage;
        assert(WEDDING_STAGES.some(item=>item.id===stage.id),'Неизвестный этап');
        assert(Object.hasOwn(STAGE_STATUSES,stage.status),'Выберите состояние этапа');
        assert(typeof stage.notRequired==='boolean','Проверьте отметку «Не требуется»');
        const comment=text(stage.comment,'Комментарий',0,8000);
        assert(stage.status!=='problem'||stage.notRequired||comment,'Опишите проблему');
        control.stages={...control.stages,[stage.id]:{status:stage.notRequired?'open':stage.status,notRequired:stage.notRequired,comment,updatedBy:u.id,updatedAt:now()}};
      }
      if(cmd.info){
        const url=text(cmd.info.documentUrl,'Ссылка на документ',0,2000);
        assert(!url||/^https?:\/\//i.test(url),'Ссылка должна начинаться с https:// или http://');
        if(url){let parsed;try{parsed=new URL(url)}catch{assert(false,'Проверьте ссылку на документ')}assert(parsed.hostname&&!parsed.username&&!parsed.password,'Проверьте ссылку на документ');}
        control.documentUrl=url;control.notes=text(cmd.info.notes,'Заметки',0,8000);
      }
      result=filteredProject(db,u,change(db,u,project,{...project.data,weddingControl:control},false,'weddingControl'));
    } else if(op==='project.template.create') {
      const project=getScoped(db,u,p,null,'project');version(project,cmd.projectVersion);
      result=insert(db,u,'template',validateData(db,u,'template',weddingTemplate(db,u,project,cmd.name),null,null));
    } else if(op==='project.create') { requireAccess(db,u,'projects'); const template=cmd.templateId?getScoped(db,u,cmd.templateId,null,'template'):null; if(template){assert(!template.deleted,'Шаблон удалён',409);requireAccess(db,u,['read','templates'],null,'template',template.id,null)} result=createProject(db,u,cmd.data,template); }
    else if(op==='application.create') {
      assert(!entities(db,u.agency_id,null,'application').some(a=>a.data.userId===u.id&&['review','clarification','approved'].includes(a.data.status)),'У вас уже есть заявка',409);
      result=insert(db,u,'application',{userId:u.id,...applicationData(cmd.data,db,u),status:'review',reason:'',projectId:null});
    } else if(op==='application.respond') {
      const a=getScoped(db,u,cmd.entityId,null,'application'); assert(a.data.userId===u.id,'Можно изменить только свою заявку',403); version(a,cmd.version);
      assert(['clarification','rejected'].includes(a.data.status),'Эта заявка сейчас не ожидает исправления',409);
      result=change(db,u,a,{...a.data,...applicationData(cmd.data,db,u),status:'review',reason:'',projectId:null},false,'respond');
    } else if(op==='application.questionnaire') {
      const a=getScoped(db,u,cmd.entityId,null,'application'); assert(a.data.userId===u.id,'Можно изменить только свою анкету',403); version(a,cmd.version);
      assert(a.data.status!=='approved','Заявка уже одобрена',409);
      result=change(db,u,a,{...a.data,...(Object.hasOwn(cmd,'date')?{date:date(cmd.date)}:{}),questionnaire:validateQuestionnaire(cmd.answers),questionnaireSubmittedAt:now()},false,'questionnaire');
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
    else if(op==='user.create') {
      assert(canManageUsers(db,u),'Недостаточно прав',403);
      const name=text(cmd.name),address=email(cmd.email),role=db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(cmd.roleId,u.agency_id);
      assert(canAssignUserRole(db,u,role),'Эту роль нельзя назначить',403);
      const scope=cmd.projectId||null;
      if(['couple','coordinator','contractor'].includes(role.key))assert(scope,'Выберите свадьбу для этой роли');
      if(role.key==='organizer')assert(!scope,'Организатор работает на уровне агентства');
      if(scope){const project=getScoped(db,u,scope,undefined,'project');assert(!project.deleted&&projectVisible(db,u,scope),'Свадьба недоступна',403);}
      assert(!db.prepare('SELECT id FROM users WHERE agency_id=? AND email=?').get(u.agency_id,address),'Этот email уже зарегистрирован',409);
      const id=uid();db.prepare('INSERT INTO users(id,agency_id,email,name,password) VALUES(?,?,?,?,?)').run(id,u.agency_id,address,name,passwordHash(cmd.password));
      const created=db.prepare('SELECT * FROM users WHERE id=?').get(id);grant(db,created,role.id,scope);
      result={id,name,email:address,disabled:false,version:created.version};audit(db,u,{id,kind:'user',project_id:null,data:{name,email:address,roleId:role.id,projectId:scope}},null,'create');
    } else if(['user.password','user.remove','user.restore'].includes(op)) {
      const target=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=?').get(cmd.userId,u.agency_id);
      assert(target,'Пользователь не найден',404);assert(canManageAccount(db,u,target),'Недостаточно прав',403);version(target,cmd.version);
      if(op==='user.password'){
        assert(!target.disabled,'Сначала восстановите пользователя',409);
        db.prepare('UPDATE users SET password=?,version=version+1 WHERE id=?').run(passwordHash(cmd.password),target.id);
        revokeUserSessions(db,target.id);result={id:target.id,passwordChanged:true};
      }else{
        assert(op==='user.remove'?!target.disabled:!!target.disabled,op==='user.remove'?'Пользователь уже удалён':'Пользователь уже активен',409);
        db.prepare('UPDATE users SET disabled=?,version=version+1 WHERE id=?').run(op==='user.remove'?1:0,target.id);
        if(op==='user.remove')revokeUserSessions(db,target.id);
        result={id:target.id,disabled:op==='user.remove'};
      }
      audit(db,u,{id:target.id,kind:'user',project_id:null,data:{name:target.name,email:target.email,action:op}},null,op);
    } else if(op==='role.delete') {
      requireAccess(db,u,'access');
      const existing=db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(cmd.roleId,u.agency_id);
      assert(existing,'Роль не найдена',404); version(existing,cmd.version);
      assert(!existing.protected&&!existing.key,'Системную роль удалить нельзя',403);
      assert(!db.prepare('SELECT id FROM grants WHERE role_id=? LIMIT 1').get(existing.id),'Роль назначена пользователям. Сначала измените их доступ.',409);
      assert(!db.prepare('SELECT digest FROM invitations WHERE role_id=? LIMIT 1').get(existing.id),'Роль используется в приглашениях и должна быть сохранена.',409);
      audit(db,u,{id:existing.id,kind:'role',project_id:null,data:{name:existing.name,permissions:JSON.parse(existing.permissions)},deleted:true},existing,'delete');
      db.prepare('DELETE FROM roles WHERE id=?').run(existing.id);
      result={id:existing.id,deleted:true};
    } else if(op==='role.save') {
      requireAccess(db,u,'access'); assert(Array.isArray(cmd.permissions)&&cmd.permissions.every(x=>permissions.includes(x)),'Неизвестное разрешение'); const name=text(cmd.name),id=cmd.roleId||uid();
      const existing=db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(id,u.agency_id);
      if(existing) { assert(!existing.protected,'Роль администратора защищена',403); version(existing,cmd.version); db.prepare('UPDATE roles SET name=?,permissions=?,version=version+1 WHERE id=?').run(name,JSON.stringify(cmd.permissions),id); }
      else db.prepare('INSERT INTO roles(id,agency_id,name,permissions) VALUES(?,?,?,?)').run(id,u.agency_id,name,JSON.stringify(cmd.permissions));
      result={id,name}; audit(db,u,{id,kind:'role',project_id:null,data:{name,permissions:cmd.permissions}},existing,'access');
    } else if(op==='grants.save') {
      requireAccess(db,u,'access'); const target=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=?').get(cmd.userId,u.agency_id); assert(target,'Пользователь не найден'); assert(!target.protected,'Основной администратор защищён',403); version(target,cmd.version);
      const entry=accountEntry(db,target);
      assert(!entry||entry.data.status==='complete','Сначала подтвердите аккаунт и назначьте свадьбу',409);
      assert(Array.isArray(cmd.grants)&&cmd.grants.length<=50,'Не более 50 назначений');
      for(const g of cmd.grants) { const r=db.prepare('SELECT * FROM roles WHERE id=? AND agency_id=?').get(g.roleId,u.agency_id); assert(r,'Роль не найдена'); assert(!r.protected,'Роль администратора защищена',403); if(g.projectId) getScoped(db,u,g.projectId,undefined,'project'); else assert(!['couple','coordinator','contractor'].includes(r.key),'Этой роли нужно назначить конкретный проект'); validateRestrictions(g.restrictions); }
      const before=grants(db,target); db.prepare('DELETE FROM grants WHERE user_id=?').run(target.id);
      for(const g of cmd.grants) grant(db,target,g.roleId,g.projectId||null,validateRestrictions(g.restrictions));
      db.prepare('UPDATE users SET version=version+1,disabled=? WHERE id=?').run(Number(!!cmd.disabled),target.id); result={id:target.id}; audit(db,u,{id:target.id,kind:'grants',project_id:null,data:cmd.grants},before,'access');
    } else if(op==='settings.save') {
      requireAccess(db,u,'settings'); const a=db.prepare('SELECT * FROM agencies WHERE id=?').get(u.agency_id); version(a,cmd.version);
      const name=text(cmd.name),s=settingsData(cmd.settings);
      db.prepare('UPDATE agencies SET name=?,settings=?,version=version+1 WHERE id=?').run(name,JSON.stringify(s),u.agency_id); result={ok:true,name,settings:s}; audit(db,u,{id:u.agency_id,kind:'settings',project_id:null,data:s},a,'edit');
    } else if(op==='coupleBudget.cell'||op==='coupleBudget.format') result=saveCoupleBudgetCell(db,u,cmd);
    else if(op==='coupleBudget.section.add'||op==='coupleBudget.item.add') result=addCoupleBudgetStructure(db,u,cmd);
    else if(op.startsWith('financeSheet.'))result=editFinanceSheet(db,u,cmd);
    else if(op==='coupleBudget.structure')result=editCoupleBudgetStructure(db,u,cmd);
    else if(op==='sheet.layout') result=saveSheetLayout(db,u,cmd);
    else if(op==='movement.save'||op==='movement.delete'||op==='movement.restore') result=movement(db,u,cmd);
    else if(op==='venue.saveToCatalog') result=saveVenueToCatalog(db,u,cmd);
    else if(op==='entity.create'||op==='entity.edit'||op==='entity.delete'||op==='entity.restore') result=mutateEntity(db,u,cmd);
    else assert(false,'Неизвестное действие');
    queueChanges(db,u,beforeAudit);
    db.prepare('INSERT INTO commands VALUES(?,?,?,?)').run(cmd.id,u.id,hash,JSON.stringify(result)); return result;
  });
}

function authorizeCommand(db,u,c) {
  const entry=accountEntry(db,u);
  if (entry&&entry.data.status!=='complete') assert(c.op==='account.questionnaire','Сначала завершите подключение аккаунта',403);
  const p=c.projectId||null;
  if(c.op==='project.control.save'){
    assert(p&&canUseTeamTiming(db,u,p),'Этапы свадьбы доступны только организаторам',403);
    requireAccess(db,u,['read','edit'],p,'project',p,'weddingControl');
  }
  if(c.op==='project.template.create'){
    assert(p&&canUseTeamTiming(db,u,p),'Шаблоны из свадеб доступны организаторам',403);
    requireAccess(db,u,['read','structure'],p,null,null,null);
    requireAccess(db,u,['create','templates'],null,'template',null,null);
  }
  const actions={'account.approve':'access','project.create':'projects','application.review':'applications','role.save':'access','role.delete':'access','grants.save':'access','settings.save':'settings','invite.create':'invite'};
  if(actions[c.op]) requireAccess(db,u,actions[c.op],c.op==='invite.create'?p:null);
  if(c.op.startsWith('user.'))assert(canManageUsers(db,u),'Недостаточно прав',403);
  if(c.op==='coupleBudget.cell'||c.op==='coupleBudget.format')requireAccess(db,u,['edit','finance'],p,'budget',null,[c.field]);
  if(c.op==='coupleBudget.section.add'||c.op==='coupleBudget.item.add')requireAccess(db,u,['create','finance'],p,'budget',null,[c.op==='coupleBudget.section.add'?'extraSections':'extraItems']);
  if(c.op.startsWith('financeSheet.')){const scope=p?'budget':'agencyFinance',permission=p?'finance':'agencyFinance',row=c.entityId?getScoped(db,u,c.entityId,p,c.target==='obligation'?'obligation':'movement'):null;requireAccess(db,u,c.op==='financeSheet.cell'?['edit',permission]:['edit','structure',permission],p,scope,row?.data.obligationId||row?.id||null,c.field?[c.field]:null);}
  if(c.op==='coupleBudget.structure')requireAccess(db,u,c.action==='columns'?['edit','structure','finance']:c.action==='restore'?['edit','finance','history']:['delete','finance'],p,'budget',null,null);
  if(c.op==='sheet.layout'){const row=c.entityId?getScoped(db,u,c.entityId,p,'table'):null;requireAccess(db,u,row?['edit','structure']:['edit','finance','structure'],p,row?.id||'budget',row?.id,null);}
  if(c.op==='movement.save')assert(!Object.hasOwn(c.data||{},'cellFormats')&&!Object.hasOwn(c.data||{},'sheetValues'),'Оформление и пользовательские ячейки изменяются через таблицу');
  if(c.op.startsWith('movement.')) {
    const old=c.entityId?getScoped(db,u,c.entityId,p,'movement'):null;
    const type=c.data?.type||old?.data.type;
    const fields=c.data?[...new Set([...Object.keys(c.data),...Object.keys(c.formats||{}),...Object.keys(c.sheetValues||{})])]:null;
    if(c.op==='movement.restore')requireAccess(db,u,['edit','history',p?'finance':'agencyFinance'],p,p?'budget':'agencyFinance',old?.data.obligationId||null,null);
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
    const allowed=['project','section','table','row','obligation','coupleBudget','category','vendorCategory','vendor','selection','template','file']; assert(allowed.includes(kind),'Этот тип записи меняется отдельным действием');if(kind==='coupleBudget')assert(c.op==='entity.restore','Смета изменяется отдельными действиями');
    const section=row?sectionOf(row):kind==='row'?c.parentId:kind==='table'?c.data?.sectionId:({obligation:'budget',selection:'vendors',file:'files'})[kind]||kind;
    const accessRow=row?accessRowId(row):null;
    const action=c.op==='entity.create'?'create':c.op==='entity.delete'?'delete':'edit';
    const fields=[...new Set([...Object.keys(c.data||{}),...Object.keys(c.formats||{}),...Object.keys(c.sheetValues||{})])];
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
function saveCoupleBudgetCell(db,u,c) {
  const p=c.projectId,row=c.row,field=c.field,formatOnly=c.op==='coupleBudget.format';
  assert(p&&(Number.isInteger(row)||typeof row==='string'&&row.length<100),'Укажите строку сметы');
  const old=entities(db,u.agency_id,p,'coupleBudget')[0]||null;
  const data=structuredClone(old?.data||{}),found=coupleBudgetFind(data,row),extraColumn=(data.extraColumns||[]).find(column=>column.id===field),isText=['name','note'].includes(field)||extraColumn&&['text','url'].includes(extraColumn.type);
  assert(found && (field==='name'||found.item && (coupleBudgetAmountFields.includes(field)||field==='note'||!formatOnly&&field==='organizer'||formatOnly&&field==='remaining'||extraColumn&&(extraColumn.type!=='formula'||formatOnly))),'Поле сметы недоступно',400);
  if(formatOnly)assert(Object.hasOwn(c,'format'),'Укажите форматирование');
  if(field==='organizer')assert(!Object.hasOwn(c,'format'),'У этого поля нет форматирования');
  if(field==='organizer')assert(!coupleBudgetOrganizerGroups.has(found.group.row),'Этот раздел уже целиком включён в бюджет организатора',400);
  for(const key of ['names','notes','estimated','actual','prepaid','organizerRows'])data[key]||={};
  const beforeText=extraColumn&&isText?String(data.extraValues?.[field]?.[row]??''):field==='name'?(data.names[row]||coupleBudgetDefaultName(row,data)):field==='note'?(data.notes[row]??coupleBudgetDefaultNote(row,data)):'';
  if(formatOnly&&isText&&Object.hasOwn(c,'value'))assert(String(c.value??'')===beforeText,'Текст уже изменён. Обновите ячейку перед форматированием.',409);
  let afterText=beforeText;
  if(!formatOnly&&extraColumn){
    validateRow(db,u,{project_id:p,data:{columns:[extraColumn]}},{[field]:c.value});
    data.extraValues||={};data.extraValues[field]||={};
    if(c.value==null||c.value==='')delete data.extraValues[field][row];else data.extraValues[field][row]=c.value;
    afterText=isText?String(c.value??''):'';
  }else if(!formatOnly&&field==='name') {
    const value=text(c.value,'Название',1,200);
    afterText=value;
    if(value===coupleBudgetDefaultName(row,data))delete data.names[row];else data.names[row]=value;
  } else if(!formatOnly&&field==='note') {
    const value=text(c.value,'Примечание',0,500);
    afterText=value;
    if(value===coupleBudgetDefaultNote(row,data))delete data.notes[row];else data.notes[row]=value;
  } else if(!formatOnly&&field==='organizer') {
    assert(typeof c.value==='boolean','Проверьте признак бюджета организатора');
    data.organizerRows[row]=c.value;
  } else if(!formatOnly) {
    const value=amount(c.value??null,true);
    if(value===null)delete data[field][row];else data[field][row]=value;
  }
  if(Object.hasOwn(c,'format')||beforeText!==afterText&&data.cellFormats?.[field]?.[row]) {
    let format;
    try{format=Object.hasOwn(c,'format')?normalizeBudgetFormat(c.format,afterText,isText):rebaseBudgetFormat(data.cellFormats[field][row],beforeText,afterText);}
    catch(error){assert(false,error.message);}
    data.cellFormats||={};data.cellFormats[field]||={};
    if(format)data.cellFormats[field][row]=format;else delete data.cellFormats[field][row];
    if(!Object.keys(data.cellFormats[field]).length)delete data.cellFormats[field];
    if(!Object.keys(data.cellFormats).length)delete data.cellFormats;
  }
  const saved=old?change(db,u,old,data,false,'edit'):insert(db,u,'coupleBudget',data,p);
  return filteredRow(db,u,saved);
}
function addCoupleBudgetStructure(db,u,c) {
  const p=c.projectId;
  assert(p,'Укажите свадьбу');
  const old=entities(db,u.agency_id,p,'coupleBudget')[0]||null;
  const data=structuredClone(old?.data||{});
  let createdId;
  if(c.op==='coupleBudget.section.add') {
    assert(coupleBudgetViewGroups(data).length<30,'Не более 30 разделов сметы');
    const name=text(c.name,'Раздел',1,200);
    createdId=`section_${uid()}`;
    data.extraSections=[...(data.extraSections||[]),{row:createdId,name,totalLabel:'Итого по разделу',items:[]}];
  } else {
    const group=coupleBudgetViewGroups(data).find(group=>String(group.row)===String(c.sectionId));
    assert(group,'Раздел сметы не найден',404);
    assert(coupleBudgetViewGroups(data).reduce((count,section)=>count+section.items.length,0)<500,'Не более 500 статей сметы');
    const name=text(c.name,'Статья',1,200),note=c.note?text(c.note,'Примечание',1,500):'';
    assert(typeof c.organizer==='boolean','Проверьте признак бюджета организатора');
    createdId=`item_${uid()}`;
    const item={row:createdId,name,note,organizer:c.organizer};
    if(typeof group.row==='number')data.extraItems={...(data.extraItems||{}),[group.row]:[...(data.extraItems?.[group.row]||[]),item]};
    else data.extraSections=(data.extraSections||[]).map(section=>section.row===group.row?{...section,items:[...section.items,item]}:section);
  }
  let saved=old?change(db,u,old,data,false,'edit'):insert(db,u,'coupleBudget',data,p);
  for(const field of new Set([...Object.keys(c.values||{}),...Object.keys(c.formats||{})])){
    requireAccess(db,u,['create','finance'],p,'budget',null,[field]);
    assert(c.op!=='coupleBudget.section.add'||field==='name','У раздела доступно только название');
    const hasValue=Object.hasOwn(c.values||{},field);
    const result=saveCoupleBudgetCell(db,u,{projectId:p,row:createdId,field,op:hasValue?'coupleBudget.cell':'coupleBudget.format',...(hasValue?{value:c.values[field]}:{}),...(Object.hasOwn(c.formats||{},field)?{format:c.formats[field]}:{})});
    saved=entity(db,result.id);
  }
  return {...filteredRow(db,u,saved),createdId};
}
function referencesEntity(db,u,p,row,targetId) {
  if(row.parent_id===targetId) return true;
  for(const key of ['sectionId','vendorId','categoryId','obligationId','selectionId','fileId']) if(row.data[key]===targetId) return true;
  if(row.kind!=='row') return false;
  const table=entity(db,row.parent_id); if(!table||table.agency_id!==u.agency_id||table.project_id!==p) return false;
  return table.data.columns.some(column=>['relation','file'].includes(column.type)&&row.data[column.id]===targetId);
}
function saveVenueToCatalog(db,u,c) {
  const source=getScoped(db,u,c.entityId,c.projectId,'selection');
  assert(!source.deleted&&isVenueData(source.data),'Площадка не найдена',404);
  assert(canHoldFunds(db,u,c.projectId),'Только организатор может сохранить площадку в базе',403);
  version(source,c.version);
  if(source.data.vendorId){const saved=getScoped(db,u,source.data.vendorId,null,'vendor');requireAccess(db,u,['read','catalog'],null,'vendor',saved.id);return filteredRow(db,u,saved);}
  return filteredRow(db,u,linkVenueCatalog(db,u,source).vendor);
}
const isVenueData=data=>!!data.venue||['площадка','площадки'].includes(String(data.categoryName||'').trim().toLocaleLowerCase('ru'));
function venueIdentity(data){
  const name=String(data.name||data.title||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
  const website=data.venue?.website||data.portfolio||data.links?.[0]?.url;
  if(!name||!website)return null;
  try{const url=new URL(website);url.hash='';url.pathname=url.pathname.replace(/\/+$/,'')||'/';return `${name}\n${url.href}`;}catch{return null;}
}
function linkVenueCatalog(db,u,source,action='edit',legacy=false) {
  const fields=['title','contact','services','terms','price','categoryId','links','portfolio','venue','photoId','photoIds'].filter(key=>Object.hasOwn(source.data,key));
  requireAccess(db,u,'read',source.project_id,'vendors',source.id,fields);
  const data=Object.fromEntries(fields.filter(key=>key!=='title').map(key=>[key,structuredClone(source.data[key])]));
  data.name=source.data.title;data.updatedOn=now().slice(0,10);data.archived=false;
  // A wedding-specific agreed tariff must not become the agency default.
  data.venue=normalizeVenue({...data.venue,...(!data.venue?{website:data.portfolio||data.links?.[0]?.url||'',details:data.terms||''}:{}),rentOverride:null});
  data.price=null;
  requireAccess(db,u,['create','catalog'],null,'vendor',null,Object.keys(data));
  requireAccess(db,u,action,source.project_id,'vendors',action==='create'?null:source.id,['vendorId']);
  const identity=venueIdentity(data),address=String(data.venue?.address||'').trim().toLocaleLowerCase('ru');
  let saved=identity&&entities(db,u.agency_id,null,'vendor').find(row=>
    !row.data.archived&&isVenueData({...row.data,categoryName:(row.data.categoryId?entity(db,row.data.categoryId)?.data.name:null)||row.data.categoryName})&&can(db,u,['read','catalog'],null,'vendor',row.id,['name','venue','portfolio','links'])&&
    venueIdentity(row.data)===identity&&(!address||!row.data.venue?.address||address===row.data.venue.address.trim().toLocaleLowerCase('ru')));
  if(saved&&!source.data.archived&&!legacy)assert(!entities(db,u.agency_id,source.project_id,'selection').some(row=>row.id!==source.id&&!row.data.archived&&row.data.vendorId===saved.id),'Эта площадка уже добавлена в свадьбу. Откройте существующую карточку.',409);
  saved||=insert(db,u,'vendor',validateData(db,u,'vendor',data,null,null,source));
  // Linking only the source avoids rewriting an existing financial obligation.
  const selection=change(db,u,source,{...source.data,vendorId:saved.id},false,'catalogLink');
  return {vendor:saved,selection};
}
export function backfillVenueCatalog(db) {
  return transaction(db,()=>{
    let linked=0;
    for(const agency of db.prepare('SELECT id FROM agencies').all()){
      const u=db.prepare('SELECT * FROM users WHERE agency_id=? AND protected=1 AND disabled=0').get(agency.id);
      if(!u)continue;
      const categories=entities(db,agency.id,null,'vendorCategory');
      const sources=db.prepare("SELECT id FROM entities WHERE agency_id=? AND kind='selection' AND deleted=0 AND coalesce(json_extract(data,'$.vendorId'),'')='' ORDER BY updated_at,id").all(agency.id);
      for(const {id} of sources){
        const source=entity(db,id),project=entity(db,source.project_id);
        if(!project||project.deleted)continue;
        const category=categories.find(row=>row.id===source.data.categoryId);
        if(!isVenueData({...source.data,categoryName:category?.data.name||source.data.categoryName}))continue;
        linkVenueCatalog(db,u,source,'edit',true);linked++;
      }
    }
    return {linked};
  });
}
function mutateEntity(db,u,c) {
  const p=c.projectId||null,old=c.entityId?getScoped(db,u,c.entityId):null,kind=old?.kind||c.kind;
  assert(!typedKinds.has(kind),'Используйте специальное действие этого раздела',409);
  if(old) version(old,c.version);
  assert(c.op==='entity.create'||old,'Запись не найдена',404);
  if(p&&['obligation','selection'].includes(kind)&&(Object.hasOwn(c.data||{},'agencyCommission')||Object.hasOwn(c.formats||{},'agencyCommission'))) assert(canHoldFunds(db,u,p),'Агентская комиссия доступна только организаторам',403);
  if(p&&kind==='project'&&Object.hasOwn(c.data||{},'limit')) assert(canHoldFunds(db,u,p),'Лимит бюджета доступен только организаторам',403);
  if(p&&kind==='selection'&&!canHoldFunds(db,u,p)) {
    const fields=Object.keys(c.data||{});
    assert(c.op==='entity.edit'&&fields.length===1&&fields[0]==='selected','Пара может только подтвердить или отменить итоговый выбор подрядчика',403);
  }
  if(old&&c.op!=='entity.restore') assert(!old.deleted,'Запись удалена. Сначала восстановите её.',409);
  if(kind==='row') {
    const table=getScoped(db,u,old?.parent_id||c.parentId,p,'table');
    assert(!table.deleted,'Таблица удалена. Восстановите её перед сохранением.',409);
    assert(table.version===c.schemaVersion,'Структура таблицы изменилась. Проверьте правку перед повтором.',409,{table});
  }
  if(c.op==='entity.delete') {
    if(kind==='vendorCategory') {
      const used=db.prepare("SELECT id FROM entities WHERE agency_id=? AND kind IN ('vendor','selection') AND deleted=0 AND json_extract(data,'$.categoryId')=? LIMIT 1").get(u.agency_id,old.id);
      assert(!used,'Категория используется подрядчиками. Сначала перенесите их в другую категорию.',409);
    }
    if(kind==='row'){const table=entity(db,old.parent_id),m=table?.data.semanticMap;if(m?.seatingTable&&old.data[m.seatingTable]){requireAccess(db,u,'edit',p,table.id,old.id,[m.seatingTable,m.seatIndex]);return change(db,u,old,{...old.data,[m.seatingTable]:'',[m.seatIndex]:''},true,'delete_unassign');}}
    if(kind==='file'){const linked=entities(db,u.agency_id,p,'approvalRevision',true).some(rev=>(rev.data.options||[]).some(o=>[...(o.fileIds||[]),...(o.imageIds||[])].includes(old.id)));assert(!linked,'Файл включён в историю согласования и должен сохраняться',409);}
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
    return filteredMutationResult(db,u,change(db,u,old,old.data,true,'delete'));
  }
  let data={...(old?.data||{}),...(c.data||{})};
  if(c.op==='entity.restore') { assert(old.deleted || c.auditId,'Выберите удалённую запись или версию'); if(c.auditId) { const h=db.prepare('SELECT * FROM audit WHERE id=? AND entity_id=? AND agency_id=?').get(c.auditId,old.id,u.agency_id); assert(h,'Версия не найдена'); data=JSON.parse(h.before_json||h.after_json).data; } }
  if(kind==='row') {
    const table=entity(db,old?.parent_id||c.parentId),m=table?.data.semanticMap;
    if(table?.data.key==='timing'&&data.audience==='Команда')assert(canUseTeamTiming(db,u,p),'Тайминг команды доступен только организаторам',403);
    if(c.op==='entity.restore'&&m?.seatingTable){data[m.seatingTable]='';data[m.seatIndex]='';}
    const changed=Object.keys(data).filter(k=>data[k]!==old?.data?.[k]);
    if(!old&&m){for(const field of [m.seatingTable,m.seatIndex].filter(Boolean))assert(!data[field],'Назначьте место через рассадку',409);const value=data[m.rsvpStatus];assert(!value||[m.rsvpValues?.unanswered,'unanswered','Приглашён','Не отправлено'].includes(value),'Создайте гостя без ответа и измените RSVP отдельным действием',409);}
    else validateGuestRowMutation(table,old,data,changed);
  }
  // Semantic-map guards inspect column IDs/types, so validate the incoming
  // schema before they traverse it (including restores from older history).
  if(kind==='table')validateColumns(data.columns);
  if(kind==='table'&&old){if(old.data.key==='timing'&&data.key!==old.data.key)assert(canUseTeamTiming(db,u,p),'Тип таблицы тайминга может изменить только организатор',403);const timingGuard=validateTimingSchemaMutation(old,{...old,data});assert(timingGuard.ok,'Сначала переподключите поля календаря в настройке тайминга',409,timingGuard);const guard=validateGuestSchemaMutation(old,{...old,data});assert(guard.ok,'Сначала переподключите или отключите смысловые поля гостей',409,guard);}
  if(old){const protectedFields=kind==='project'?['readinessPolicy','leadOrganizerUserId','staffIntervals','personalInvitationsEnabled','weddingControl']:kind==='file'?['documentKind','verificationStatus','verifiedBy','verifiedAt','verificationNote']:kind==='selection'?['bookingRequired','bookingStatus','bookingVerifiedBy','bookingVerifiedAt','bookingEvidenceFileId','bookingEvidenceNote']:[];for(const field of protectedFields)assert(JSON.stringify(data[field])===JSON.stringify(old.data[field]),'Для изменения отметок проверки используйте специальное действие',409);}
  if(kind==='project'&&old){guardProjectDateEdit(db,u,{...c,op:'entity.edit',data});}
  if(kind==='row'&&old) {
    const table=getScoped(db,u,old.parent_id,p,'table'); validateRow(db,u,table,data,Object.keys(c.data||{}));
  } else data=validateData(db,u,kind,data,p,old?.parent_id||c.parentId,old);
  if(kind==='obligation')applyFinanceDraftValues(db,u,p,kind,data,c);
  if(kind==='row'||kind==='obligation') {
    assert(!Object.hasOwn(c.data||{},'cellFormats'),'Форматирование передаётся отдельно');
    if(kind==='obligation')assert(!Object.hasOwn(c.data||{},'sheetValues'),'Пользовательские ячейки изменяются через таблицу');
    const table=kind==='row'?entity(db,old?.parent_id||c.parentId):{data:{columns:entities(db,u.agency_id,p,'financeSheet')[0]?.data.obligationColumns||obligationSheetColumns()}},formats=structuredClone(c.op==='entity.restore'?data.cellFormats||{}:old?.data.cellFormats||{});
    const changedFields=new Set([...Object.keys(c.data||{}),...Object.keys(c.formats||{}),...Object.keys(c.sheetValues||{})]);
    if(c.formats)assert(typeof c.formats==='object'&&!Array.isArray(c.formats),'Проверьте форматирование');
    for(const field of changedFields){
      const column=table.data.columns.find(item=>item.id===field);if(!column&&kind==='obligation'&&!Object.hasOwn(c.formats||{},field))continue;assert(column,'Колонка удалена',409);
      const isText=['text','url'].includes(column.type),before=String(old?.data.sheetValues?.[field]??old?.data[field]??''),after=String(data.sheetValues?.[field]??data[field]??'');
      if(Object.hasOwn(c.formats||{},field)){
        if(c.formatOnly&&isText)assert(String(c.expectedValue??'')===before,'Текст уже изменён. Обновите ячейку.',409);
        try{const format=normalizeBudgetFormat(c.formats[field],after,isText);if(format)formats[field]=format;else delete formats[field]}catch(error){assert(false,error.message)}
      }else if(isText&&formats[field]&&before!==after)formats[field]=rebaseBudgetFormat(formats[field],before,after);
    }
    if(Object.keys(formats).length)data.cellFormats=formats;else delete data.cellFormats;
  }
  let result=old?change(db,u,old,data,false,c.op==='entity.restore'?'restore':'edit'):insert(db,u,kind,data,p,c.parentId||null);
  if(kind==='vendorCategory'&&old&&data.name!==old.data.name) {
    // Wedding prices and terms remain snapshots; a corrected category label is shared.
    const linked=db.prepare("SELECT id FROM entities WHERE agency_id=? AND kind='selection' AND deleted=0 AND json_extract(data,'$.categoryId')=?").all(u.agency_id,result.id);
    for(const {id} of linked) {const selection=entity(db,id);change(db,u,selection,{...selection.data,categoryName:data.name},false,'categoryRename');}
  }
  if(kind==='row'&&entity(db,old?.parent_id||c.parentId)?.data.key==='timing')for(const site of entities(db,u.agency_id,p,'microsite'))if(site.data.status==='published'&&!site.data.dirty)change(db,u,site,{...site.data,dirty:true},false,'timingChanged');
  if(kind==='selection') {
    // Project prices are snapshots. General catalog updates never propagate here.
    const existing=data.obligationId?getScoped(db,u,data.obligationId,p,'obligation'):null;
    const obligationFields=['title','agreed','priceKind','dueDate','condition','fee','selectionId','agencyCommission'];
    if(data.selected) {
      requireAccess(db,u,c.op==='entity.restore'?['finance','history']:['finance'],p,'budget',existing?.id??null,obligationFields);
      const obligationData={...(existing?.data||{}),title:data.title,agreed:data.price,priceKind:data.price===null?'unknown':'amount',planned:existing?.data.planned??null,agencyCommission:data.agencyCommission??null,dueDate:data.dueDate||'',condition:data.terms||'',fee:false,selectionId:result.id};
      const ob=existing?change(db,u,existing,obligationData,false,existing.deleted?'restore':'edit'):insert(db,u,'obligation',obligationData,p);
      result=change(db,u,result,{...data,obligationId:ob.id});
    } else if(existing) { requireAccess(db,u,['finance','delete'],p,'budget',existing.id,obligationFields); assert(!entities(db,u.agency_id,p,'movement').some(m=>m.data.obligationId===existing.id),'У подрядчика есть выплаты: сначала исправьте их.',409); change(db,u,existing,existing.data,true,'delete'); result=change(db,u,result,{...data,obligationId:null}); }
    validateLedger(entities(db,u.agency_id,p));
    if(!result.data.vendorId&&isVenueData(result.data)&&canHoldFunds(db,u,p))result=linkVenueCatalog(db,u,result,c.op==='entity.create'?'create':'edit').selection;
  }
  if(kind==='obligation') {
    if(data.selectionId) { const sel=getScoped(db,u,data.selectionId,p,'selection'); assert(!sel.deleted,'Выбранный подрядчик удалён',409); requireAccess(db,u,'edit',p,'vendors',sel.id,['title','price','terms']); change(db,u,sel,{...sel.data,title:data.title,price:data.agreed,agencyCommission:data.agencyCommission??null,terms:data.condition||''}); }
    validateLedger(entities(db,u.agency_id,p));
  }
  return filteredMutationResult(db,u,result);
}
function applyFinanceDraftValues(db,u,p,kind,data,c){
  if(!c.sheetValues)return;
  assert(typeof c.sheetValues==='object'&&!Array.isArray(c.sheetValues),'Проверьте пользовательские ячейки');
  const config=entities(db,u.agency_id,p,'financeSheet')[0];
  assert((config?.version||0)===c.sheetVersion,'Структура таблицы изменилась. Проверьте строку.',409);
  const bases=kind==='obligation'?obligationSheetColumns():financeSheetColumns(!p),columns=kind==='obligation'?config?.data.obligationColumns||bases:config?.data.columns||bases;
  const custom=Object.keys(c.sheetValues).map(field=>{const column=columns.find(column=>column.id===field);assert(column&&!bases.some(base=>base.id===field),'Проверьте пользовательскую колонку');return column});
  validateRow(db,u,{project_id:p,data:{columns:custom}},c.sheetValues);
  if(kind==='movement')for(const column of custom){
    const before=String(data.sheetValues?.[column.id]??''),after=String(c.sheetValues[column.id]??'');
    if(['text','url'].includes(column.type)&&data.cellFormats?.[column.id]&&!Object.hasOwn(c.formats||{},column.id))data.cellFormats[column.id]=rebaseBudgetFormat(data.cellFormats[column.id],before,after);
  }
  data.sheetValues={...data.sheetValues,...c.sheetValues};
}

function movement(db,u,c) {
  const p=c.projectId||null,old=c.entityId?getScoped(db,u,c.entityId,p,'movement'):null;
  if(old) { version(old,c.version);assert(c.op==='movement.restore'?old.deleted:!old.deleted,c.op==='movement.restore'?'Операция уже восстановлена':'Операция уже удалена',409); }
  let d={...(c.op==='movement.restore'?old?.data:c.data)};
  if(old?.data.sheetValues)d.sheetValues=structuredClone(old.data.sheetValues);
  if(old?.data.cellFormats){d.cellFormats=structuredClone(old.data.cellFormats);for(const field of ['description','method'])if(d.cellFormats[field]&&old.data[field]!==d[field])d.cellFormats[field]=rebaseBudgetFormat(d.cellFormats[field],String(old.data[field]||''),String(d[field]||''));}
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
  applyFinanceDraftValues(db,u,p,'movement',d,c);
  if(c.formats){
    const columns=entities(db,u.agency_id,p,'financeSheet')[0]?.data.columns||financeSheetColumns(!p);
    for(const [field,raw] of Object.entries(c.formats)){
      const column=columns.find(column=>column.id===field);assert(column,'Колонка удалена',409);
      try{const format=normalizeBudgetFormat(raw,String(d.sheetValues?.[field]??d[field]??''),['text','url'].includes(column.type));d.cellFormats||={};if(format)d.cellFormats[field]=format;else delete d.cellFormats[field]}catch(error){assert(false,error.message)}
    }
  }
  const row=old?change(db,u,old,d,false,c.op==='movement.restore'?'restore':'edit'):insert(db,u,'movement',d,p); validateLedger(entities(db,u.agency_id,p)); return row;
}

export function upload(db,u,p,body) {
  u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(u.id,u.agency_id); assert(u,'Доступ отозван',403);
  assert(projectVisible(db,u,p),'Проект недоступен',403); requireAccess(db,u,['create','files'],p,'files',null,['name','size','mime','documentStatus']);
  const name=text(body.name,'Имя файла',1,200),bytes=Buffer.from(body.content||'','base64'); assert(bytes.length>0&&bytes.length<=PROJECT_FILE_MAX_BYTES,'Размер файла: от 1 байта до 5 МБ');
  const documentStatus=body.documentStatus||'personal';assert(['personal','pending_signature','signed'].includes(documentStatus),'Выберите раздел документа');
  return transaction(db,()=>{ const r=insert(db,u,'file',{name,size:bytes.length,mime:body.mime||'application/octet-stream',documentStatus},p); db.prepare('INSERT INTO blobs VALUES(?,?)').run(r.id,bytes); return r; });
}
export function download(db,u,id) {
  u=db.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(u.id,u.agency_id); assert(u,'Доступ отозван',403);
  const r=getScoped(db,u,id,undefined,'file'); assert(!r.deleted,'Файл удалён',404); requireAccess(db,u,['read','files'],r.project_id,'files',id,Object.keys(r.data)); return {row:r,content:db.prepare('SELECT content FROM blobs WHERE id=?').get(id).content};
}

function saveSheetLayout(db,u,c){
  assert(c.projectId,'Укажите свадьбу');
  const old=c.entityId?getScoped(db,u,c.entityId,c.projectId,'table'):entities(db,u.agency_id,c.projectId,'coupleBudget')[0];
  if(old)assert(!old.deleted,'Таблица удалена',409);
  const data=structuredClone(old?.data||{});
  const columns=c.entityId?[...data.columns.map(column=>column.id),...(data.key==='guests'?[GUEST_ACTIONS_COLUMN]:[])]:['name','estimated','actual','prepaid','remaining','note',...(data.extraColumns||[]).map(column=>column.id)];
  const rows=c.entityId?entities(db,u.agency_id,c.projectId,'row',true).filter(row=>row.parent_id===old.id).map(row=>row.id):coupleBudgetViewGroups({...data,deletedRows:[]}).flatMap(group=>[group.row,...group.items.map(item=>item.row)]);
  assert(['columnWidths','rowHeights'].includes(c.axis)&&typeof c.key==='string','Выберите строку или колонку');
  try{data.sheetLayout=normalizeSheetLayout({...data.sheetLayout,[c.axis]:{...data.sheetLayout?.[c.axis],[c.key]:c.value}},columns,rows)}catch(error){assert(false,error.message)}
  const saved=old?change(db,u,old,data,false,'resize'):insert(db,u,'coupleBudget',data,c.projectId);
  return saved.kind==='table'?visibleTable(db,u,c.projectId,saved):filteredRow(db,u,saved);
}

function editCoupleBudgetStructure(db,u,c){
  const old=entities(db,u.agency_id,c.projectId,'coupleBudget')[0]||null,data=structuredClone(old?.data||{});
  if(c.action==='columns'){
    const columns=c.columns;
    validateColumns(columns);
    const baseIds=new Set(coupleBudgetBaseColumns.map(column=>column.id));
    assert(coupleBudgetBaseColumns.every(base=>columns.some(column=>column.id===base.id&&column.type===base.type&&(!base.formula||column.formula===base.formula))),'Расчётные колонки нужно сохранять; их можно скрыть');
    assert(columns.every(column=>baseIds.has(column.id)||['text','select','money','number','date','time','boolean','url','formula'].includes(column.type)),'Неизвестный тип колонки');
    assert(Array.isArray(c.hiddenColumns)&&c.hiddenColumns.every(id=>columns.some(column=>column.id===id))&&!c.hiddenColumns.includes('name'),'Название статьи нельзя скрыть');
    assert((data.extraColumns||[]).every(old=>!columns.some(column=>column.id===old.id&&column.type!==old.type)),'Тип колонки с существующими данными менять нельзя');
    data.deletedColumns=[...(data.deletedColumns||[]),...(data.extraColumns||[]).filter(old=>!columns.some(column=>column.id===old.id))].filter((column,index,all)=>all.findIndex(item=>item.id===column.id)===index&&!columns.some(item=>item.id===column.id));
    data.extraColumns=columns.filter(column=>!baseIds.has(column.id));data.columnOrder=columns.map(column=>column.id);data.columnLabels=Object.fromEntries(columns.map(column=>[column.id,column.name]));data.hiddenColumns=[...new Set(c.hiddenColumns)];
    if(data.sheetLayout)data.sheetLayout.columnWidths=Object.fromEntries(Object.entries(data.sheetLayout.columnWidths||{}).filter(([id])=>columns.some(column=>column.id===id)));
  }else if(c.action==='delete'){
    const found=coupleBudgetFind(data,c.row);assert(found,'Строка сметы не найдена',404);
    const ids=found.item?[found.item.row]:[found.group.row,...found.group.items.map(item=>item.row)];
    data.deletedRows=[...new Set([...(data.deletedRows||[]),...ids.map(String)])];
  }else if(c.action==='restore'){const found=coupleBudgetFind({...data,deletedRows:[]},c.row);assert(found,'Строка сметы не найдена',404);const ids=found.item?[String(found.item.row),String(found.group.row)]:[String(found.group.row),...found.group.items.map(item=>String(item.row))];data.deletedRows=(data.deletedRows||[]).filter(id=>!ids.includes(String(id)));}
  else assert(false,'Неизвестное изменение сметы');
  const saved=old?change(db,u,old,data,false,'structure'):insert(db,u,'coupleBudget',data,c.projectId);return filteredRow(db,u,saved);
}

function editFinanceSheet(db,u,c){
  const p=c.projectId||null,old=entities(db,u.agency_id,p,'financeSheet')[0]||null,data=structuredClone(old?.data||{name:p?'Движение средств пары':'Операции агентства',columns:financeSheetColumns(!p)}),columns=c.target==='obligation'?(data.obligationColumns||obligationSheetColumns()):data.columns;
  if(c.op==='financeSheet.cell'){
    const row=getScoped(db,u,c.entityId,p,c.target==='obligation'?'obligation':'movement');assert(!row.deleted,'Операция удалена',409);version(row,c.version);
    const column=columns.find(column=>column.id===c.field);assert(column,'Колонка удалена',409);if(c.formatOnly)assert(Object.hasOwn(c,'format'),'Укажите оформление');
    const base=(c.target==='obligation'?obligationSheetColumns():financeSheetColumns(!p)).some(column=>column.id===c.field),next=structuredClone(row.data),before=base?next[c.field]:next.sheetValues?.[c.field],isText=['text','url'].includes(column.type);
    if(!c.formatOnly){assert(column.type!=='formula'&&!column.computed,'Вычисление нельзя редактировать');if(!base||c.target!=='obligation')validateRow(db,u,{project_id:p,data:{columns:[column]}},{[c.field]:c.value});if(base)next[c.field]=c.value;else{next.sheetValues||={};next.sheetValues[c.field]=c.value}}
    if(Object.hasOwn(c,'format')){if(c.formatOnly&&isText)assert(String(c.expectedValue??'')===String(before??''),'Текст уже изменён. Обновите ячейку.',409);try{const format=normalizeBudgetFormat(c.format,String(c.formatOnly?before??'':c.value??''),isText);next.cellFormats||={};if(format)next.cellFormats[c.field]=format;else delete next.cellFormats[c.field]}catch(error){assert(false,error.message)}}
    if(c.target==='obligation'&&base){assert(c.field!=='agencyCommission'||canHoldFunds(db,u,p),'Комиссия доступна только организаторам',403);const values=c.formatOnly?{}:{[c.field]:c.value};if(!c.formatOnly&&c.field==='agreed'){const priceKind=c.value==null?'unknown':'amount';if(priceKind!==row.data.priceKind){requireAccess(db,u,['edit','finance'],p,'budget',row.id,['agreed','priceKind']);values.priceKind=priceKind}}return mutateEntity(db,u,{...c,op:'entity.edit',data:values,formats:Object.hasOwn(c,'format')?{[c.field]:c.format}:undefined});}
    if(!c.formatOnly&&base){const saved=movement(db,u,{...c,op:'movement.save',data:next,obligationVersion:next.obligationId?entity(db,next.obligationId)?.version:undefined});return financeSheetRow(db,u,change(db,u,saved,{...saved.data,cellFormats:next.cellFormats||{}},false,'format'))}
    return financeSheetRow(db,u,change(db,u,row,next,false,'cell')); 
  }
  if(c.op==='financeSheet.structure'){
    validateColumns(c.columns);const hidden=c.hiddenColumns||[];assert(Array.isArray(hidden)&&hidden.every(id=>c.columns.some(column=>column.id===id))&&!hidden.includes(c.target==='obligation'?'title':'description'),'Проверьте скрытые колонки');data[c.target==='obligation'?'obligationHiddenColumns':'hiddenColumns']=[...new Set(hidden)];
    assert((c.target==='obligation'?obligationSheetColumns():financeSheetColumns(!p)).every(base=>c.columns.some(column=>column.id===base.id&&column.type===base.type)),'Служебные колонки операций нужно сохранять');
    assert(c.columns.every(column=>['text','select','money','number','date','time','boolean','url','formula'].includes(column.type)),'Неизвестный тип колонки');
    assert(columns.every(old=>!c.columns.some(column=>column.id===old.id&&column.type!==old.type)),'Тип существующей колонки менять нельзя');
    const removedKey=c.target==='obligation'?'deletedObligationColumns':'deletedColumns';data[removedKey]=[...(data[removedKey]||[]),...columns.filter(old=>!c.columns.some(column=>column.id===old.id))].filter((column,index,all)=>all.findIndex(item=>item.id===column.id)===index&&!c.columns.some(item=>item.id===column.id));
    if(c.target==='obligation')data.obligationColumns=c.columns.map(column=>({...column,...(obligationSheetColumns().find(base=>base.id===column.id)||{}),name:column.name}));
    else data.columns=c.columns.map(column=>column.id==='type'?{...column,...financeSheetColumns(!p).find(base=>base.id==='type'),name:column.name}:column);
    const key=c.target==='obligation'?'obligationLayout':'sheetLayout';if(data[key])data[key].columnWidths=Object.fromEntries(Object.entries(data[key].columnWidths||{}).filter(([id])=>c.columns.some(column=>column.id===id))); 
  }else if(c.op==='financeSheet.layout'){
    assert(['columnWidths','rowHeights'].includes(c.axis),'Выберите размер');const rows=entities(db,u.agency_id,p,c.target==='obligation'?'obligation':'movement',true),key=c.target==='obligation'?'obligationLayout':'sheetLayout';
    try{data[key]=normalizeSheetLayout({...data[key],[c.axis]:{...data[key]?.[c.axis],[c.key]:c.value}},columns.map(column=>column.id),rows.map(row=>row.id))}catch(error){assert(false,error.message)}
  }else assert(false,'Неизвестное изменение таблицы');
  return old?change(db,u,old,data,false,'structure'):insert(db,u,'financeSheet',data,p);
}

function financeSheetRow(db,u,row){
  if(row.project_id)return filteredRow(db,u,row);
  if(!can(db,u,['read','agencyFinance'],null,'agencyFinance',row.id))return null;
  const data={};
  for(const[key,value]of Object.entries(row.data)){
    if(['cellFormats','sheetValues'].includes(key))data[key]=Object.fromEntries(Object.entries(value).filter(([field])=>can(db,u,['read','agencyFinance'],null,'agencyFinance',row.id,field)));
    else if(can(db,u,['read','agencyFinance'],null,'agencyFinance',row.id,key))data[key]=value;
  }
  return {...row,data};
}

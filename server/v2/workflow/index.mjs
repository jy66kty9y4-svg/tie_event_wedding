import { assert, audit, change, entities, entity, insert, now, uid, version } from '../../db.mjs';
import { can, digest, requireAccess } from '../../auth.mjs';
import { amount, date, getScoped, projectVisible, text } from '../../model.mjs';
import { addDays, listPage, projectAccess, scoped, zonedInstant } from '../common.mjs';

const TASK_STATUSES = new Set(['todo', 'doing', 'done', 'skipped']);
const APPROVAL_POLICIES = new Set(['any', 'all']);
const APPROVAL_CATEGORIES = new Set(['vendor', 'decor', 'menu', 'other']);
const MAX_OFFSET = 1095;

export const DEFAULT_TASK_BLUEPRINTS = [
  ['brief_budget','Бриф и бюджет','start',-180], ['guest_list','Список гостей','start',-170],
  ['venue','Площадка','vendors',-160], ['concept','Концепция','style',-145],
  ['photo','Фотограф','vendors',-140], ['video','Видеограф','vendors',-140],
  ['host','Ведущий','vendors',-130], ['decor','Декор','style',-120], ['looks','Образы','style',-110],
  ['menu','Меню','vendors',-90], ['invites','Приглашения','guests',-75], ['transfer','Трансфер','logistics',-60],
  ['rsvp','Сбор ответов','guests',-45], ['seating','Рассадка','guests',-30], ['timing','Окончательный тайминг','day',-21],
  ['team_confirm','Подтверждение команды','day',-14], ['final_payments','Финальные выплаты','finance',-7], ['returns','Возврат имущества','after',2]
].map(([key,title,phaseKey,offsetDays], order) => ({ key,title,phaseKey,offsetDays,order,assigneeRole:null,dependencyKeys:[] }));

function object(value, label='Проверьте данные') { assert(value && typeof value === 'object' && !Array.isArray(value),label); return value; }
function optionalText(value,label,max=8000) { return value == null || value === '' ? '' : text(value,label,1,max); }
function ids(value,label='Проверьте список') { assert(Array.isArray(value) && value.length <= 100 && new Set(value).size === value.length,label); return value; }
// The shared `members` helper will be corrected by the integration worker. Keep this
// implementation local so the module's validations use an actual project ID today.
function workflowMembers(db,u,projectId) {
  projectAccess(db,u,projectId);
  return db.prepare('SELECT * FROM users WHERE agency_id=? AND disabled=0 ORDER BY name,id').all(u.agency_id)
    .filter(person=>projectVisible(db,person,projectId)).map(({id,name})=>({id,name}));
}
function validateWorkflowMembers(db,u,projectId,value) {
  ids(value,'Проверьте участников'); const available=new Set(workflowMembers(db,u,projectId).map(person=>person.id));
  assert(value.every(id=>available.has(id)),'Участник больше не имеет доступа к проекту',409); return value;
}
function taskSection(row) { return row.kind === 'approval' || row.kind === 'approvalRevision' ? 'approvals' : 'tasks'; }
function taskRows(db,u,project,{includeDeleted=false}={}) { return entities(db,u.agency_id,project,'task',includeDeleted); }
function requireTaskAccess(db,u,c,action,row=null,fields=undefined) { projectAccess(db,u,c.projectId,action,'tasks',row?.id,fields); }
function requireApprovalAccess(db,u,c,action,row=null,fields=undefined) { projectAccess(db,u,c.projectId,action,'approvals',row?.id,fields); }
function requireTask(db,u,project,id,{deleted=false}={}) { return scoped(db,u,id,project,'task',{deleted}); }
function requireApproval(db,u,project,id,{deleted=false}={}) { return scoped(db,u,id,project,'approval',{deleted}); }
function projectDate(project) { return date(project.data.date,false); }
function normalizedDue(project, source, existing={}) {
  const dueMode = source.dueMode ?? existing.dueMode ?? 'relative';
  assert(dueMode === 'fixed' || dueMode === 'relative','Проверьте правило срока');
  if (dueMode === 'fixed') {
    const fixedDate = date(source.fixedDate ?? existing.fixedDate,false);
    return {dueMode, fixedDate, offsetDays:null, dueDate:fixedDate};
  }
  const offsetDays = Number(source.offsetDays ?? existing.offsetDays ?? 0);
  assert(Number.isInteger(offsetDays) && Math.abs(offsetDays) <= MAX_OFFSET,`Смещение срока: от −${MAX_OFFSET} до ${MAX_OFFSET} дней`);
  return {dueMode, fixedDate:'', offsetDays, dueDate:addDays(projectDate(project),offsetDays)};
}
function validateDependencies(db,u,project,taskId,dependencyIds) {
  ids(dependencyIds,'Проверьте зависимости'); assert(!dependencyIds.includes(taskId),'Задача не может зависеть от себя');
  const rows=taskRows(db,u,project,{includeDeleted:true}), byId=new Map(rows.map(row=>[row.id,row]));
  for(const id of dependencyIds) assert(byId.get(id) && !byId.get(id).deleted,'Зависимость не найдена или удалена',409);
  const visit=(id,seen=new Set())=>{
    if(id===taskId) return true;
    if(seen.has(id)) return false; seen.add(id);
    const row=byId.get(id); const deps=id===taskId?dependencyIds:(row?.data.dependencyIds||[]);
    return deps.some(next=>visit(next,new Set(seen)));
  };
  assert(!dependencyIds.some(id=>visit(id)),'Зависимости образуют цикл',409);
  return dependencyIds;
}
function taskData(db,u,project,source={},existing={}) {
  object(source); const due=normalizedDue(project,source,existing);
  const projectId=typeof project==='string'?project:project.id;
  const assigneeUserId = source.assigneeUserId === undefined ? (existing.assigneeUserId || null) : (source.assigneeUserId || null);
  const participantUserIds = source.participantUserIds === undefined ? (existing.participantUserIds || []) : ids(source.participantUserIds);
  if(assigneeUserId) validateWorkflowMembers(db,u,projectId,[assigneeUserId]); validateWorkflowMembers(db,u,projectId,participantUserIds);
  const dependencyIds=source.dependencyIds === undefined ? (existing.dependencyIds || []) : validateDependencies(db,u,projectId,existing.id||'new',ids(source.dependencyIds));
  const status=source.status ?? existing.status ?? 'todo'; assert(TASK_STATUSES.has(status),'Неизвестный статус задачи');
  const skipReason=source.skipReason === undefined ? (existing.skipReason || '') : optionalText(source.skipReason,'Причина',1000);
  if(status==='skipped') assert(skipReason.length>=3,'Для статуса «Не требуется» укажите причину не короче 3 символов');
  const priority=source.priority ?? existing.priority ?? 'normal'; assert(['low','normal','high','urgent'].includes(priority),'Проверьте приоритет');
  return {
    title: source.title === undefined ? existing.title : text(source.title,'Название задачи'),
    description: source.description === undefined ? (existing.description||'') : optionalText(source.description,'Описание'),
    phaseKey: source.phaseKey === undefined ? (existing.phaseKey||'general') : text(source.phaseKey,'Этап',1,80),
    status, assigneeUserId, participantUserIds, ...due, dependencyIds, priority,
    approvalId: source.approvalId === undefined ? (existing.approvalId||null) : (source.approvalId||null),
    selectionId: source.selectionId === undefined ? (existing.selectionId||null) : (source.selectionId||null),
    fileIds: source.fileIds === undefined ? (existing.fileIds||[]) : ids(source.fileIds),
    sourceTemplateId: existing.sourceTemplateId||source.sourceTemplateId||null,
    sourceTemplateVersion: existing.sourceTemplateVersion||source.sourceTemplateVersion||null,
    sourceTemplateKey: existing.sourceTemplateKey||source.sourceTemplateKey||null,
    skipReason, order: Number.isFinite(source.order) ? Number(source.order) : (existing.order ?? 0),
    completedAt: existing.completedAt||null, completedBy: existing.completedBy||null
  };
}
function setTaskStatus(db,u,c) {
  const row=requireTask(db,u,c.projectId,c.entityId); requireTaskAccess(db,u,c,'edit',row,['status']); version(row,c.version);
  const status=c.status; assert(TASK_STATUSES.has(status),'Неизвестный статус задачи');
  const skipReason=optionalText(c.skipReason ?? row.data.skipReason,'Причина',1000);
  if(status==='skipped') assert(skipReason.length>=3,'Для статуса «Не требуется» укажите причину не короче 3 символов');
  if(status==='done') {
    const blocked=(row.data.dependencyIds||[]).map(id=>entity(db,id)).filter(dep=>dep && !dep.deleted && !['done','skipped'].includes(dep.data.status));
    assert(!blocked.length,'Нельзя завершить задачу: не завершены зависимости',409,{code:'task_blocked',dependencies:blocked.map(x=>({id:x.id,title:x.data.title,status:x.data.status,version:x.version}))});
  }
  const next={...row.data,status,skipReason:status==='skipped'?skipReason:'',completedAt:['done','skipped'].includes(status)?now():null,completedBy:['done','skipped'].includes(status)?u.id:null};
  return change(db,u,row,next,false,'setStatus');
}
function approvalOptions(value) {
  assert(Array.isArray(value) && value.length>=1 && value.length<=6,'Добавьте от 1 до 6 вариантов');
  return value.map((raw,index)=>{ object(raw,'Проверьте вариант'); const option={
    id: raw.id && /^[a-zA-Z0-9_-]{1,100}$/.test(raw.id) ? raw.id : `option_${index+1}`,
    title:text(raw.title,'Название варианта'), description:optionalText(raw.description,'Описание'),
    price:raw.price == null ? null : amount(raw.price,true), included:optionalText(raw.included,'Состав'), terms:optionalText(raw.terms,'Условия'),
    availability:optionalText(raw.availability,'Доступность',1000), comment:optionalText(raw.comment,'Комментарий',2000),
    vendorId:raw.vendorId||null, selectionId:raw.selectionId||null, fileIds:ids(raw.fileIds||[],'Проверьте файлы'), imageIds:ids(raw.imageIds||[],'Проверьте изображения')
  }; assert(!value.slice(0,index).some(other=>other.id===option.id),'ID варианта повторяется'); return option; });
}
function approvalDraftData(db,u,project,source,existing={}) {
  object(source); const policy=source.policy ?? existing.policy ?? 'any'; assert(APPROVAL_POLICIES.has(policy),'Проверьте правило решения');
  const projectId=typeof project==='string'?project:project.id;
  const approverUserIds=source.approverUserIds === undefined ? (existing.approverUserIds||[]) : ids(source.approverUserIds);
  validateWorkflowMembers(db,u,projectId,approverUserIds); assert(approverUserIds.length,'Выберите согласующих');
  const category=source.category ?? existing.category ?? 'other'; assert(APPROVAL_CATEGORIES.has(category),'Проверьте категорию');
  return { title:source.title === undefined ? existing.title : text(source.title,'Название согласования'), category,
    draft:source.draft === undefined ? (existing.draft||'') : optionalText(source.draft,'Описание'),
    approverUserIds,policy,options:source.options === undefined ? (existing.options||[]) : approvalOptions(source.options),
    sourceTaskId:source.sourceTaskId === undefined ? (existing.sourceTaskId||null) : (source.sourceTaskId||null),
    dueDate:source.dueDate === undefined ? (existing.dueDate||'') : date(source.dueDate),
    currentRevisionId:existing.currentRevisionId||null,state:existing.state||'draft',outcomeOptionId:existing.outcomeOptionId||null,discussion:false
  };
}
function revision(db,u,id,project) { return scoped(db,u,id,project,'approvalRevision'); }
function votes(db,revisionId) { return db.prepare('SELECT * FROM approval_votes WHERE revision_id=? ORDER BY created_at,user_id').all(revisionId).map(row=>({...row, option_id:row.option_id||null})); }
function approvalResult(db,approval,revisionRow) {
  const currentVotes=votes(db,revisionRow.id).map(v=>({userId:v.user_id,decision:v.decision,optionId:v.option_id,comment:v.comment,createdAt:v.created_at,version:v.version}));
  return {approval,revision:revisionRow,votes:currentVotes};
}
function decideAll(approval,revisionRow,currentVotes) {
  if(currentVotes.some(v=>v.decision==='request_changes')) return {state:'changes',outcomeOptionId:null,discussion:false};
  const approvals=currentVotes.filter(v=>v.decision==='approve');
  if(approvals.length < revisionRow.data.approverUserIds.length) return {state:'in_review',outcomeOptionId:null,discussion:false};
  const optionIds=new Set(approvals.map(v=>v.option_id));
  return optionIds.size===1 ? {state:'approved',outcomeOptionId:approvals[0].option_id,discussion:false} : {state:'in_review',outcomeOptionId:null,discussion:true};
}
function publishApproval(db,u,c) {
  const approval=requireApproval(db,u,c.projectId,c.entityId); requireApprovalAccess(db,u,c,'edit',approval); version(approval,c.version);
  assert(['draft','changes','withdrawn'].includes(approval.data.state),'Текущая ревизия уже открыта',409);
  const data=approval.data; assert(data.options.length,'Добавьте хотя бы один вариант');
  validateWorkflowMembers(db,u,c.projectId,data.approverUserIds);
  const revisionRow=insert(db,u,'approvalRevision',{number:(entities(db,u.agency_id,c.projectId,'approvalRevision',true).filter(row=>row.parent_id===approval.id).length+1),approverUserIds:[...data.approverUserIds],policy:data.policy,options:structuredClone(data.options),publishedAt:now(),publishedBy:u.id,withdrawnAt:null,withdrawReason:'',state:'open'},c.projectId,approval.id);
  const next=change(db,u,approval,{...data,currentRevisionId:revisionRow.id,state:'in_review',outcomeOptionId:null,discussion:false},false,'publish');
  return {approval:next,revision:revisionRow};
}
function withdrawApproval(db,u,c) {
  const approval=requireApproval(db,u,c.projectId,c.entityId); requireApprovalAccess(db,u,c,'edit',approval); version(approval,c.version);
  const row=revision(db,u,approval.data.currentRevisionId,c.projectId); assert(row.data.state==='open'&&!row.data.withdrawnAt,'Ревизия уже закрыта',409);
  const reason=text(c.reason,'Причина отзыва',3,1000);
  const nextRevision=change(db,u,row,{...row.data,state:'withdrawn',withdrawnAt:now(),withdrawnBy:u.id,withdrawReason:reason},false,'withdraw');
  const nextApproval=change(db,u,approval,{...approval.data,state:'withdrawn'},false,'withdraw'); return {approval:nextApproval,revision:nextRevision};
}
function voteApproval(db,u,c) {
  const approval=requireApproval(db,u,c.projectId,c.entityId); requireApprovalAccess(db,u,c,'edit',approval,['currentRevisionId']);
  assert(c.revisionId===approval.data.currentRevisionId,'Согласование уже имеет новую ревизию',409,{code:'current_revision_changed',currentRevisionId:approval.data.currentRevisionId});
  const row=revision(db,u,c.revisionId,c.projectId); assert(row.parent_id===approval.id,'Ревизия относится к другому согласованию',409);
  assert(row.data.state==='open'&&!row.data.withdrawnAt,'Голосование по этой ревизии закрыто',409);
  assert(row.data.approverUserIds.includes(u.id),'Решение может принять только указанный согласующий',403);
  const decision=c.decision; assert(decision==='approve'||decision==='request_changes','Проверьте решение');
  const optionId=decision==='approve'?c.optionId:null;
  if(decision==='approve') assert(row.data.options.some(option=>option.id===optionId),'Вариант не принадлежит этой ревизии',409);
  const comment=optionalText(c.comment,'Комментарий',2000); if(decision==='request_changes') assert(comment.length>=1,'Для запроса изменений нужен комментарий');
  if(approval.data.state==='approved'||approval.data.state==='changes') return approvalResult(db,approval,row);
  const prior=db.prepare('SELECT * FROM approval_votes WHERE revision_id=? AND user_id=?').get(row.id,u.id);
  if(prior) db.prepare('UPDATE approval_votes SET decision=?,option_id=?,comment=?,created_at=?,version=version+1 WHERE revision_id=? AND user_id=?').run(decision,optionId,comment,now(),row.id,u.id);
  else db.prepare('INSERT INTO approval_votes(revision_id,user_id,decision,option_id,comment,created_at,version) VALUES(?,?,?,?,?,?,1)').run(row.id,u.id,decision,optionId,comment,now());
  const current=votes(db,row.id), outcome=row.data.policy==='any' ? (decision==='approve'?{state:'approved',outcomeOptionId:optionId,discussion:false}:{state:'changes',outcomeOptionId:null,discussion:false}) : decideAll(approval,row,current);
  const next=change(db,u,approval,{...approval.data,...outcome},false,'vote'); return approvalResult(db,next,row);
}
function paidFor(db,project,obligationId) { return entities(db,entity(db,obligationId).agency_id,project,'movement').filter(row=>['payment','fee'].includes(row.data.type)&&row.data.obligationId===obligationId).reduce((sum,row)=>sum+Number(row.data.amount||0),0); }
function applyBudget(db,u,c) {
  const approval=requireApproval(db,u,c.projectId,c.entityId); requireApprovalAccess(db,u,c,'edit',approval); requireAccess(db,u,'finance',c.projectId,'budget');
  assert(approval.data.state==='approved'&&approval.data.currentRevisionId===c.revisionId,'Сначала утвердите текущую ревизию',409);
  const row=revision(db,u,c.revisionId,c.projectId); const option=row.data.options.find(item=>item.id===c.optionId);
  assert(option && option.id===approval.data.outcomeOptionId,'Вариант не является утверждённым',409); assert(Number.isSafeInteger(option.price) && option.price>=0,'В утверждённом варианте не указана сумма',409);
  const link=db.prepare('SELECT * FROM approval_budget_links WHERE revision_id=? AND option_id=?').get(row.id,option.id); if(link) return {link:{...link,applied_at:link.applied_at},alreadyApplied:true};
  let selection=option.selectionId ? scoped(db,u,option.selectionId,c.projectId,'selection') : null;
  let obligation=selection?.data.obligationId ? scoped(db,u,selection.data.obligationId,c.projectId,'obligation') : null;
  if(c.selectionId) { selection=scoped(db,u,c.selectionId,c.projectId,'selection'); assert(!option.selectionId || selection.id===option.selectionId,'Выбрана другая услуга',409); }
  if(c.obligationId) { obligation=scoped(db,u,c.obligationId,c.projectId,'obligation'); }
  if(selection && c.selectionVersion !== undefined) version(selection,c.selectionVersion); if(obligation && c.obligationVersion !== undefined) version(obligation,c.obligationVersion);
  if(!selection) selection=insert(db,u,'selection',{title:option.title,price:option.price,selected:true,terms:option.terms,vendorId:option.vendorId||null,dueDate:'',approvalRevisionId:row.id,approvalOptionId:option.id},c.projectId);
  if(!obligation) obligation=insert(db,u,'obligation',{title:option.title,priceKind:'amount',agreed:option.price,planned:null,dueDate:'',fee:false,condition:option.terms,selectionId:selection.id},c.projectId);
  const paid=paidFor(db,c.projectId,obligation.id); assert(option.price>=paid,'Новая стоимость ниже уже оплаченной суммы. Исправьте существующий учёт вручную.',409,{code:'paid_amount_conflict',paid});
  requireAccess(db,u,'edit',c.projectId,'vendors',selection.id,['price','selected']); requireAccess(db,u,'edit',c.projectId,'budget',obligation.id,['agreed']);
  selection=change(db,u,selection,{...selection.data,title:option.title,price:option.price,selected:true,terms:option.terms,vendorId:option.vendorId||selection.data.vendorId||null,obligationId:obligation.id,approvalRevisionId:row.id,approvalOptionId:option.id},false,'approvalApply');
  obligation=change(db,u,obligation,{...obligation.data,title:option.title,priceKind:'amount',agreed:option.price,condition:option.terms,selectionId:selection.id,approvalRevisionId:row.id,approvalOptionId:option.id},false,'approvalApply');
  db.prepare('INSERT INTO approval_budget_links(revision_id,option_id,selection_id,obligation_id,applied_by,applied_at) VALUES(?,?,?,?,?,?)').run(row.id,option.id,selection.id,obligation.id,u.id,now());
  return {selection,obligation,link:{revisionId:row.id,optionId:option.id,selectionId:selection.id,obligationId:obligation.id}};
}
function parentForComment(db,u,c,parentId) { const parent=getScoped(db,u,parentId,c.projectId); assert(['task','approval'].includes(parent.kind),'Комментарий можно добавить только к задаче или согласованию'); projectAccess(db,u,c.projectId,'read',taskSection(parent),parent.id); return parent; }
function commentCreate(db,u,c) { const parent=parentForComment(db,u,c,c.parentId); projectAccess(db,u,c.projectId,'create',taskSection(parent),parent.id); return insert(db,u,'comment',{text:text(c.text,'Комментарий',1,2000),authorId:u.id,createdAt:now(),editedAt:null},c.projectId,parent.id); }
function commentEdit(db,u,c) { const row=scoped(db,u,c.entityId,c.projectId,'comment'); const parent=parentForComment(db,u,c,row.parent_id); assert(row.data.authorId===u.id,'Редактировать можно только свой комментарий',403); projectAccess(db,u,c.projectId,'edit',taskSection(parent),parent.id); version(row,c.version); return change(db,u,row,{...row.data,text:text(c.text,'Комментарий',1,2000),editedAt:now()},false,'editComment'); }
function commentDelete(db,u,c) { const row=scoped(db,u,c.entityId,c.projectId,'comment'); const parent=parentForComment(db,u,c,row.parent_id); assert(row.data.authorId===u.id||can(db,u,'delete',c.projectId,taskSection(parent),parent.id),'Удалить можно только свой комментарий',403); version(row,c.version); return change(db,u,row,row.data,true,'deleteComment'); }

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS template_applications(project_id TEXT NOT NULL, template_id TEXT NOT NULL, template_version INTEGER NOT NULL, applied_at TEXT NOT NULL, applied_by TEXT NOT NULL, PRIMARY KEY(project_id,template_id,template_version));
    CREATE TABLE IF NOT EXISTS approval_votes(revision_id TEXT NOT NULL, user_id TEXT NOT NULL, decision TEXT NOT NULL, option_id TEXT, comment TEXT NOT NULL, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(revision_id,user_id));
    CREATE TABLE IF NOT EXISTS approval_budget_links(revision_id TEXT NOT NULL, option_id TEXT NOT NULL, selection_id TEXT NOT NULL, obligation_id TEXT NOT NULL, applied_by TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY(revision_id,option_id));
    CREATE INDEX IF NOT EXISTS approval_votes_revision ON approval_votes(revision_id);`);
}

export function listTasks(db,u,{projectId,from,to,assignee,status,phaseKey,offset,limit}={}) {
  projectAccess(db,u,projectId,'read','tasks'); if(from) date(from,false); if(to) date(to,false);
  const rows=taskRows(db,u,projectId).filter(row=>can(db,u,'read',projectId,'tasks',row.id)).filter(row=>
    (!from||row.data.dueDate>=from)&&(!to||row.data.dueDate<=to)&&(!assignee||row.data.assigneeUserId===assignee)&&(!status||row.data.status===status)&&(!phaseKey||row.data.phaseKey===phaseKey)
  ).sort((a,b)=>(a.data.dueDate||'9999-12-31').localeCompare(b.data.dueDate||'9999-12-31')||Number(a.data.order||0)-Number(b.data.order||0)||a.id.localeCompare(b.id));
  return listPage(rows,{offset,limit});
}
export function getApproval(db,u,{projectId,id}) {
  const approval=requireApproval(db,u,projectId,id); projectAccess(db,u,projectId,'read','approvals',approval.id);
  const revisions=entities(db,u.agency_id,projectId,'approvalRevision',true).filter(row=>row.parent_id===approval.id).sort((a,b)=>b.data.number-a.data.number).map(row=>({revision:row,votes:votes(db,row.id)}));
  return {approval,revisions,comments:entities(db,u.agency_id,projectId,'comment').filter(row=>row.parent_id===approval.id&&!row.deleted)};
}
export function listApprovals(db,u,{projectId,offset,limit}={}) { projectAccess(db,u,projectId,'read','approvals'); return listPage(entities(db,u.agency_id,projectId,'approval').filter(row=>can(db,u,'read',projectId,'approvals',row.id)),{offset,limit}); }
export function previewTemplateApplication(db,u,{projectId,templateId,templateVersion}) {
  const project=projectAccess(db,u,projectId,'read','tasks'); const template=scoped(db,u,templateId,null,'template'); assert(template.version===templateVersion,'Шаблон уже изменился',409,{currentVersion:template.version});
  const blueprints=Array.isArray(template.data.taskBlueprints)&&template.data.taskBlueprints.length?template.data.taskBlueprints:DEFAULT_TASK_BLUEPRINTS;
  const existing=new Set(taskRows(db,u,projectId).map(row=>row.data.sourceTemplateKey).filter(Boolean));
  return {projectVersion:project.version,templateId,templateVersion,adds:blueprints.filter(item=>!existing.has(item.key)).map(item=>({key:item.key,title:item.title,dueDate:addDays(projectDate(project),Number(item.offsetDays||0)),overdue:addDays(projectDate(project),Number(item.offsetDays||0))<projectDate(project)})),skipped:blueprints.filter(item=>existing.has(item.key)).map(item=>item.key)};
}
function assignedForRole(db,u,project,role) {
  if(!role) return null; if(role==='leadOrganizer') return project.data.leadOrganizerUserId||null;
  const users=workflowMembers(db,u,project.id); const byRole=users.filter(person=>db.prepare('SELECT 1 FROM grants g JOIN roles r ON r.id=g.role_id WHERE g.user_id=? AND (g.project_id=? OR g.project_id IS NULL) AND r.key=?').get(person.id,project.id,role)); return byRole.length===1?byRole[0].id:null;
}
function applyTemplate(db,u,c) {
  const project=projectAccess(db,u,c.projectId,'create','tasks'); version(project,c.projectVersion); const template=scoped(db,u,c.templateId,null,'template'); assert(template.version===c.templateVersion,'Шаблон уже изменился',409,{currentVersion:template.version});
  const previous=db.prepare('SELECT 1 FROM template_applications WHERE project_id=? AND template_id=? AND template_version=?').get(project.id,template.id,template.version); assert(!previous,'Эта версия шаблона уже применена',409);
  const preview=previewTemplateApplication(db,u,{projectId:project.id,templateId:template.id,templateVersion:template.version}); const created=[]; const keys=new Map();
  for(const blueprint of (template.data.taskBlueprints?.length?template.data.taskBlueprints:DEFAULT_TASK_BLUEPRINTS)) {
    if(preview.skipped.includes(blueprint.key)) continue;
    const data=taskData(db,u,project,{title:blueprint.title,description:blueprint.description||'',phaseKey:blueprint.phaseKey||'general',dueMode:'relative',offsetDays:Number(blueprint.offsetDays||0),assigneeUserId:assignedForRole(db,u,project,blueprint.assigneeRole),participantUserIds:[],dependencyIds:[],priority:blueprint.priority||'normal',order:Number(blueprint.order||0),sourceTemplateId:template.id,sourceTemplateVersion:template.version,sourceTemplateKey:blueprint.key});
    const createdRow=insert(db,u,'task',data,project.id); created.push(createdRow);keys.set(blueprint.key,createdRow.id);
  }
  for(const blueprint of (template.data.taskBlueprints?.length?template.data.taskBlueprints:DEFAULT_TASK_BLUEPRINTS)) { const rowId=keys.get(blueprint.key); if(!rowId) continue; const row=entity(db,rowId),dependencyIds=(blueprint.dependencyKeys||[]).map(key=>keys.get(key)).filter(Boolean); if(dependencyIds.length) change(db,u,row,{...row.data,dependencyIds},false,'templateDependencies'); }
  db.prepare('INSERT INTO template_applications(project_id,template_id,template_version,applied_at,applied_by) VALUES(?,?,?,?,?)').run(project.id,template.id,template.version,now(),u.id);
  return {created,preview};
}
export function previewReschedule(db,u,{projectId,newDate}) {
  const project=projectAccess(db,u,projectId,'read','tasks'); newDate=date(newDate,false); const affected=taskRows(db,u,projectId).filter(row=>!['done','skipped'].includes(row.data.status)&&row.data.dueMode==='relative').map(row=>({id:row.id,version:row.version,oldDate:row.data.dueDate,newDate:addDays(newDate,row.data.offsetDays),reason:'relative_task'}));
  const zone=project.data.timeZone||'Europe/Moscow';
  const meetings=entities(db,u.agency_id,projectId,'meeting').filter(row=>row.data.dateAnchor==='wedding').map(row=>{
    assert(typeof row.data.localStartTime==='string'&&Number.isInteger(row.data.durationMinutes)&&row.data.durationMinutes>0,'Привязанная встреча содержит неполные данные времени',409,{code:'anchored_meeting_invalid',meetingId:row.id});
    const startAt=zonedInstant(newDate,row.data.localStartTime,row.data.timeZone||zone,row.data.dstChoice);
    const endAt=new Date(Date.parse(startAt)+row.data.durationMinutes*60000).toISOString();
    return {id:row.id,kind:'meeting',version:row.version,oldStartAt:row.data.startAt,oldEndAt:row.data.endAt,newStartAt:startAt,newEndAt:endAt,reason:'anchored_meeting'};
  });
  const allAffected=[...affected,...meetings];
  const dependencyDigest=JSON.stringify({projectId,projectVersion:project.version,newDate,affected:allAffected.map(item=>[item.kind||'task',item.id,item.version,item.newDate||item.newStartAt])});
  return {projectId,projectVersion:project.version,oldDate:project.data.date,newDate,affected:allAffected,digest:digest(dependencyDigest)};
}
function applyReschedule(db,u,c) {
  const preview=previewReschedule(db,u,{projectId:c.projectId,newDate:c.newDate}); requireTaskAccess(db,u,c,'edit'); assert(preview.projectVersion===c.projectVersion&&preview.digest===c.previewDigest,'План переноса устарел. Постройте новый предпросмотр.',409,{code:'reschedule_stale',preview});
  const wanted=Array.isArray(c.sourceVersions)?new Map(c.sourceVersions.map(item=>[item.id,item.version])):new Map(); for(const item of preview.affected) assert(!wanted.size||wanted.get(item.id)===item.version,'Задача изменилась после предпросмотра',409,{code:'reschedule_stale',preview});
  const project=projectAccess(db,u,c.projectId,'read','tasks'); const nextProject=change(db,u,project,{...project.data,date:preview.newDate},false,'reschedule'); const changed=[];
  for(const item of preview.affected){const row=entity(db,item.id); if(item.kind==='meeting') { requireAccess(db,u,'edit',c.projectId,'calendar',row.id,['startAt','endAt']); changed.push(change(db,u,row,{...row.data,startAt:item.newStartAt,endAt:item.newEndAt},false,'reschedule')); } else changed.push(change(db,u,row,{...row.data,dueDate:item.newDate},false,'reschedule'));} return {project:nextProject,affected:changed,preview};
}

// Called by the root generic entity handler before a project edit. Moving a project
// date only through the reschedule command keeps task/meeting versions coherent.
export function guardProjectDateEdit(cmd) {
  if(cmd?.op==='entity.edit'&&cmd?.data&&Object.hasOwn(cmd.data,'date')) assert(false,'Дата свадьбы меняется через предпросмотр переноса',409,{code:'reschedule_preview_required'});
}

export const operations = {
  'task.create': {authorize(db,u,c){assert(c.projectId,'Укажите проект');requireTaskAccess(db,u,c,'create');},run(db,u,c){const project=projectAccess(db,u,c.projectId,'read','tasks');return insert(db,u,'task',taskData(db,u,project,c.data||{}),c.projectId);}},
  'task.edit': {authorize(db,u,c){assert(!Object.hasOwn(c.data||{},'status'),'Статус задачи меняется отдельным действием',409);const row=requireTask(db,u,c.projectId,c.entityId);requireTaskAccess(db,u,c,'edit',row,Object.keys(c.data||{}));},run(db,u,c){const row=requireTask(db,u,c.projectId,c.entityId);version(row,c.version);const project=projectAccess(db,u,c.projectId,'read','tasks');return change(db,u,row,taskData(db,u,project,c.data||{}, {...row.data,id:row.id}),false,'edit');}},
  'task.setStatus': {authorize(db,u,c){requireTask(db,u,c.projectId,c.entityId);},run:setTaskStatus},
  'task.delete': {authorize(db,u,c){const row=requireTask(db,u,c.projectId,c.entityId);requireTaskAccess(db,u,c,'delete',row);},run(db,u,c){const row=requireTask(db,u,c.projectId,c.entityId);version(row,c.version);const dependents=taskRows(db,u,c.projectId).filter(item=>(item.data.dependencyIds||[]).includes(row.id));assert(!dependents.length,'Сначала уберите эту задачу из зависимостей связанных задач',409,{code:'task_has_dependents',dependents:dependents.map(item=>({id:item.id,title:item.data.title,version:item.version}))});return change(db,u,row,row.data,true,'delete');}},
  'task.restore': {authorize(db,u,c){const row=requireTask(db,u,c.projectId,c.entityId,{deleted:true});requireTaskAccess(db,u,c,'history',row);},run(db,u,c){const row=requireTask(db,u,c.projectId,c.entityId,{deleted:true});version(row,c.version);validateDependencies(db,u,c.projectId,row.id,row.data.dependencyIds||[]);return change(db,u,row,row.data,false,'restore');}},
  'taskTemplate.apply': {authorize(db,u,c){requireTaskAccess(db,u,c,'create');},run:applyTemplate},
  'project.reschedule.apply': {authorize(db,u,c){requireTaskAccess(db,u,c,'edit');},run:applyReschedule},
  'approval.saveDraft': {authorize(db,u,c){if(c.entityId){const row=requireApproval(db,u,c.projectId,c.entityId);requireApprovalAccess(db,u,c,'edit',row,Object.keys(c.data||{}));}else requireApprovalAccess(db,u,c,'create');},run(db,u,c){const project=projectAccess(db,u,c.projectId,'read','approvals');if(!c.entityId){const data=approvalDraftData(db,u,project,c.data||{});return insert(db,u,'approval',data,c.projectId);}const row=requireApproval(db,u,c.projectId,c.entityId);version(row,c.version);assert(['draft','changes','withdrawn'].includes(row.data.state),'Изменение отправленной ревизии требует новой темы или отзыва',409);return change(db,u,row,approvalDraftData(db,u,project,c.data||{},row.data),false,'saveDraft');}},
  'approval.publish': {authorize(db,u,c){const row=requireApproval(db,u,c.projectId,c.entityId);requireApprovalAccess(db,u,c,'edit',row);},run:publishApproval},
  'approval.withdraw': {authorize(db,u,c){const row=requireApproval(db,u,c.projectId,c.entityId);requireApprovalAccess(db,u,c,'edit',row);},run:withdrawApproval},
  'approval.vote': {authorize(db,u,c){const row=requireApproval(db,u,c.projectId,c.entityId);requireApprovalAccess(db,u,c,'edit',row);},run:voteApproval},
  'approval.applyToBudget': {authorize(db,u,c){const row=requireApproval(db,u,c.projectId,c.entityId);requireApprovalAccess(db,u,c,'edit',row);requireAccess(db,u,'finance',c.projectId,'budget');},run:applyBudget},
  'comment.create': {authorize(db,u,c){parentForComment(db,u,c,c.parentId);},run:commentCreate},
  'comment.edit': {authorize(db,u,c){const row=scoped(db,u,c.entityId,c.projectId,'comment');parentForComment(db,u,c,row.parent_id);},run:commentEdit},
  'comment.delete': {authorize(db,u,c){const row=scoped(db,u,c.entityId,c.projectId,'comment');parentForComment(db,u,c,row.parent_id);},run:commentDelete}
};

// Root may register these pure functions in the central dispatcher/old project-date guard.
export const integrationHooks = { previewReschedule, previewTemplateApplication, listTasks, listApprovals, getApproval, guardProjectDateEdit };

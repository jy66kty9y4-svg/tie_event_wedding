import {existsSync} from 'node:fs';
import {openDatabase,assert,transaction} from './db.mjs';
import {initialTemplate,text,validateColumns} from './model.mjs';
import {templateColumns,templateSemanticMap,templateTableSettings,templateSettings} from './wedding-template.mjs';
import {DEFAULT_TASK_BLUEPRINTS,DEFAULT_TASK_PHASES} from '../src/task-blueprints.js';
import {questionnaireQuestions} from '../src/questionnaire.js';
import {snapshot} from './service.mjs';

const quote=name=>'"'+name.replaceAll('"','""')+'"';
const rolesToKeep=new Set(['admin','organizer','couple','coordinator','contractor','student']);
const definitionKinds=new Set(['template','category','vendorCategory']);
const allowedTables=new Set(['agencies','users','roles','grants','entities','migrations']);
const tables=db=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
const count=(db,table)=>db.prepare(`SELECT count(*) AS n FROM ${quote(table)}`).get().n;
function copyRow(db,table,row){const keys=Object.keys(row);db.prepare(`INSERT INTO ${quote(table)} (${keys.map(quote)}) VALUES(${keys.map(()=>'?')})`).run(...keys.map(key=>row[key]))}

function cleanTemplate(data){
  const base=initialTemplate(),sections=(data.sections||base.sections).map((s,i)=>({key:text(s.key),name:text(s.name),order:Number(s.order??i)})),keys=new Set(sections.map(s=>s.key));
  const tables=(data.tables||base.tables).map(t=>{
    const columns=templateColumns(t.columns);validateColumns(columns);assert(keys.has(t.section),'Раздел шаблона не найден');
    return {key:text(t.key),name:text(t.name),section:t.section,offline:t.offline===true,columns,...templateSemanticMap({...t,columns}),...templateTableSettings({...t,columns})};
  });
  const taskBlueprints=(data.taskBlueprints||DEFAULT_TASK_BLUEPRINTS).map((task,i)=>({key:text(task.key),title:text(task.title),description:typeof task.description==='string'?task.description:'',phaseKey:task.phaseKey||'general',dueMode:'none',offsetDays:0,order:Number(task.order??i),priority:task.priority||'normal',assigneeRole:['leadOrganizer','couple','organizer','coordinator'].includes(task.assigneeRole)?task.assigneeRole:null,dependencyKeys:structuredClone(task.dependencyKeys||[])}));
  const taskKeys=new Set(taskBlueprints.map(task=>task.key));assert(taskKeys.size===taskBlueprints.length&&taskBlueprints.every(t=>t.dependencyKeys.every(key=>taskKeys.has(key)&&key!==t.key)),'Проверьте зависимости шаблона');
  return {name:text(data.name),sections,tables,taskBlueprints,taskPhases:structuredClone(data.taskPhases||DEFAULT_TASK_PHASES),categories:structuredClone(data.categories||[]),offline:structuredClone(data.offline||[]),...templateSettings(data)};
}

export function cleanResetPlan(source,{agencyId,keepUserIds}){
  assert(Array.isArray(keepUserIds)&&keepUserIds.length===3&&new Set(keepUserIds).size===3,'Нужны ровно три сохраняемых аккаунта');
  const agency=source.prepare('SELECT * FROM agencies WHERE id=?').get(agencyId);assert(agency,'Агентство не найдено');
  assert(count(source,'agencies')===1,'Процедура рассчитана на одно агентство');
  const users=keepUserIds.map(id=>source.prepare('SELECT * FROM users WHERE id=? AND agency_id=? AND disabled=0').get(id,agencyId));assert(users.every(Boolean),'Сохраняемый аккаунт не найден или отключён');
  assert(users.filter(u=>u.protected===1).length===1,'Должен сохраниться один основной администратор');
  const grants=source.prepare('SELECT * FROM grants WHERE agency_id=? AND project_id IS NULL').all(agencyId).filter(g=>keepUserIds.includes(g.user_id));
  assert(users.every(u=>grants.some(g=>g.user_id===u.id)),'У сохраняемого аккаунта нет доступа к агентству');
  const roleIds=new Set(grants.map(g=>g.role_id)),roles=source.prepare('SELECT * FROM roles WHERE agency_id=?').all(agencyId).filter(r=>rolesToKeep.has(r.key)||roleIds.has(r.id));
  assert(grants.every(g=>roles.some(r=>r.id===g.role_id)),'Не найдена роль сохраняемого аккаунта');
  const definitions=source.prepare('SELECT * FROM entities WHERE agency_id=? AND project_id IS NULL AND deleted=0 ORDER BY updated_at,id').all(agencyId).filter(r=>definitionKinds.has(r.kind)&&(r.kind!=='category'||JSON.parse(r.data).scope==='agency'));
  assert(definitions.some(r=>r.kind==='template'),'Не найден ни один шаблон свадьбы');
  return {agency,users,roles,grants,definitions};
}

// Maintenance-only utility: it never edits the source database or exposes an
// HTTP operation. The caller must validate a new file before switching it live.
export function makeCleanDatabase(source,output,options){
  assert(output===':memory:'||!existsSync(output),'Чистая база уже существует');
  const plan=cleanResetPlan(source,options),target=openDatabase(output);
  try{
    assert(JSON.stringify(tables(target))===JSON.stringify(tables(source)),'Схема источника отличается от проверенной схемы');
    transaction(target,()=>{
      const settings={tagline:'',description:'',contact:'',services:[],portfolio:[]};
      copyRow(target,'agencies',{...plan.agency,settings:JSON.stringify(settings),version:1});
      for(const user of plan.users)copyRow(target,'users',{...user,version:1});
      for(const role of plan.roles)copyRow(target,'roles',role);
      for(const grant of plan.grants)copyRow(target,'grants',grant);
      // Listing order chooses the default template. Keep it stable even when
      // the entire copy occurs within one millisecond.
      const definitionTime=Date.now();
      for(const [index,row] of plan.definitions.entries()){const data=JSON.parse(row.data),clean=row.kind==='template'?cleanTemplate(data):{name:text(data.name),archived:false,...(row.kind==='category'?{scope:'agency'}:{})};copyRow(target,'entities',{...row,parent_id:null,data:JSON.stringify(clean),version:1,deleted:0,updated_at:new Date(definitionTime+index).toISOString()})}
    });
    for(const user of plan.users){const saved=target.prepare('SELECT * FROM users WHERE id=?').get(user.id);assert(saved.password===user.password&&saved.email===user.email&&saved.phone===user.phone&&saved.protected===user.protected,'Учётные данные изменились');const state=snapshot(target,saved);assert(state.projects.length===0&&state.notifications.length===0&&!state.onboarding,'В кабинете остались рабочие данные')}
    const report=verifyCleanDatabase(target,options);
    if(output!==':memory:')target.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; VACUUM');
    return {db:target,report};
  }catch(error){target.close();throw error}
}

export function verifyCleanDatabase(db,{agencyId,keepUserIds}){
  assert(db.prepare('PRAGMA integrity_check').get().integrity_check==='ok','База повреждена');assert(db.prepare('PRAGMA foreign_key_check').all().length===0,'Нарушены связи');
  const counts=Object.fromEntries(tables(db).map(table=>[table,count(db,table)]));
  assert(counts.agencies===1&&counts.users===3,'Лишние агентства или аккаунты');
  const users=db.prepare('SELECT id,agency_id FROM users').all();assert(users.every(user=>user.agency_id===agencyId&&keepUserIds.includes(user.id)),'Остался лишний аккаунт');
  for(const [table,n]of Object.entries(counts))assert(allowedTables.has(table)||n===0,`Остались данные: ${table}`);
  const entities=db.prepare('SELECT project_id,parent_id,kind,deleted,data FROM entities').all();
  assert(entities.every(row=>row.project_id===null&&row.parent_id===null&&row.deleted===0&&definitionKinds.has(row.kind)),'Остались записи свадеб');
  const templates=entities.filter(row=>row.kind==='template').map(row=>JSON.parse(row.data));assert(templates.length>0&&templates.every(t=>t.taskBlueprints.every(task=>task.dueMode==='none'&&task.offsetDays===0)),'Шаблонные планы имеют сроки');
  return {counts,templates:templates.length,templateTasks:templates.reduce((n,t)=>n+t.taskBlueprints.length,0),questionnaireQuestions:questionnaireQuestions.length,emptyWorkspaces:3,credentialsPreserved:true,integrity:'ok',foreignKeys:'ok'};
}

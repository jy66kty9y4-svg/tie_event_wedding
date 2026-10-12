import {assert,entities,insert,uid} from './db.mjs';
import {canUseTeamTiming,requireAccess} from './auth.mjs';
import {text,validateColumns} from './model.mjs';
import {normalizeSheetLayout,GUEST_ACTIONS_COLUMN} from '../src/sheet.js';
import {coupleBudgetColumns,coupleBudgetViewGroups,coupleBudgetBaseColumns} from '../src/couple-budget.js';
import {financeSheetColumns,obligationSheetColumns} from '../src/finance-sheet.js';
import {DEFAULT_TASK_PHASES} from '../src/task-blueprints.js';
import {planData,tableData} from './v2/guest/index.mjs';
import {normalizeBudgetFormat} from '../src/budget-format.js';
import {micrositeDraft,createTemplateMicrosite} from './v2/publishing/index.mjs';

const clone=value=>structuredClone(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const ordered=rows=>[...rows].sort((a,b)=>(a.data.order||0)-(b.data.order||0));
export const templateColumns=columns=>{assert(Array.isArray(columns),'Проверьте колонки шаблона');return columns.map(column=>{assert(object(column),'Проверьте колонку шаблона');return Object.fromEntries(['id','name','type','options','formula','resultType','targetKind'].filter(key=>column[key]!==undefined).map(key=>[key,clone(column[key])]))})};
export function templateSemanticMap(table){
  const map=table.semanticMap;if(!map)return {};
  const keys=['guestName','rsvpStatus','diet','allergies','transfer','accommodation','contact','comment','invitationStatus','seatingTable','seatIndex','title','startTime','endTime','dayOffset','endDayOffset','required','assignedUserIds'];
  const clean=Object.fromEntries(keys.filter(key=>map[key]===null||typeof map[key]==='string'&&table.columns.some(c=>c.id===map[key])).map(key=>[key,map[key]]));
  if(map.rsvpValues){const column=table.columns.find(c=>c.id===clean.rsvpStatus);clean.rsvpValues=Object.fromEntries(Object.entries(map.rsvpValues).filter(([key,value])=>['unanswered','confirmed','declined','tentative'].includes(key)&&column?.options?.includes(value)))}
  return {semanticMap:clean};
}
function layout(value,columns,rows=[]){
  try{return normalizeSheetLayout(value||{},columns,rows)}catch(error){assert(false,error.message)}
}
export function templateTableSettings(table){
  return {...(table.sheetLayout?{sheetLayout:layout({columnWidths:table.sheetLayout.columnWidths},[...table.columns.map(c=>c.id),...(table.key==='guests'?[GUEST_ACTIONS_COLUMN]:[])])}:{}),...(table.automaticTimingStaffId&&table.columns.some(c=>c.id===table.automaticTimingStaffId&&c.type==='users')?{automaticTimingStaffId:table.automaticTimingStaffId}:{})};
}
// Only definitions are retained. In particular, no arbitrary object spread from a
// source wedding may introduce prices, identities, files or completed activity.
export function templateSettings(data){
  const result={};
  if(data.projectSettings!==undefined){
    const value=data.projectSettings;assert(object(value),'Проверьте настройки свадьбы');
    const zone=value.timeZone||'Europe/Moscow';try{new Intl.DateTimeFormat('ru',{timeZone:zone})}catch{assert(false,'Проверьте часовой пояс')}
    const readinessPolicy={};
    for(const [key,rule] of Object.entries(value.readinessPolicy||{})){
      assert(['contract','booking','timing','seating'].includes(key)&&object(rule)&&typeof rule.required==='boolean','Проверьте обязательность разделов');
      readinessPolicy[key]={required:rule.required,...(!rule.required?{reason:'Отключено в шаблоне'}:{})};
    }
    assert(value.personalInvitationsEnabled===undefined||typeof value.personalInvitationsEnabled==='boolean','Проверьте настройку приглашений');
    result.projectSettings={timeZone:zone,readinessPolicy,personalInvitationsEnabled:value.personalInvitationsEnabled===true};
  }
  if(data.budgetTemplate!==undefined){
    const value=data.budgetTemplate;assert(object(value),'Проверьте структуру сметы');
    const clean={extraItems:{},extraSections:[],names:{},organizerRows:{}};
    const item=value=>{assert(object(value)&&typeof value.row==='string'&&/^item_[a-zA-Z0-9_-]{1,90}$/.test(value.row),'Проверьте статью сметы');return {row:value.row,name:text(value.name,'Статья',1,200),note:'',organizer:value.organizer===true}};
    for(const [key,items] of Object.entries(value.extraItems||{})){assert(Array.isArray(items),'Проверьте статьи');clean.extraItems[key]=items.map(item)}
    assert(Array.isArray(value.extraSections||[]),'Проверьте разделы сметы');
    clean.extraSections=(value.extraSections||[]).map(section=>{assert(object(section)&&typeof section.row==='string'&&/^section_[a-zA-Z0-9_-]{1,90}$/.test(section.row)&&Array.isArray(section.items),'Проверьте раздел сметы');return {row:section.row,name:text(section.name,'Раздел',1,200),totalLabel:'Итого по разделу',items:section.items.map(item)}});
    const groups=coupleBudgetViewGroups(clean),rows=groups.flatMap(g=>[String(g.row),...g.items.map(i=>String(i.row))]),ids=new Set(rows);
    assert(groups.length<=30&&groups.reduce((n,g)=>n+g.items.length,0)<=500&&ids.size===rows.length,'Проверьте количество и ключи статей сметы');
    for(const [id,name] of Object.entries(value.names||{})){assert(ids.has(id),'Статья сметы не найдена');clean.names[id]=text(name,'Название статьи',1,200)}
    for(const [id,enabled] of Object.entries(value.organizerRows||{})){assert(ids.has(id)&&typeof enabled==='boolean','Проверьте бюджет организатора');clean.organizerRows[id]=enabled}
    const columns=templateColumns(coupleBudgetColumns(value,true));validateColumns(columns);
    assert(columns.every(c=>coupleBudgetBaseColumns.some(base=>base.id===c.id)||['text','select','money','number','date','time','boolean','url','formula'].includes(c.type)),'Проверьте колонки сметы');
    assert(Array.isArray(value.hiddenColumns||[])&&(value.hiddenColumns||[]).every(id=>columns.some(c=>c.id===id))&&!(value.hiddenColumns||[]).includes('name'),'Проверьте скрытые колонки');
    assert(Array.isArray(value.deletedRows||[])&&(value.deletedRows||[]).every(id=>ids.has(String(id))),'Проверьте удалённые статьи');
    Object.assign(clean,{extraColumns:columns.filter(c=>!coupleBudgetBaseColumns.some(base=>base.id===c.id)),columnLabels:Object.fromEntries(columns.map(c=>[c.id,c.name])),columnOrder:columns.map(c=>c.id),hiddenColumns:clone(value.hiddenColumns||[]),deletedRows:clone(value.deletedRows||[]),sheetLayout:layout(value.sheetLayout,columns.map(c=>c.id),rows),cellFormats:{}});
    for(const [field,formats] of Object.entries(value.cellFormats||{}))if(columns.some(c=>c.id===field))for(const [id,format] of Object.entries(formats||{}))if(ids.has(id)&&format?.style){let normalized;try{normalized=normalizeBudgetFormat({style:format.style},'',false)}catch(error){assert(false,error.message)}if(normalized){clean.cellFormats[field]||={};clean.cellFormats[field][id]=normalized}}
    result.budgetTemplate=clean;
  }
  if(data.financeTemplate!==undefined){
    const value=data.financeTemplate;assert(object(value),'Проверьте реестр выплат');const clean={name:'Движение средств пары'};
    for(const [key,base,layoutKey] of [['columns',financeSheetColumns(false),'sheetLayout'],['obligationColumns',obligationSheetColumns(),'obligationLayout']]){
      const columns=templateColumns(value[key]||base).map(column=>({...column,...(base.find(c=>c.id===column.id)||{}),name:column.name}));validateColumns(columns);
      assert(base.every(c=>columns.some(v=>v.id===c.id&&v.type===c.type)),'Служебные колонки выплат нужно сохранять');
      const hiddenKey=key==='columns'?'hiddenColumns':'obligationHiddenColumns',hidden=value[hiddenKey]||[];
      assert(Array.isArray(hidden)&&hidden.every(id=>columns.some(c=>c.id===id))&&!hidden.includes(key==='columns'?'description':'title'),'Проверьте скрытые колонки выплат');
      clean[key]=columns;clean[hiddenKey]=clone(hidden);clean[layoutKey]=layout({columnWidths:value[layoutKey]?.columnWidths},columns.map(c=>c.id));
    }
    result.financeTemplate=clean;
  }
  if(data.seatingTemplate!==undefined){
    assert(Array.isArray(data.seatingTemplate)&&data.seatingTemplate.length<=30,'Проверьте планы зала');
    result.seatingTemplate=data.seatingTemplate.map(item=>{
      assert(object(item)&&typeof item.guestTableKey==='string'&&Array.isArray(item.tables)&&item.tables.length<=200,'Проверьте план рассадки');
      const plan=planData({...item.plan,guestTableId:null});
      const tables=item.tables.map(d=>tableData(d,{data:plan}));assert(new Set(tables.map(t=>t.label)).size===tables.length,'Повторяются названия столов');
      return {guestTableKey:item.guestTableKey,plan,tables};
    });
  }
  if(data.siteTemplate!==undefined){
    const value=data.siteTemplate;assert(object(value),'Проверьте настройки сайта');
    const draft=micrositeDraft({template:value.template,mealEnabled:value.mealEnabled,transportEnabled:value.transportEnabled,blocks:value.blocks});
    result.siteTemplate={template:draft.template,mealEnabled:draft.mealEnabled,transportEnabled:draft.transportEnabled,blocks:draft.blocks};
  }
  return result;
}

export function weddingTemplate(db,u,project,name){
  assert(canUseTeamTiming(db,u,project.id),'Шаблоны из свадеб доступны организаторам',403);
  requireAccess(db,u,['read','structure'],project.id,null,null,null);
  requireAccess(db,u,['create','templates'],null,'template',null,null);
  const rows=entities(db,u.agency_id,project.id),sections=ordered(rows.filter(r=>r.kind==='section'&&!r.data.archived)),keys=new Map(sections.map((s,i)=>[s.id,`section_${i+1}`]));
  const tables=ordered(rows.filter(r=>r.kind==='table'&&!r.data.archived&&keys.has(r.data.sectionId)));
  for(const row of [...sections,...tables])requireAccess(db,u,'read',project.id,row.kind==='table'?row.id:'structure',row.id,null);
  const used=new Set(),tableKey=table=>{let key=table.data.key||'table',n=2;while(used.has(key))key=`${table.data.key||'table'}_${n++}`;used.add(key);return key};
  const tableKeys=new Map(tables.map(table=>[table.id,tableKey(table)]));
  const tasks=ordered(rows.filter(r=>r.kind==='task')),taskKeys=new Map(tasks.map((task,i)=>[task.id,`task_${uid()}`]));
  if(tasks.length)requireAccess(db,u,'read',project.id,'tasks',null,null);
  const taskPhases=clone(project.data.taskPhases||DEFAULT_TASK_PHASES);
  for(const task of tasks){const key=task.data.phaseKey||'general';if(!taskPhases.some(p=>p.key===key))taskPhases.push({key,name:key==='general'?'Общее':key==='plan'?'Планирование':key})}
  const budget=rows.find(r=>r.kind==='coupleBudget'),finance=rows.find(r=>r.kind==='financeSheet');
  if(budget||finance)requireAccess(db,u,['read','finance'],project.id,'budget',null,null);
  const categories=rows.filter(r=>r.kind==='category'&&!r.data.archived);if(categories.length)requireAccess(db,u,['read','finance'],project.id,'budget',null,null);
  const plans=rows.filter(r=>r.kind==='seatingPlan');if(plans.length)requireAccess(db,u,'read',project.id,'seating',null,null);
  const site=rows.find(r=>r.kind==='microsite');if(site)requireAccess(db,u,'read',project.id,'microsite',site.id,null);
  requireAccess(db,u,'read',project.id,'project',project.id,['timeZone','readinessPolicy','personalInvitationsEnabled','offline']);
  for(const task of tasks)requireAccess(db,u,'read',project.id,'tasks',task.id,null);
  return {
    name:text(name,'Название шаблона'),sections:sections.map(s=>({key:keys.get(s.id),name:s.data.name,order:s.data.order})),
    tables:tables.map(t=>({key:tableKeys.get(t.id),name:t.data.name,section:keys.get(t.data.sectionId),columns:templateColumns(t.data.columns),offline:!!t.data.offline,...templateSemanticMap(t.data),...templateTableSettings(t.data)})),
    categories:categories.map(r=>r.data.name),offline:(project.data.offline||[]).filter(key=>['payouts','budget','vendors','files'].includes(key)),taskPhases,
    taskBlueprints:tasks.map(task=>{const d=task.data;let offsetDays=d.dueMode==='relative'?d.offsetDays:null;if(offsetDays==null&&d.dueDate&&project.data.date)offsetDays=Math.round((Date.parse(d.dueDate+'T12:00Z')-Date.parse(project.data.date+'T12:00Z'))/86400000);return {key:taskKeys.get(task.id),title:d.title,phaseKey:d.phaseKey||'general',dueMode:Number.isInteger(offsetDays)?'relative':'none',offsetDays:Number.isInteger(offsetDays)?offsetDays:0,priority:d.priority||'normal',order:d.order||0,dependencyKeys:(d.dependencyIds||[]).map(id=>taskKeys.get(id)).filter(Boolean)}}),
    ...templateSettings({projectSettings:project.data,...(budget?{budgetTemplate:budget.data}:{}),...(finance?{financeTemplate:finance.data}:{}),...(site?{siteTemplate:site.data.draft}:{}),seatingTemplate:plans.filter(p=>!p.data.guestTableId||tableKeys.has(p.data.guestTableId)).map(p=>({guestTableKey:tableKeys.get(p.data.guestTableId)||tables.find(t=>t.data.key==='guests')?.data.key||'',plan:{...p.data,zones:(p.data.zones||[]).map(zone=>({...zone,id:uid()}))},tables:rows.filter(t=>t.kind==='seatingTable'&&t.parent_id===p.id).map(t=>t.data)}))})
  };
}

export function applyTemplateSettings(db,u,project,tpl){
  if(tpl.budgetTemplate)insert(db,u,'coupleBudget',clone(tpl.budgetTemplate),project.id);
  if(tpl.financeTemplate)insert(db,u,'financeSheet',clone(tpl.financeTemplate),project.id);
  const tables=entities(db,u.agency_id,project.id,'table');
  for(const item of tpl.seatingTemplate||[]){
    const guest=tables.find(t=>t.data.key===item.guestTableKey);assert(guest||!item.guestTableKey,'Реестр гостей шаблона не найден');
    const plan=insert(db,u,'seatingPlan',{...clone(item.plan),guestTableId:guest?.id||null,zones:item.plan.zones.map(zone=>({...zone,id:uid()}))},project.id);
    for(const table of item.tables)insert(db,u,'seatingTable',clone(table),project.id,plan.id);
  }
  if(tpl.siteTemplate&&project.data.personalInvitationsEnabled===true)createTemplateMicrosite(db,u,project,tpl.siteTemplate);
}

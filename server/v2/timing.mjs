import { assert, change, entities, version } from '../db.mjs';
import { requireAccess } from '../auth.mjs';
import { validateColumns } from '../model.mjs';
import { executeModule, projectAccess, scoped } from './common.mjs';

const TYPES={title:'text',startTime:'time',endTime:'time',dayOffset:'number',endDayOffset:'number',required:'boolean',assignedUserIds:'users'};
const KEYS=Object.keys(TYPES);
const REQUIRED=new Set(['title','startTime']);
const CREATABLE=new Set(['dayOffset','endDayOffset','required','assignedUserIds']);
const DEFAULTS={
 dayOffset:{id:'timing_day_offset',name:'День от даты свадьбы',type:'number'},
 endDayOffset:{id:'timing_end_day_offset',name:'День окончания',type:'number'},
 required:{id:'timing_required',name:'Обязательный пункт',type:'boolean'},
 assignedUserIds:{id:'timing_assigned_users',name:'Участники проекта',type:'users'}
};

const mapping=table=>table?.data?.semanticMap||{};
const columns=table=>table?.data?.columns||[];
const column=(table,id)=>columns(table).find(item=>item.id===id);
function timingTable(db,u,c){const table=scoped(db,u,c.tableId||c.entityId,c.projectId,'table');assert(table.data.key==='timing','Выберите таблицу тайминга',409);return table;}
function compatible(table,key,id){return !!id&&column(table,id)?.type===TYPES[key];}
function uniqueId(existing,base){let id=base,n=2;while(existing.has(id))id=`${base}_${n++}`;existing.add(id);return id;}
function validateMap(table,map){assert(map&&typeof map==='object'&&!Array.isArray(map),'Передайте сопоставление тайминга');assert(Object.keys(map).every(key=>KEYS.includes(key)),'Неизвестное смысловое поле тайминга');for(const key of REQUIRED)assert(typeof map[key]==='string'&&map[key],'Укажите название и время начала');const ids=[];for(const key of KEYS){const id=map[key];if(id===undefined||id===null||id==='')continue;assert(typeof id==='string'&&compatible(table,key,id),`Поле «${key}» имеет неверный тип или удалено`,409,{code:'timingMappingType',semantic:key,columnId:id,expectedType:TYPES[key]});ids.push(id);}assert(new Set(ids).size===ids.length,'Одну колонку нельзя использовать для разных полей тайминга',409);return map;}

export function validateTimingSchemaMutation(before,after,{confirm=false,disabled=[]}={}){
 if(before?.data?.key!=='timing')return {ok:true};
 const old=mapping(before),next=mapping(after),disabledKeys=new Set(Array.isArray(disabled)?disabled:[]),impacts=[];
 for(const [key,id] of Object.entries(next))if(!KEYS.includes(key)||!compatible(after,key,id))return {ok:false,code:'timingMappingType',impacts:[{semantic:key,columnId:id,expectedType:TYPES[key]||null}]};
 if(!Object.keys(old).length)return Object.keys(next).length&&!confirm?{ok:false,code:'timingMappingRebindRequired',impacts:Object.entries(next).map(([semantic,columnId])=>({semantic,columnId,expectedType:TYPES[semantic]}))}:{ok:true};
 for(const key of KEYS){const oldId=old[key];if(!oldId)continue;const nextId=next[key];const changed=oldId!==nextId||!compatible(after,key,nextId);if(!changed)continue;impacts.push({semantic:key,columnId:oldId,expectedType:TYPES[key]});const rebound=compatible(after,key,nextId);const explicitlyDisabled=!nextId&&disabledKeys.has(key)&&!REQUIRED.has(key);if(!confirm||(!rebound&&!explicitlyDisabled))return {ok:false,code:'timingMappingRebindRequired',impacts};}
 return {ok:true,impacts};
}

function authorizeConfigure(db,u,c){const table=timingTable(db,u,c);projectAccess(db,u,c.projectId,'structure',table.id,table.id);requireAccess(db,u,['read','edit','structure'],c.projectId,table.id,table.id,null);}
function configure(db,u,c){
 const table=timingTable(db,u,c);version(table,c.schemaVersion);const source=c.data||{},input=source.semanticMap;assert(input&&typeof input==='object'&&!Array.isArray(input),'Передайте сопоставление тайминга');
 const createMissing=source.createMissing||[];assert(Array.isArray(createMissing)&&new Set(createMissing).size===createMissing.length&&createMissing.every(key=>CREATABLE.has(key)),'Можно создать только дополнительные поля тайминга');
 let nextColumns=structuredClone(columns(table));const existing=new Set(nextColumns.map(item=>item.id)),nextMap={};
 for(const key of KEYS){if(typeof input[key]==='string'&&input[key])nextMap[key]=input[key];else if(createMissing.includes(key)){const spec=DEFAULTS[key],id=uniqueId(existing,spec.id);nextColumns.push({...spec,id});nextMap[key]=id;}}
 const candidate={...table,data:{...table.data,columns:nextColumns,semanticMap:nextMap}};validateColumns(nextColumns);validateMap(candidate,nextMap);
 const disabled=KEYS.filter(key=>mapping(table)[key]&&!nextMap[key]);const guard=validateTimingSchemaMutation(table,candidate,{confirm:!Object.keys(mapping(table)).length||c.confirm===true,disabled});assert(guard.ok,'Изменение подключённого поля требует явной перепривязки',409,guard);
 const saved=change(db,u,table,candidate.data,false,'timingConfigure');
 for(const site of entities(db,u.agency_id,c.projectId,'microsite'))if(site.data.status==='published'&&!site.data.dirty)change(db,u,site,{...site.data,dirty:true},false,'timingSchemaChanged');
 return saved;
}

export const operations={'timing.configure':{authorize:authorizeConfigure,run:configure}};
export const execute=(db,user,command)=>executeModule(db,user,command,operations);

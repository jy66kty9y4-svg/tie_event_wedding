import { assert, entity, entities, insert, uid } from './db.mjs';
import { can, requireAccess } from './auth.mjs';
import { compute, fieldTypes } from '../src/shared.js';

export function text(v, label='Название', min=1, max=240) { assert(typeof v==='string' && v.trim().length>=min && v.length<=max, `${label}: от ${min} до ${max} символов`); return v.trim(); }
export function amount(v, nullable=false) { if (nullable && v === null) return null; assert(Number.isSafeInteger(v) && v>=0 && v<=1e12,'Сумма должна быть в целых копейках, от 0 до 10 млрд ₽'); return v; }
export function date(v, optional=true) { if (optional && !v) return ''; assert(typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v,'Проверьте дату'); return v; }
export function safeUrl(v) { assert(!v || /^https?:\/\//.test(v),'Ссылка должна начинаться с https:// или http://'); return v || ''; }
export function getScoped(db,u,id,p=undefined,kind=undefined) {
  const row=entity(db,id); assert(row && row.agency_id===u.agency_id && (p===undefined || row.project_id===p) && (!kind || row.kind===kind),'Запись не найдена',404); return row;
}
export function sectionOf(row) { return ({obligation:'budget',movement:'budget',selection:'vendors',file:'files',task:'tasks',approval:'approvals',approvalRevision:'approvals',meeting:'calendar',seatingPlan:'seating',seatingTable:'seating',microsite:'microsite',micrositeRevision:'microsite'})[row.kind] || (row.kind==='row'?row.parent_id:row.kind==='table'?row.id:row.kind==='section'?'structure':row.kind); }
export function accessRowId(row) { return row.kind==='movement' && row.data.obligationId ? row.data.obligationId : row.id; }
export function projectVisible(db,u,id) {
  const p=entity(db,id); if (!p || p.agency_id!==u.agency_id || p.deleted) return false;
  if (u.protected || can(db,u,'read',id)) return true;
  return db.prepare('SELECT g.*,r.permissions FROM grants g JOIN roles r ON g.role_id=r.id WHERE g.agency_id=? AND r.agency_id=? AND g.user_id=? AND (g.project_id=? OR g.project_id IS NULL)').all(u.agency_id,u.agency_id,u.id,id).some(g=>JSON.parse(g.permissions).includes('read'));
}
export const initialTemplate = () => ({name:'Свадьба — основной',sections:[
  {key:'preparation',name:'Подготовка',order:0},{key:'day',name:'День свадьбы',order:1},{key:'people',name:'Гости и материалы',order:2}
], tables:[
  {key:'timing',name:'Тайминг',section:'day',offline:true,columns:[{id:'time',name:'Начало',type:'time'},{id:'end',name:'Окончание',type:'time'},{id:'title',name:'Событие',type:'text'},{id:'place',name:'Место',type:'text'},{id:'audience',name:'Для кого',type:'select',options:['Общее','Пара','Команда']},{id:'people',name:'Участники',type:'text'},{id:'responsible',name:'Ответственный',type:'text'},{id:'done',name:'Выполнено',type:'boolean'}]},
  {key:'guests',name:'Гости',section:'people',offline:false,columns:[{id:'name',name:'Имя гостя',type:'text'},{id:'side',name:'Сторона',type:'select',options:['Жених','Невеста','Общие']},{id:'status',name:'Приглашение',type:'select',options:['Не отправлено','Приглашён','Подтвердил','Отказ']},{id:'contact',name:'Контакт',type:'text'},{id:'meal',name:'Питание',type:'text'},{id:'day2',name:'Второй день',type:'boolean'},{id:'hotel',name:'Проживание',type:'text'},{id:'transport',name:'Транспорт',type:'text'},{id:'table',name:'Стол',type:'text'},{id:'note',name:'Комментарий',type:'text'}]},
  {key:'materials',name:'Заметки и материалы',section:'people',offline:false,columns:[{id:'title',name:'Название',type:'text'},{id:'note',name:'Описание',type:'text'},{id:'link',name:'Ссылка',type:'url'},{id:'file',name:'Файл',type:'file'}]}
], offline:['timing','payouts'], categories:['Площадка','Банкет','Фото и видео','Декор','Образ','Команда','Гонорар агентства']});

export function createProject(db,u,data,template=null) {
  const tpl=template?.data || entities(db,u.agency_id,null,'template')[0]?.data || initialTemplate();
  const templateOffline=Array.isArray(tpl.offline)?tpl.offline:[];
  const nativeOffline=templateOffline.filter(key=>['payouts','budget','vendors','files'].includes(key));
  const p=insert(db,u,'project',{name:text(data.name),date:date(data.date,false),location:data.location?text(data.location,'Место',1,1000):'',status:'planning',timeZone:'Europe/Moscow',readinessPolicy:{},limit:amount(data.limit??null,true),offline:nativeOffline,notes:data.notes?text(data.notes,'Заметка',1,8000):''});
  const sections={}; for(const s of tpl.sections) sections[s.key]=insert(db,u,'section',{name:s.name,order:s.order,archived:false},p.id).id;
  for(const t of tpl.tables) insert(db,u,'table',{name:t.name,key:t.key,sectionId:sections[t.section]||Object.values(sections)[0],order:tpl.tables.indexOf(t),archived:false,offline:!!t.offline||templateOffline.includes(t.key),columns:structuredClone(t.columns),rowOrder:[]},p.id);
  for(const name of tpl.categories||[]) insert(db,u,'category',{name,scope:'wedding',archived:false},p.id);
  // Clone structure only. No source rows, files, guests or paid movements.
  return p;
}
export function validateColumns(columns) {
  assert(Array.isArray(columns) && columns.length<=80,'Не более 80 колонок'); const ids=new Set();
  for(const c of columns) {
    assert(/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) && !['__proto__','constructor','prototype'].includes(c.id) && !ids.has(c.id),'У каждой колонки должен быть уникальный ID'); ids.add(c.id); text(c.name); assert(fieldTypes[c.type],'Неизвестный тип поля');
    if(c.type==='select') assert(Array.isArray(c.options) && c.options.length<=100 && c.options.every(x=>typeof x==='string'&&x.length<=120),'Проверьте варианты выбора');
    if(c.type==='relation') assert(!c.targetKind||['row','seatingTable'].includes(c.targetKind),'Недопустимый тип связи');
    if(c.type==='formula') { text(c.formula,'Формула',1,500); compute(c.formula,{}); }
  }
  for(const c of columns.filter(c=>c.type==='formula')) for(const ref of c.formula.matchAll(/\{([^}]+)\}/g)) assert(ids.has(ref[1]) && columns.find(x=>x.id===ref[1]).type!=='formula','Формула ссылается на отсутствующую или вычисляемую колонку');
  return columns;
}
export function validateRow(db,u,table,values,changedKeys=Object.keys(values)) {
  assert(values && typeof values==='object' && !Array.isArray(values),'Проверьте значения');
  for(const k of changedKeys) {
    const c=table.data.columns.find(c=>c.id===k); assert(c,'Колонка удалена или изменилась. Обновите структуру.',409,{table});
    const v=values[k]; if(v===null || v==='') continue;
    if(c.type==='text') assert(typeof v==='string' && v.length<=8000,'Текст: не более 8000 символов');
    if(c.type==='number') assert(typeof v==='number' && Number.isFinite(v),'Введите число');
    if(c.type==='money') amount(v);
    if(c.type==='date') date(v,false);
    if(c.type==='time') assert(typeof v==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),'Время: ЧЧ:ММ');
    if(c.type==='boolean') assert(typeof v==='boolean','Требуется флажок');
    if(c.type==='select') assert(c.options.includes(v),'Выберите вариант из списка');
    if(c.type==='url') safeUrl(v);
    if(c.type==='formula') assert(false,'Вычисляемая колонка не редактируется');
    if(c.type==='relation' || c.type==='file') { const target=getScoped(db,u,v,table.project_id,c.type==='file'?'file':c.targetKind==='seatingTable'?'seatingTable':'row'); assert(!target.deleted,'Связанная запись удалена'); requireAccess(db,u,c.type==='file'?['read','files']:['read'],table.project_id,sectionOf(target),target.id); }
  }
}
export function financials(rows) {
  const obs=rows.filter(r=>r.kind==='obligation'&&!r.deleted), moves=rows.filter(r=>r.kind==='movement'&&!r.deleted);
  const paid={}, holders={}, byCategory={}, incomeByCategory={}, expenseByCategory={}; let agreed=0,planned=0,unknown=0,income=0,expense=0;
  for(const r of moves) {
    const m=r.data, a=m.amount;
    if(['payment','fee'].includes(m.type)) paid[m.obligationId]=(paid[m.obligationId]||0)+a;
    if(m.type==='deposit') holders[m.to]=(holders[m.to]||0)+a;
    if(['payment','fee','refund'].includes(m.type)&&m.source==='custody') holders[m.from]=(holders[m.from]||0)-a;
    if(m.type==='transfer') { holders[m.from]=(holders[m.from]||0)-a; holders[m.to]=(holders[m.to]||0)+a; }
    if(['fee','income'].includes(m.type)) { income+=a; if(m.categoryId) incomeByCategory[m.categoryId]=(incomeByCategory[m.categoryId]||0)+a; }
    if(m.type==='expense') { expense+=a; if(m.categoryId) expenseByCategory[m.categoryId]=(expenseByCategory[m.categoryId]||0)+a; }
  }
  for(const o of obs) { const d=o.data; if(d.priceKind==='unknown') unknown++; agreed+=d.priceKind==='amount'?d.agreed:0; planned+=d.planned||0; byCategory[d.categoryId]=(byCategory[d.categoryId]||0)+(d.agreed||0); }
  const totalPaid=Object.values(paid).reduce((a,b)=>a+b,0);
  return {agreed,planned,unknown,paid,totalPaid,due:agreed-totalPaid,holders,custody:Object.values(holders).reduce((a,b)=>a+b,0),income,expense,own:income-expense,byCategory,incomeByCategory,expenseByCategory};
}
export function validateLedger(rows) {
  const f=financials(rows);
  assert(Object.values(f.holders).every(v=>v>=0),'Недостаточно средств пары у выбранного организатора. Сначала исправьте связанные выплаты или поступления.',409);
  for(const m of rows.filter(r=>r.kind==='movement'&&!r.deleted&&['payment','fee'].includes(r.data.type))) {
    const o=rows.find(o=>o.id===m.data.obligationId&&!o.deleted); assert(o,'У выплаты должно быть действующее обязательство',409);
    assert(o.data.priceKind==='amount' && f.paid[o.id]<=o.data.agreed,'Оплата превышает согласованную стоимость. Проверьте сумму и историю.',409);
    assert((m.data.type==='fee')===!!o.data.fee,'Тип выплаты не соответствует обязательству');
  }
  return f;
}

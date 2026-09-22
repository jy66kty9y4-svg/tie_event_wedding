import {compute,movementLabels} from './shared.js';
import {downloadXlsx} from './xlsx.js';

const dataOf=item=>item?.data||item||{};
const entities=state=>(state?.entities||[]).filter(item=>!item.deleted);
const clean=value=>String(value||'экспорт').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim();
const projectName=state=>dataOf(state?.project).name||'Свадьба';
const ordered=(rows,rowOrder=[])=>{const positions=new Map(rowOrder.map((id,index)=>[id,index]));return [...rows].sort((a,b)=>(positions.get(a.id)??Number.MAX_SAFE_INTEGER)-(positions.get(b.id)??Number.MAX_SAFE_INTEGER));};
const memberName=(members,id)=>members.find(member=>member.id===id)?.name||id||'';

const tableValue=(row,column,{relationRows=[],files=[],members=[]})=>{
  const value=row.data?.[column.id];
  if(column.type==='formula')return compute(column.formula||'',row.data||{});
  if(column.type==='relation')return dataOf(relationRows.find(item=>item.id===value)).label||dataOf(relationRows.find(item=>item.id===value)).title||dataOf(relationRows.find(item=>item.id===value)).name||'';
  if(column.type==='file')return dataOf(files.find(item=>item.id===value)).name||'';
  if(column.type==='users')return Array.isArray(value)?value.map(id=>memberName(members,id)).join(', '):memberName(members,value);
  return value;
};

export function tableWorkbook({project,table,rows=[],relationRows=[],files=[],members=[],audience,title}){
  const data=dataOf(table),columns=data.columns||[],visible=ordered(rows,data.rowOrder||[]).filter(row=>!audience||!row.data?.audience||row.data.audience==='Общее'||row.data.audience===audience);
  return {sheets:[{name:title||data.name||'Таблица',title:`${project||'Свадьба'} — ${title||data.name||'таблица'}`,columns:columns.map(column=>({key:column.id,label:column.name,type:column.type==='formula'?'number':column.type,width:['text','url'].includes(column.type)?24:column.type==='file'?22:16})),rows:visible.map(row=>Object.fromEntries(columns.map(column=>[column.id,tableValue(row,column,{relationRows,files,members})])))}]};
}

export function downloadTableXlsx(options){
  const title=options.title||dataOf(options.table).name||'таблица',fileName=options.fileName||`${options.project||'Свадьба'} — ${title}`;
  return downloadXlsx(tableWorkbook(options),clean(fileName));
}

export function downloadGuestsXlsx(state){
  const all=entities(state),table=all.find(item=>item.kind==='table'&&item.data?.key==='guests'),rows=all.filter(item=>item.kind==='row'&&item.parent_id===table?.id),members=state.assignableMembers||state.members||[];
  if(!table)throw new Error('Реестр гостей не найден.');
  return downloadTableXlsx({project:projectName(state),table,rows,relationRows:all.filter(item=>['row','seatingTable'].includes(item.kind)),files:all.filter(item=>item.kind==='file'),members,title:'Гости',fileName:`${projectName(state)} — гости`});
}

export function budgetWorkbook(state){
  const all=entities(state),financials=state.financials||{},obligations=all.filter(item=>item.kind==='obligation'),movements=all.filter(item=>item.kind==='movement'),categories=all.filter(item=>item.kind==='category'),members=state.assignableMembers||state.members||state.custodians||[],categoryName=id=>dataOf(categories.find(item=>item.id===id)).name||'Без категории';
  const estimateColumns=[{key:'title',label:'Статья',width:28},{key:'category',label:'Категория',width:20},{key:'priceStatus',label:'Статус цены',width:18},{key:'agreed',label:'Стоимость для пары',type:'money',width:18},{key:'planned',label:'Плановая стоимость',type:'money',width:18},...(state.canViewAgencyCommission?[{key:'commission',label:'Агентская комиссия',type:'money',width:18}]:[]),{key:'paid',label:'Оплачено',type:'money',width:16},{key:'due',label:'Осталось',type:'money',width:16},{key:'dueDate',label:'Срок',type:'date',width:14},{key:'condition',label:'Условие оплаты',width:28},{key:'responsible',label:'Ответственный',width:20}];
  const estimateRows=obligations.map(item=>{const data=item.data,paid=data.paid??financials.paid?.[item.id]??0;return {title:data.title,category:categoryName(data.categoryId),priceStatus:data.priceKind==='amount'?'Согласовано':data.priceKind==='included'?'Включено в другую услугу':'Цена неизвестна',agreed:data.agreed,planned:data.planned,commission:data.agencyCommission,paid,due:data.due??Math.max(0,(data.agreed||0)-paid),dueDate:data.dueDate,condition:data.condition,responsible:memberName(members,data.responsible)}});
  const movementColumns=[{key:'date',label:'Дата',type:'date',width:14},{key:'type',label:'Тип',width:22},{key:'description',label:'Описание',width:32},{key:'amount',label:'Сумма',type:'money',width:16},{key:'source',label:'Источник',width:24},{key:'category',label:'Категория',width:20},{key:'counterparty',label:'Контрагент',width:22},{key:'method',label:'Способ оплаты',width:18}];
  const movementRows=movements.map(item=>{const data=item.data;return {date:data.date,type:movementLabels[data.type]||data.type,description:data.description,amount:data.amount,source:data.source==='custody'?'Средства пары у организатора':'Прямая оплата',category:categoryName(data.categoryId),counterparty:data.counterparty,method:data.method}});
  return {sheets:[{name:'Смета',title:`${projectName(state)} — смета`,columns:estimateColumns,rows:estimateRows},{name:'Движения',title:`${projectName(state)} — движение средств`,columns:movementColumns,rows:movementRows}]};
}

export function downloadBudgetXlsx(state){
  return downloadXlsx(budgetWorkbook(state),clean(`${projectName(state)} — бюджет`));
}

export function seatingWorkbook(state){
  const all=entities(state),guestTable=all.find(item=>item.kind==='table'&&item.data?.key==='guests'),map=guestTable?.data?.semanticMap||{},guests=all.filter(item=>item.kind==='row'&&item.parent_id===guestTable?.id),plan=all.find(item=>item.kind==='seatingPlan'),tables=all.filter(item=>item.kind==='seatingTable'&&item.parent_id===plan?.id),tableName=id=>dataOf(tables.find(item=>item.id===id)).label||'Без места',rsvpText=value=>{for(const [key,label] of Object.entries({unanswered:'Нет ответа',confirmed:'Подтвердил',declined:'Отказ',tentative:'Пока не знает'}))if(map.rsvpValues?.[key]===value)return label;return value||'Нет ответа'};
  const guestRows=guests.map(guest=>({name:guest.data[map.guestName]||'',rsvp:rsvpText(guest.data[map.rsvpStatus]),table:tableName(guest.data[map.seatingTable]),seat:guest.data[map.seatIndex]||null})).sort((a,b)=>a.table.localeCompare(b.table,'ru')||Number(a.seat||999)-Number(b.seat||999)||a.name.localeCompare(b.name,'ru'));
  const tableRows=tables.map(table=>{const occupied=guests.filter(guest=>guest.data[map.seatingTable]===table.id).length;return {label:table.data.label,shape:({round150:'Круглый 150 см',round:'Круглый 180 см',rect:'Прямоугольный 180 × 90 см',snakeQuarter:'Змейка ¼ круга',square:'Квадратный',oval:'Овальный',custom:'Своя форма'})[table.data.shape]||table.data.shape,capacity:table.data.capacity,occupied,free:Math.max(0,Number(table.data.capacity||0)-occupied),x:table.data.xM,y:table.data.yM,width:table.data.widthM,height:table.data.heightM,rotation:table.data.rotationDeg||0}});
  return {sheets:[{name:'Рассадка гостей',title:`${projectName(state)} — рассадка гостей`,columns:[{key:'name',label:'Гость',width:28},{key:'rsvp',label:'Ответ',width:18},{key:'table',label:'Стол',width:20},{key:'seat',label:'Место',type:'number',width:12}],rows:guestRows},{name:'Столы',title:`${projectName(state)} — столы`,columns:[{key:'label',label:'Стол',width:20},{key:'shape',label:'Форма',width:18},{key:'capacity',label:'Вместимость',type:'number',width:14},{key:'occupied',label:'Занято',type:'number',width:12},{key:'free',label:'Свободно',type:'number',width:12},{key:'x',label:'X, м',type:'number',width:10},{key:'y',label:'Y, м',type:'number',width:10},{key:'width',label:'Ширина, м',type:'number',width:12},{key:'height',label:'Высота, м',type:'number',width:12},{key:'rotation',label:'Поворот, °',type:'number',width:12}],rows:tableRows}]};
}

export function downloadSeatingXlsx(state){
  return downloadXlsx(seatingWorkbook(state),clean(`${projectName(state)} — рассадка`));
}

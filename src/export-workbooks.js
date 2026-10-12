import {financialColumnsForState,financeSheetColumns,obligationSheetColumns,obligationColumnsForState} from './finance-sheet.js';
import {coupleBudgetColumns,coupleBudgetTotals,coupleBudgetRemaining,coupleBudgetOrganizerIncluded} from './couple-budget.js';
import {compute} from './shared.js';
import {downloadXlsx} from './xlsx.js';
function downloadExport(project,kind,table,audience){const params=new URLSearchParams({project,kind});if(table)params.set('table',table);if(audience)params.set('audience',audience);const link=document.createElement('a');link.href=`/api/export.xlsx?${params}`;link.download='';document.body.appendChild(link);link.click();link.remove();}

export const excelColumn=index=>{let number=index+1,name='';while(number){number--;name=String.fromCharCode(65+number%26)+name;number=Math.floor(number/26)}return name};
const styledCell=(value,format,type,formula)=>({_sheetCell:true,value,format,type,formula});
export function excelFormula(column,columns,row){
  const dependencies=[...String(column.formula||'').matchAll(/\{([^}]+)\}/g)].map(match=>match[1]);
  compute(column.formula||'',{});
  if(dependencies.some(id=>!columns.some(c=>c.id===id)))return null;
  const ref=id=>`${excelColumn(columns.findIndex(c=>c.id===id))}${row}`;
  const expr=column.formula.replace(/\{([^}]+)\}/g,(_match,id)=>columns.find(c=>c.id===id)?.type==='money'?`(${ref(id)}*100)`:ref(id));
  const value=column.resultType==='money'?`(${expr})/100`:expr;
  const guard=dependencies.length?`IF(AND(${dependencies.map(id=>`ISNUMBER(${ref(id)})`).join(',')}),${value},\"\")`:value;
  return `IFERROR(${guard},\"\")`;
}
const dataOf=item=>item?.data||item||{};
const entities=state=>(state?.entities||[]).filter(item=>!item.deleted);
const clean=value=>String(value||'экспорт').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim();
const projectName=state=>dataOf(state?.project).name||'Свадьба';
const ordered=(rows,rowOrder=[])=>{const positions=new Map(rowOrder.map((id,index)=>[id,index]));return [...rows].sort((a,b)=>(positions.get(a.id)??Number.MAX_SAFE_INTEGER)-(positions.get(b.id)??Number.MAX_SAFE_INTEGER)||(a.sheetOrder??0)-(b.sheetOrder??0));};
const memberName=(members,id)=>members.find(member=>member.id===id)?.name||id||'';

const tableValue=(row,column,{relationRows=[],files=[],members=[]})=>{
  const value=row.data?.[column.id];
  if(column.type==='select'&&column.optionLabels)return column.optionLabels[value]||value;
  if(column.type==='formula')return compute(column.formula||'',row.data||{});
  if(column.type==='relation')return dataOf(relationRows.find(item=>item.id===value)).label||dataOf(relationRows.find(item=>item.id===value)).title||dataOf(relationRows.find(item=>item.id===value)).name||'';
  if(column.type==='file')return dataOf(files.find(item=>item.id===value)).name||'';
  if(column.type==='users')return Array.isArray(value)?value.map(id=>memberName(members,id)).join(', '):memberName(members,value);
  return value;
};

export function tableWorkbook({project,table,rows=[],relationRows=[],files=[],members=[],audience,title}){
  const data=dataOf(table),columns=data.columns||[],visible=ordered(rows,data.rowOrder||[]).filter(row=>!audience||!row.data?.audience||row.data.audience==='Общее'||row.data.audience===audience);
  return {sheets:[{name:title||data.name||'Таблица',title:`${project||'Свадьба'} — ${title||data.name||'таблица'}`,columns:columns.map(column=>({key:column.id,label:column.name,options:column.options?.map(option=>column.optionLabels?.[option]||option),hidden:(data.hiddenColumns||[]).includes(column.id),type:column.type==='formula'?(column.resultType||'number'):column.type,width:data.sheetLayout?.columnWidths?.[column.id]?data.sheetLayout.columnWidths[column.id]/7:['text','url'].includes(column.type)?240/7:180/7})),rowHeights:visible.map(row=>data.sheetLayout?.rowHeights?.[row.id]||44),rows:visible.map((row,index)=>Object.fromEntries(columns.map(column=>{
    const value=tableValue(row,column,{relationRows,files,members}),format=row.data?.cellFormats?.[column.id],formula=column.type==='formula'?excelFormula(column,columns,index+3):column.id==='due'&&column.computed&&columns.some(c=>c.id==='agreed')&&columns.some(c=>c.id==='paid')?`MAX(0,${excelColumn(columns.findIndex(c=>c.id==='agreed'))}${index+3}-${excelColumn(columns.findIndex(c=>c.id==='paid'))}${index+3})`:undefined;
    return [column.id,formula||format?styledCell(value,format,column.type==='formula'?(column.resultType||'number'):column.type,formula):value];
  })))}]};
}

export function downloadTableXlsx(options){
  if(navigator.onLine&&options.table?.project_id)return downloadExport(options.table.project_id,'table',options.table.id,options.audience);
  const title=options.title||dataOf(options.table).name||'таблица',fileName=options.fileName||`${options.project||'Свадьба'} — ${title}`;
  return downloadXlsx(tableWorkbook(options),clean(fileName));
}

export function downloadGuestsXlsx(state){
  const all=entities(state),table=all.find(item=>item.kind==='table'&&item.data?.key==='guests'),rows=all.filter(item=>item.kind==='row'&&item.parent_id===table?.id),members=state.assignableMembers||state.members||[];
  if(!table)throw new Error('Реестр гостей не найден.');
  return downloadTableXlsx({project:projectName(state),table,rows,relationRows:all.filter(item=>['row','seatingTable'].includes(item.kind)),files:all.filter(item=>item.kind==='file'),members,title:'Гости',fileName:`${projectName(state)} — гости`});
}

export function budgetWorkbook(state){
  const all=entities(state);
  return {sheets:[...(all.some(item=>item.kind==='coupleBudget')?[coupleBudgetWorkbook(state).sheets[0]]:[]),obligationSheetWorkbook(state).sheets[0],financeSheetWorkbook(state).sheets[0]]};
}

export function downloadBudgetXlsx(state){
  if(navigator.onLine&&state.project?.id&&!state.offline)return downloadExport(state.project.id,'budget');
  return downloadXlsx(budgetWorkbook(state),clean(`${projectName(state)} — бюджет`));
}

export function seatingWorkbook(state){
  const all=entities(state),guestTable=all.find(item=>item.kind==='table'&&item.data?.key==='guests'),map=guestTable?.data?.semanticMap||{},guests=all.filter(item=>item.kind==='row'&&item.parent_id===guestTable?.id),plan=all.find(item=>item.kind==='seatingPlan'),tables=all.filter(item=>item.kind==='seatingTable'&&item.parent_id===plan?.id),tableName=id=>dataOf(tables.find(item=>item.id===id)).label||'Без места',rsvpText=value=>{for(const [key,label] of Object.entries({unanswered:'Нет ответа',confirmed:'Подтвердил',declined:'Отказ',tentative:'Пока не знает'}))if(map.rsvpValues?.[key]===value)return label;return value||'Нет ответа'};
  const guestRows=guests.map(guest=>({name:guest.data[map.guestName]||'',rsvp:rsvpText(guest.data[map.rsvpStatus]),table:tableName(guest.data[map.seatingTable]),seat:guest.data[map.seatIndex]||null})).sort((a,b)=>a.table.localeCompare(b.table,'ru')||Number(a.seat||999)-Number(b.seat||999)||a.name.localeCompare(b.name,'ru'));
  const tableRows=tables.map(table=>{const occupied=guests.filter(guest=>guest.data[map.seatingTable]===table.id).length;return {label:table.data.label,shape:({round150:'Круглый 150 см',round:'Круглый 180 см',rect:'Прямоугольный 180 × 90 см',snakeQuarter:'Змейка ¼ круга',square:'Квадратный',oval:'Овальный',custom:'Своя форма'})[table.data.shape]||table.data.shape,capacity:table.data.capacity,occupied,free:Math.max(0,Number(table.data.capacity||0)-occupied),x:table.data.xM,y:table.data.yM,width:table.data.widthM,height:table.data.heightM,rotation:table.data.rotationDeg||0}});
  return {sheets:[{name:'Рассадка гостей',title:`${projectName(state)} — рассадка гостей`,columns:[{key:'name',label:'Гость',width:28},{key:'rsvp',label:'Ответ',width:18},{key:'table',label:'Стол',width:20},{key:'seat',label:'Место',type:'number',width:12}],rows:guestRows},{name:'Столы',title:`${projectName(state)} — столы`,columns:[{key:'label',label:'Стол',width:20},{key:'shape',label:'Форма',width:18},{key:'capacity',label:'Вместимость',type:'number',width:14},{key:'occupied',label:'Занято',type:'number',width:12},{key:'free',label:'Свободно',type:'number',width:12},{key:'x',label:'X, м',type:'number',width:10},{key:'y',label:'Y, м',type:'number',width:10},{key:'width',label:'Ширина, м',type:'number',width:12},{key:'height',label:'Высота, м',type:'number',width:12},{key:'rotation',label:'Поворот, °',type:'number',width:12}],rows:tableRows}]};
}

export function downloadSeatingXlsx(state){
  if(navigator.onLine&&state.project?.id&&!state.offline)return downloadExport(state.project.id,'seating');
  return downloadXlsx(seatingWorkbook(state),clean(`${projectName(state)} — рассадка`));
}

export function coupleBudgetWorkbook(state){
  const data=entities(state).find(item=>item.kind==='coupleBudget')?.data||{},visible=coupleBudgetColumns(data),allColumns=coupleBudgetColumns(data,true),columns=[...visible,...allColumns.filter(column=>!visible.some(c=>c.id===column.id))];
  const {groups,overall,organizer,groupTotals}=coupleBudgetTotals(data),rows=[],heights=[],itemPositions=new Map();
  const blank=()=>Object.fromEntries(columns.map(c=>[c.id,null]));
  const totalRow=(label,values)=>({...blank(),name:label,...Object.fromEntries(['estimated','actual','prepaid','remaining'].map(field=>[field,values[field]]))});
  rows.push(totalRow('Общий бюджет',overall),totalRow('Общий бюджет для организатора',organizer));heights.push(44,44);
  for(const group of groups){
    rows.push({...blank(),name:styledCell(data.names?.[group.row]||group.name,data.cellFormats?.name?.[group.row]||{style:{bold:true}})});heights.push(44);
    const positions=[];
    for(const item of group.items){
      const excelRow=rows.length+3;itemPositions.set(String(item.row),excelRow);positions.push(excelRow);
      const values={name:data.names?.[item.row]||item.name,note:data.notes?.[item.row]??item.note??'',estimated:data.estimated?.[item.row]??null,actual:data.actual?.[item.row]??null,prepaid:data.prepaid?.[item.row]??null,remaining:coupleBudgetRemaining(data,item.row),...Object.fromEntries((data.extraColumns||[]).map(c=>[c.id,data.extraValues?.[c.id]?.[item.row]??null]))};
      rows.push(Object.fromEntries(columns.map(c=>{
        const ref=id=>`${excelColumn(columns.findIndex(column=>column.id===id))}${excelRow}`;
        const formula=c.id==='remaining'?`${ref('actual')}-${ref('prepaid')}`:c.type==='formula'?excelFormula(c,columns,excelRow):null;
        const value=c.id!=='remaining'&&c.type==='formula'?compute(c.formula||'',values):values[c.id];
        return [c.id,styledCell(value,data.cellFormats?.[c.id]?.[item.row],c.id==='remaining'?'money':c.type==='formula'?(c.resultType||'number'):c.type,formula)];
      })));heights.push(data.sheetLayout?.rowHeights?.[item.row]||44);
    }
    rows.push(totalRow(group.totalLabel,groupTotals[group.row]));heights.push(44);
    const index=rows.length-1;
    for(const field of ['estimated','actual','prepaid','remaining'])rows[index][field]=sumCell(field,positions,groupTotals[group.row][field]);
  }
  function sumCell(field,positions,value){const letter=excelColumn(columns.findIndex(c=>c.id===field));return styledCell(value,{style:{bold:true}},'money',positions.length?`SUM(${positions.map(row=>`${letter}${row}`).join(',')})`:'0')}
  const allPositions=[...itemPositions.values()],organizerPositions=groups.flatMap(group=>group.items.filter(item=>coupleBudgetOrganizerIncluded(data,item.row)).map(item=>itemPositions.get(String(item.row))));
  for(const field of ['estimated','actual','prepaid','remaining']){rows[0][field]=sumCell(field,allPositions,overall[field]);rows[1][field]=sumCell(field,organizerPositions,organizer[field])}
  return {sheets:[{name:'Смета пары',title:`${projectName(state)} — смета пары`,filter:false,columns:columns.map(c=>({key:c.id,label:c.name,options:c.options,type:c.id==='remaining'?'money':c.type==='formula'?(c.resultType||'number'):c.type,width:(data.sheetLayout?.columnWidths?.[c.id]||({name:280,note:300}[c.id]||170))/7,hidden:!visible.some(column=>column.id===c.id)})),rows,rowHeights:heights}]};
}

export function financeSheetWorkbook(state,agency=false){
  const all=[...(state.entities||[]),...(state.global||[])].filter(item=>!item.deleted),config=all.find(item=>item.kind==='financeSheet'),columns=financialColumnsForState(state,config?.data.columns||financeSheetColumns(agency),agency),rows=all.filter(item=>item.kind==='movement').map(row=>({...row,data:{...row.data,...row.data.sheetValues}}));
  return tableWorkbook({project:agency?state.agency?.name:projectName(state),table:{data:{name:agency?'Операции агентства':'Движение средств пары',...config?.data,columns}},rows});
}
export function downloadFinanceSheetXlsx(state,agency=false){
  if(navigator.onLine&&!state.offline)return downloadExport(agency?'':state.project.id,agency?'agencyFinance':'financeSheet');
  return downloadXlsx(financeSheetWorkbook(state,agency),agency?'Операции агентства':`${projectName(state)} — операции`);
}

export function obligationSheetWorkbook(state){
  const all=entities(state),config=all.find(row=>row.kind==='financeSheet'),columns=obligationColumnsForState(state),rows=all.filter(row=>row.kind==='obligation').map(row=>({...row,data:{...row.data,...row.data.sheetValues,paid:row.data.paid??state.financials?.paid?.[row.id]??0,due:row.data.due??Math.max(0,(row.data.agreed||0)-(state.financials?.paid?.[row.id]||0))}}));
  return tableWorkbook({project:projectName(state),table:{data:{name:'Реестр выплат',columns,sheetLayout:config?.data.obligationLayout,hiddenColumns:config?.data.obligationHiddenColumns}},rows});
}

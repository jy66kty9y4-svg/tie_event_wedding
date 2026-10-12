export function financialColumnsForState(state,columns,agency=false){
  if(!state?.user||state.user.protected)return columns;
  const scope=agency?'agencyFinance':'budget',permission=agency?'agencyFinance':'finance',project=agency?null:state.project?.id;
  const readable=field=>(state.grants||[]).some(grant=>{const r=grant.restrictions||{};return(grant.project_id==null||grant.project_id===project)&&['read',permission].every(action=>grant.permissions?.includes(action))&&(!r.sections?.length||r.sections.includes(scope))&&(!r.fields?.length||r.fields.includes(field))});
  return columns.filter(column=>readable(column.id)&&(column.type!=='formula'||[...column.formula.matchAll(/\{([^}]+)\}/g)].every(match=>readable(match[1]))));
}
export function financeSheetColumns(agency=false){return [
  {id:'description',name:'Описание',type:'text'},
  {id:'date',name:'Дата',type:'date'},
  {id:'type',name:'Тип операции',type:'select',options:agency?['income','expense']:['deposit','payment','refund','transfer','fee'],optionLabels:{income:'Доход агентства',expense:'Расход агентства',deposit:'Поступление от пары',payment:'Выплата подрядчику',refund:'Возврат паре',transfer:'Передача организатору',fee:'Оплата гонорара'}},
  {id:'amount',name:'Сумма, ₽',type:'money'},
  {id:'method',name:'Способ оплаты',type:'text'}
];}
export function obligationSheetColumns(){return [{id:'title',name:'Статья',type:'text'},{id:'priceKind',name:'Статус цены',type:'select',options:['amount','unknown','included'],optionLabels:{amount:'Согласованная сумма',unknown:'Цена неизвестна',included:'Включено в пакет'}},{id:'agreed',name:'Стоимость для пары',type:'money'},{id:'agencyCommission',name:'Агентская комиссия',type:'money'},{id:'planned',name:'Плановая стоимость',type:'money'},{id:'paid',name:'Оплачено',type:'money',computed:true},{id:'due',name:'Осталось',type:'money',computed:true},{id:'dueDate',name:'Срок',type:'date'},{id:'condition',name:'Условия оплаты',type:'text'},{id:'categoryId',name:'Категория',type:'select',options:[]},{id:'responsible',name:'Ответственный',type:'select',options:[]}];}
export function obligationColumnsForState(state){const config=(state.entities||[]).find(row=>row.kind==='financeSheet'),members=state.assignableMembers||state.members||[],categories=(state.entities||[]).filter(row=>row.kind==='category'&&!row.deleted);return financialColumnsForState(state,config?.data.obligationColumns||obligationSheetColumns()).filter(column=>column.id!=='agencyCommission'||state.canViewAgencyCommission).map(column=>column.id==='categoryId'?{...column,options:categories.map(row=>row.id),optionLabels:Object.fromEntries(categories.map(row=>[row.id,row.data.name]))}:column.id==='responsible'?{...column,options:members.map(row=>row.id),optionLabels:Object.fromEntries(members.map(row=>[row.id,row.name]))}:column);}


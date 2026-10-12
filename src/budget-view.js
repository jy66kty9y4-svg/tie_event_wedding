// View preferences live in this browser, independently of shared wedding data.
import {tableDevice,localColumnWidths,readTableView} from './table-view.js';
export const budgetDevice=tableDevice,budgetColumnWidths=localColumnWidths,readBudgetView=readTableView;
export function budgetViewKeys(scope,device) {
  const base=`tie:budget-view:v2:${scope}`,view=`${base}:${device}`;
  return {scale:`${view}:scale`,columns:`${view}:columns`,migrated:`${base}:zoom-migrated`,legacy:`tie:budget-zoom:${scope}`,minScale:.2};
}
export function budgetColumnWidth(column,device,shared={},local={},measured={}) {
  const phone={name:200,estimated:165,actual:127,prepaid:120,remaining:110,note:123};
  return local[column.id]||(device==='phone'?Math.max(phone[column.id]||130,measured[column.id]||0):shared[column.id]||({name:280,note:300}[column.id]||170));
}
export const budgetNumericColumn=column=>['money','number','formula'].includes(column.type)||column.id==='remaining';

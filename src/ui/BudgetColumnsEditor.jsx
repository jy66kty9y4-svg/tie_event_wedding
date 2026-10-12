import {TableEditor} from './ProjectTools.jsx';
import {coupleBudgetBaseColumns,coupleBudgetColumns,coupleBudgetViewGroups} from '../couple-budget.js';
export function BudgetColumnsEditor({sheet,onSave,onClose}){
  return <TableEditor inline simple rowCount={coupleBudgetViewGroups(sheet).reduce((count,group)=>count+group.items.length,0)} table={{data:{columns:coupleBudgetColumns(sheet,true),hiddenColumns:sheet.hiddenColumns||[]}}} protectedIds={coupleBudgetBaseColumns.map(c=>c.id)} removedColumns={sheet.deletedColumns||[]} onSave={data=>onSave('columns',{columns:data.columns,hiddenColumns:data.hiddenColumns})} onClose={onClose}/>;
}

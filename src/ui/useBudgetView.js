import {useTableDevice,useTableView} from './useTableView.js';
import {budgetViewKeys,budgetColumnWidth,budgetNumericColumn} from '../budget-view.js';
export const useBudgetDevice=useTableDevice;
export const useBudgetView=options=>useTableView({...options,keys:budgetViewKeys(options.scope,options.device),widthForColumn:budgetColumnWidth,isNumeric:budgetNumericColumn});

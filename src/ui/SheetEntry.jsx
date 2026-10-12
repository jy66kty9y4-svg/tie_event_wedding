import {useTableScope,useTableView} from './useTableView.js';
import {SheetZoom} from './SheetZoom.jsx';
import {Modal} from './Modal.jsx';
import {useEffect,useSyncExternalStore} from 'react';
import {SheetDraftRow} from './SheetDraftRow.jsx';
const entries=new Map(),listeners=new Set();
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
const announce=()=>listeners.forEach(listener=>listener());
export function useSheetEntry(id){return useSyncExternalStore(subscribe,()=>entries.get(id)||null)}

// Financial actions opened elsewhere join the existing table, including its
// column sizing, rather than mounting a second form underneath it.
export function SheetEntry({targetId,columns,initialValues,requiredIds,onSave,onClose,title,rowId}){
  useEffect(()=>{
    if(!document.getElementById(targetId))return;
    const entry={columns,initialValues,requiredIds,onSave,onCancel:onClose,label:title,rowId};
    entries.set(targetId,entry);announce();
    document.getElementById(targetId)?.scrollIntoView({block:'center',behavior:'smooth'});
    return()=>{if(entries.get(targetId)===entry){entries.delete(targetId);announce()}};
  },[targetId]);
  if(document.getElementById(targetId))return null;
  return <StandaloneEntry {...{targetId,columns,initialValues,requiredIds,onSave,onClose,title}}/>;
}
function StandaloneEntry(props) {
  const view=useTableScope(`entry:${props.targetId}`);
  return <EntryForDevice key={view.key} {...props} view={view}/>;
}
function EntryForDevice({view,columns,initialValues,requiredIds,onSave,onClose,title}) {
  const {table,layout,scaleKey,initialScale,defaultFit}=useTableView({...view,columns});
  const widths=columns.map(c=>layout.columnWidths[c.id]);
  return <Modal title={title} wide onClose={onClose}><div className="dialog-body"><SheetZoom minScale={.1} storageKey={scaleKey} initialScale={initialScale} defaultFit={defaultFit} label={title} controlsLabel="Масштаб таблицы" className="table-scroll"><table ref={table} className="excel-sheet" style={{width:46+widths.reduce((a,b)=>a+b,0)}}><colgroup><col style={{width:46}}/>{columns.map((c,i)=><col key={c.id} style={{width:widths[i]}}/>)}</colgroup><thead><tr><th>№</th>{columns.map(c=><th key={c.id}>{c.name}</th>)}</tr></thead><tbody><SheetDraftRow columns={columns} initialValues={initialValues} requiredIds={requiredIds} onSave={onSave} onCancel={onClose} label={title}/></tbody></table></SheetZoom></div></Modal>;
}

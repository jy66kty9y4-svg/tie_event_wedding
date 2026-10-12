import React,{createContext,useContext,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {tableDevice,tableViewKeys,readTableView,tableColumnWidth,numericColumn} from '../table-view.js';
import {useSheetLayout} from './SheetLayout.jsx';

const context=createContext({agencyId:'',userId:'',projectId:'agency'});
export function TableViewProvider({state,children}) {
  return React.createElement(context.Provider,{value:{agencyId:state.agency?.id||'',userId:state.user?.id||'',projectId:state.project?.id||'agency'}},children);
}
const deviceSnapshot=()=>tableDevice({coarse:matchMedia('(pointer: coarse)').matches,width:screen.width,height:screen.height});
function subscribeDevice(listener) {
  const pointer=matchMedia('(pointer: coarse)');
  pointer.addEventListener('change',listener);window.addEventListener('resize',listener);window.addEventListener('orientationchange',listener);
  return()=>{pointer.removeEventListener('change',listener);window.removeEventListener('resize',listener);window.removeEventListener('orientationchange',listener);};
}
export const useTableDevice=()=>useSyncExternalStore(subscribeDevice,deviceSnapshot,()=> 'desktop');
export function useTableScope(id,projectId) {
  const identity=useContext(context),device=useTableDevice();
  const scope=`${identity.agencyId}:${identity.userId}:${projectId??identity.projectId}:${id}`;
  return {scope,device,key:`${scope}:${device}`};
}
export function useTableView({scope,device,columns,sheet={},revision,onLayout,keys=tableViewKeys(scope,device),widthForColumn=tableColumnWidth,isNumeric=numericColumn}) {
  const [saved]=useState(()=>{try{return readTableView(localStorage,keys);}catch{return {scale:null,columns:{}};}});
  const [localColumns,setLocalColumns]=useState(saved.columns),[measured,setMeasured]=useState({});
  const localRef=useRef(saved.columns),table=useRef(null);
  const stored={...sheet.sheetLayout,columnWidths:Object.fromEntries(columns.map(c=>[c.id,widthForColumn(c,device,sheet.sheetLayout?.columnWidths,localColumns,measured)]))};
  const {layout,resize}=useSheetLayout(stored,async(axis,id,value)=>{
    if(axis==='columnWidths') {
      const next={...localRef.current,[id]:value};localRef.current=next;setLocalColumns(next);
      try{localStorage.setItem(keys.columns,JSON.stringify(next));}catch{}
    } else await onLayout?.(axis,id,value);
  });
  const numericIds=columns.filter(isNumeric).map(c=>c.id),signature=JSON.stringify(numericIds);
  const measure=()=>{
    if(device!=='phone'||!table.current)return;
    const canvas=document.createElement('canvas'),drawing=canvas.getContext('2d'),next={};
    if(!drawing)return;
    const pixels=(style,key)=>parseFloat(style[key])||0;
    for(const cell of table.current.querySelectorAll('td[data-sheet-column],td[data-budget-column],td[data-column-id]')) {
      const id=cell.dataset.sheetColumn||cell.dataset.budgetColumn||cell.dataset.columnId;
      if(!numericIds.includes(id)||localRef.current[id])continue;
      const text=cell.querySelector('.budget-rich-cell,input')||cell;
      if(text.contains(document.activeElement)&&(text.isContentEditable||text.tagName==='INPUT'))continue;
      const style=getComputedStyle(text),cellStyle=getComputedStyle(cell);
      drawing.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const padding=pixels(cellStyle,'paddingLeft')+pixels(cellStyle,'paddingRight')+(text===cell?0:pixels(style,'paddingLeft')+pixels(style,'paddingRight'));
      const width=Math.min(800,Math.ceil(drawing.measureText(text.tagName==='INPUT'?text.value:text.textContent||'').width+padding+6));
      next[id]=Math.max(next[id]||0,width);
    }
    setMeasured(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
  };
  useLayoutEffect(measure,[sheet,revision,signature,device]);
  useEffect(()=>{let active=true;document.fonts?.ready.then(()=>{if(active)measure();});return()=>{active=false;};},[sheet,revision,signature,device]);
  return {table,layout,resize,scaleKey:keys.scale,initialScale:saved.scale,defaultFit:device==='phone'&&saved.scale==null};
}

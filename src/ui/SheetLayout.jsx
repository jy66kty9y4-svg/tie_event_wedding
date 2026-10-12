import {useEffect,useRef,useState} from 'react';
import './sheet.css';

export function useSheetLayout(stored={},onSave) {
  const [layout,setLayout]=useState(stored);
  const latest=useRef(stored), saving=useRef(Promise.resolve());
  useEffect(()=>{latest.current=stored;setLayout(stored)},[JSON.stringify(stored)]);
  const resize=(axis,id,value,commit=false)=>{
    const next={...latest.current,[axis]:{...latest.current[axis],[id]:value}};
    latest.current=next;setLayout(next);
    if(commit&&onSave) saving.current=saving.current.catch(()=>{}).then(()=>onSave(axis,id,value)).catch(()=>{latest.current=stored;setLayout(stored)});
    return saving.current;
  };
  return {layout,resize};
}
export function ResizeHandle({axis,id,label,value,onResize}) {
  const horizontal=axis==='columnWidths', min=horizontal?80:32,max=horizontal?800:500;
  const cancelActive=useRef(null);
  useEffect(()=>()=>cancelActive.current?.(),[]);
  return <button type="button" className={`sheet-resize ${horizontal?'column':'row'}`} role="separator" aria-label={`${horizontal?'Ширина колонки':'Высота строки'} ${label}`} aria-orientation={horizontal?'vertical':'horizontal'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    onKeyDown={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();void onResize(axis,id,Math.max(min,Math.min(max,value+(['ArrowLeft','ArrowUp'].includes(event.key)?-8:8))),true)}}}
    onPointerDown={event=>{cancelActive.current?.();event.preventDefault();const element=event.currentTarget,start=horizontal?event.clientX:event.clientY,original=value,pointer=event.pointerId,scale=Number(element.closest('[data-sheet-zoom]')?.dataset.sheetZoom)||1;let final=value;element.setPointerCapture(pointer);
      const move=e=>{if(e.pointerId!==pointer)return;final=Math.max(min,Math.min(max,Math.round(original+((horizontal?e.clientX:e.clientY)-start)/scale)));onResize(axis,id,final)};
      const cleanup=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',cancel);document.removeEventListener('tie:sheet-pinch',pinch);cancelActive.current=null;if(element.hasPointerCapture(pointer))element.releasePointerCapture(pointer)};
      const end=e=>{if(e.pointerId!==pointer)return;cleanup();void onResize(axis,id,final,true)};
      const cancel=()=>{cleanup();onResize(axis,id,original)};
      const pinch=e=>{if(e.target.contains(element))cancel()};
      cancelActive.current=cancel;document.addEventListener('tie:sheet-pinch',pinch);
      element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',cancel);
    }}/>
}

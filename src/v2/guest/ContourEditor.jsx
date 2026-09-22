import React,{useRef,useEffect} from 'react';
import {pointOnPlan,removeContourPoint} from './interaction.mjs';

export function ContourEditor({drawing,setDrawing,plan,canvasRef,disabled}) {
 const drag=useRef(null);
 const remove=()=>setDrawing(current=>removeContourPoint(current));
 const updatePoint=(axis,value)=>setDrawing(current=>({
  ...current,
  points:current.points.map((point,index)=>index===current.selected?{...point,[axis]:Math.max(0,Math.min(axis==='x'?plan.widthM:plan.heightM,Number(value)||0))}:point)
 }));
 useEffect(()=>{
  const key=event=>{
   if(disabled||event.target.closest('input,textarea,select,[contenteditable=true]'))return;
   if(['Backspace','Delete'].includes(event.key)&&drawing.selected!=null){event.preventDefault();remove();}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[drawing.selected,disabled]);
 const move=event=>{
  const session=drag.current;if(!session||session.pointer!==event.pointerId)return;
  if(!session.moved&&Math.hypot(event.clientX-session.x,event.clientY-session.y)<3)return;
  session.moved=true;
  const p=pointOnPlan(event.clientX,event.clientY,canvasRef.current.getBoundingClientRect(),plan);
  setDrawing(current=>({...current,points:current.points.map((point,index)=>index===session.index?{x:Math.max(0,Math.min(plan.widthM,p.x)),y:Math.max(0,Math.min(plan.heightM,p.y))}:point)}));
  event.preventDefault();event.stopPropagation();
 };
 return <>
  <svg className="v2-seat-draw-layer" viewBox={`0 0 ${plan.widthM} ${plan.heightM}`} aria-hidden="true">
   {drawing.closed?<polygon points={drawing.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="#ad4e6c20" stroke="#ad4e6c" strokeWidth=".025"/>:<polyline points={drawing.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#ad4e6c" strokeWidth=".025"/>}
  </svg>
  {drawing.points.map((p,index)=><button key={index} type="button" className={`v2-seat-point ${drawing.selected===index?'is-selected':''} ${index===0?'is-first':''}`} style={{left:`${p.x/plan.widthM*100}%`,top:`${p.y/plan.heightM*100}%`}} aria-label={`Точка ${index+1}${index===0&&!drawing.closed&&drawing.points.length>=3?' — замкнуть контур':''}. Стрелки перемещают точку, Shift — шаг 25 см.`} aria-pressed={drawing.selected===index} disabled={disabled}
   onPointerDown={event=>{if(event.button!==0||event.isPrimary===false)return;event.stopPropagation();event.preventDefault();setDrawing(current=>({...current,selected:index}));drag.current={pointer:event.pointerId,index,x:event.clientX,y:event.clientY,moved:false,before:drawing.points};event.currentTarget.setPointerCapture(event.pointerId);}}
   onPointerMove={move} onPointerUp={event=>{event.stopPropagation();const session=drag.current;if(!session)return;move(event);drag.current=null;if(!session.moved&&index===0&&drawing.points.length>=3)setDrawing(current=>({...current,closed:true}));}}
   onPointerCancel={()=>{const session=drag.current;drag.current=null;if(session)setDrawing(current=>({...current,points:session.before}));}}
   onClick={event=>event.stopPropagation()} onKeyDown={event=>{const delta={ArrowLeft:[-.05,0],ArrowRight:[.05,0],ArrowUp:[0,-.05],ArrowDown:[0,.05]}[event.key];if(delta){event.preventDefault();const multiplier=event.shiftKey?5:1;setDrawing(current=>({...current,selected:index,points:current.points.map((point,pointIndex)=>pointIndex===index?{x:Math.max(0,Math.min(plan.widthM,point.x+delta[0]*multiplier)),y:Math.max(0,Math.min(plan.heightM,point.y+delta[1]*multiplier))}:point)}));return;}if(['Enter',' '].includes(event.key)){event.preventDefault();setDrawing(current=>({...current,selected:index,...(index===0&&current.points.length>=3?{closed:true}:{})}));}}}><span>{index+1}</span></button>)}
  {drawing.selected!=null&&<div className="v2-seat-point-coordinates" role="group" aria-label={`Координаты точки ${drawing.selected+1}`}><label>X, м<input type="number" step="0.05" min="0" max={plan.widthM} disabled={disabled} value={drawing.points[drawing.selected]?.x??''} onChange={event=>updatePoint('x',event.target.value)}/></label><label>Y, м<input type="number" step="0.05" min="0" max={plan.heightM} disabled={disabled} value={drawing.points[drawing.selected]?.y??''} onChange={event=>updatePoint('y',event.target.value)}/></label></div>}
 </>;
}

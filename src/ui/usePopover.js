import {useEffect,useRef} from 'react';

// Shared dismissal and focus behavior for non-modal cabinet panels.
export function usePopover(open,onClose,triggerRef,initialFocusRef){
 const host=useRef(null),panel=useRef(null),close=useRef(onClose);
 close.current=onClose;
 useEffect(()=>{
  if(!open)return;
  const measure=()=>{const element=panel.current;if(element)element.style.setProperty('--popover-available-height',`${Math.max(120,window.innerHeight-element.getBoundingClientRect().top-16)}px`)};
  const frame=requestAnimationFrame(()=>{measure();(initialFocusRef?.current||panel.current?.querySelector('button:not([disabled]),input,select,textarea,[tabindex="0"]'))?.focus()});
  const pointer=event=>{if(!host.current?.contains(event.target))close.current()};
  const key=event=>{if(event.key==='Escape'){event.preventDefault();close.current(true);triggerRef.current?.focus()}};
  const focus=event=>{if(!host.current?.contains(event.target))close.current()};
  document.addEventListener('pointerdown',pointer);
  document.addEventListener('keydown',key);
  document.addEventListener('focusin',focus);window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);document.removeEventListener('focusin',focus);window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true)};
 },[open,triggerRef,initialFocusRef]);
 return {host,panel};
}

import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import './sheet-zoom.css';

const clamp=(value,min=.2)=>Math.max(min,Math.min(2.5,Math.round(value*10000)/10000));
function verticalScroller(element){
  for(let parent=element.parentElement;parent;parent=parent.parentElement){
    if(/auto|scroll/.test(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight+1)return parent;
  }
  return document.scrollingElement;
}
const midpoint=touches=>({x:(touches[0].clientX+touches[1].clientX)/2,y:(touches[0].clientY+touches[1].clientY)/2});
const distance=touches=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);

export function SheetZoom({children,storageKey,initialScale=1,defaultFit=false,className='',label='Таблица сметы',controlsLabel='Масштаб сметы',minScale=.2}){
  const [scale,setScale]=useState(()=>clamp(initialScale||1,minScale));
  const scroll=useRef(null),content=useRef(null),current=useRef(scale),gesture=useRef(null),suppressUntil=useRef(0);
  const autoFit=useRef(defaultFit);
  const unscaledWidth=()=>Math.max(content.current.scrollWidth,content.current.getBoundingClientRect().width/current.current);
  const persist=()=>{try{localStorage.setItem(storageKey,String(current.current));}catch{}};
  const anchor=point=>{
    const box=content.current.getBoundingClientRect();
    return {x:(point.x-box.left)/current.current,y:(point.y-box.top)/current.current,vertical:verticalScroller(scroll.current)};
  };
  const apply=(value,point,origin)=>{
    const next=clamp(value,minScale);current.current=next;content.current.style.zoom=String(next);setScale(next);
    const box=content.current.getBoundingClientRect();
    scroll.current.scrollLeft+=box.left+origin.x*next-point.x;
    origin.vertical.scrollTop+=box.top+origin.y*next-point.y;
  };
  const change=value=>{
    autoFit.current=false;
    const box=scroll.current.getBoundingClientRect(),point={x:box.left+scroll.current.clientWidth/2,y:Math.max(box.top,Math.min(box.bottom,window.innerHeight/2))};
    apply(value,point,anchor(point));persist();
  };
  useLayoutEffect(()=>{
    const fit=()=>{
      if(!autoFit.current)return;
      const next=clamp(Math.min(1,scroll.current.clientWidth/unscaledWidth()),minScale);
      if(Math.abs(next-current.current)<.0001)return;
      current.current=next;content.current.style.zoom=String(next);setScale(next);
    };
    // Defer observer-driven writes: WebKit reports a loop when zoom changes
    // the observed content size inside the same ResizeObserver delivery.
    let frame=null;
    fit();const observer=new ResizeObserver(()=>{if(frame==null)frame=requestAnimationFrame(()=>{frame=null;fit();});});
    observer.observe(scroll.current);observer.observe(content.current);
    return()=>{observer.disconnect();if(frame!=null)cancelAnimationFrame(frame);};
  },[]);
  useEffect(()=>{
    const element=scroll.current;
    const begin=event=>{
      if(event.touches.length!==2)return;
      if(event.cancelable)event.preventDefault();
      const point=midpoint(event.touches),length=distance(event.touches);
      if(!length)return;
      autoFit.current=false;
      gesture.current={start:current.current,distance:length,origin:anchor(point),ids:[event.touches[0].identifier,event.touches[1].identifier]};
      element.dispatchEvent(new CustomEvent('tie:sheet-pinch',{bubbles:true}));
    };
    const move=event=>{
      const active=gesture.current;if(!active)return;
      if(event.cancelable)event.preventDefault();
      const touches=active.ids.map(id=>[...event.touches].find(touch=>touch.identifier===id));
      if(touches.some(touch=>!touch))return;
      apply(active.start*distance(touches)/active.distance,midpoint(touches),active.origin);
    };
    const end=event=>{
      if(!gesture.current)return;
      if(event.cancelable)event.preventDefault();
      // Wait for both fingers to lift, so the remaining finger cannot edit a cell.
      suppressUntil.current=Date.now()+350;
      if(!event.touches.length){gesture.current=null;persist();}
    };
    const click=event=>{if(gesture.current||Date.now()<suppressUntil.current){event.preventDefault();event.stopPropagation();}};
    const nativeGesture=event=>{if(event.cancelable)event.preventDefault();};
    const options={capture:true,passive:false};
    element.addEventListener('touchstart',begin,options);element.addEventListener('touchmove',move,options);
    element.addEventListener('touchend',end,options);element.addEventListener('touchcancel',end,options);
    element.addEventListener('click',click,true);
    for(const type of ['gesturestart','gesturechange','gestureend'])element.addEventListener(type,nativeGesture,options);
    return()=>{
      element.removeEventListener('touchstart',begin,true);element.removeEventListener('touchmove',move,true);
      element.removeEventListener('touchend',end,true);element.removeEventListener('touchcancel',end,true);element.removeEventListener('click',click,true);
      for(const type of ['gesturestart','gesturechange','gestureend'])element.removeEventListener(type,nativeGesture,true);
    };
  },[storageKey]);
  return <>
    <div className="sheet-zoom-controls" role="group" aria-label={controlsLabel}>
      <span>Масштаб</span><button type="button" aria-label={label==='Таблица сметы'?'Уменьшить смету':'Уменьшить таблицу'} disabled={scale<=minScale} onClick={()=>change(scale-.1)}>−</button>
      <button type="button" className="sheet-zoom-percent" aria-label={`Масштаб ${Math.round(scale*100)}%. Вернуть 100%`} onClick={()=>change(1)}>{Math.round(scale*100)}%</button>
      <button type="button" aria-label={label==='Таблица сметы'?'Увеличить смету':'Увеличить таблицу'} disabled={scale>=2.5} onClick={()=>change(scale+.1)}>+</button>
      <button type="button" onClick={()=>change(scroll.current.clientWidth/unscaledWidth())}>Вместить</button>
      <small>На телефоне — двумя пальцами</small>
    </div>
    <div ref={scroll} className={`${className} sheet-zoom-scroll`} data-sheet-zoom={scale} role="region" aria-label={label}>
      <div ref={content} className="sheet-zoom-content" style={{zoom:scale}}>{children}</div>
    </div>
  </>;
}

import {Children,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './select.css';

// Draw options in the document, so browser zoom cannot detach a native popup
// from its control. The native field retains form values and validation.
export function Select({children,value,onChange,className='',style,disabled,required,multiple=false,...props}) {
 const options=Children.toArray(children).filter(child=>child?.type==='option').map(child=>({value:String(child.props.value??child.props.children),label:child.props.children,disabled:!!child.props.disabled}));
 const trigger=useRef(null),native=useRef(null),panel=useRef(null),typed=useRef({text:'',at:0}),id=useId();
 const [open,setOpen]=useState(false),[active,setActive]=useState(0),[position,setPosition]=useState(null),[invalid,setInvalid]=useState(false);
 const selectedValues=new Set(multiple?(Array.isArray(value)?value.map(String):[]):[String(value??'')]);
 const selected=options.findIndex(option=>selectedValues.has(option.value));
 const close=()=>setOpen(false);
 const show=()=>{if(disabled)return;setActive(selected>=0?selected:Math.max(0,options.findIndex(option=>!option.disabled)));setOpen(true)};
 const choose=index=>{const option=options[index];if(!option||option.disabled)return;if(multiple){const next=new Set(selectedValues);next.has(option.value)?next.delete(option.value):next.add(option.value);for(const item of native.current.options)item.selected=next.has(item.value)}else native.current.value=option.value;native.current.dispatchEvent(new Event('change',{bubbles:true}));setInvalid(false);close();trigger.current.focus()};
 useLayoutEffect(()=>{
  if(!open)return;
  const measure=()=>{const r=trigger.current.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=window.innerHeight,width=Math.min(Math.max(r.width,160),vw-16),below=vh-r.bottom-8,above=r.top-8,up=below<180&&above>below,height=Math.min(280,up?above:below),font=getComputedStyle(trigger.current);setPosition({left:Math.max(8,Math.min(r.left,vw-width-8)),width,maxHeight:Math.max(40,height),...(up?{bottom:vh-r.top+4}:{top:r.bottom+4}),fontFamily:font.fontFamily,fontSize:font.fontSize})};
  measure();window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
  return()=>{window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true)};
 },[open]);
 useEffect(()=>{if(!open)return;const outside=event=>{if(!trigger.current?.contains(event.target)&&!panel.current?.contains(event.target))close()};document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside)}},[open]);
 useEffect(()=>{if(!open)return;const escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();trigger.current?.focus()}};document.addEventListener('keydown',escape,true);return()=>document.removeEventListener('keydown',escape,true)},[open]);
 useEffect(()=>{if(open)panel.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'})},[open,active]);
 const key=event=>{
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();if(!open){show();return}const step=['ArrowUp','End'].includes(event.key)?-1:1;let next=event.key==='Home'?0:event.key==='End'?options.length-1:active+step;while(next>=0&&next<options.length&&options[next].disabled)next+=step;if(next>=0&&next<options.length)setActive(next);return}
  if(event.key==='Enter'||event.key===' '){event.preventDefault();open?choose(active):show();return}
  if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();return}
  if(event.key==='Tab'){close();return}
  if(event.key.length===1&&!event.ctrlKey&&!event.metaKey){const at=Date.now(),text=(at-typed.current.at<750?typed.current.text:'')+event.key;typed.current={text,at};const next=options.findIndex(option=>!option.disabled&&String(option.label).toLocaleLowerCase('ru').startsWith(text.toLocaleLowerCase('ru')));if(next>=0){event.preventDefault();if(!open)show();setActive(next)}}
 };
 const portal=trigger.current?.closest('.modal-backdrop')||document.body;
 const text=multiple?options.filter(option=>selectedValues.has(option.value)).map(option=>option.label).join(', '):options[selected]?.label;
 return <span className="anchored-select" style={style}><select {...props} ref={native} className="sr-only anchored-select-native" aria-hidden="true" tabIndex={-1} value={value} multiple={multiple} disabled={disabled} required={required} onChange={onChange} onInvalid={event=>{event.preventDefault();setInvalid(true);trigger.current.focus()}}>{children}</select><button {...props} id={undefined} ref={trigger} type="button" role="combobox" className={`anchored-select-trigger ${className}`} disabled={disabled} aria-required={required||undefined} aria-invalid={invalid||undefined} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} aria-activedescendant={open?`${id}-${active}`:undefined} onClick={()=>open?close():show()} onKeyDown={key}><span>{text||'—'}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>{open&&position&&createPortal(<div ref={panel} id={id} role="listbox" aria-label={props['aria-label']||'Варианты'} aria-multiselectable={multiple||undefined} className="anchored-select-options" style={position} onMouseDown={event=>event.preventDefault()}>{options.map((option,index)=><button key={option.value} id={`${id}-${index}`} data-index={index} type="button" role="option" aria-selected={selectedValues.has(option.value)} disabled={option.disabled} tabIndex={-1} className={index===active?'is-active':''} onPointerMove={()=>setActive(index)} onClick={event=>{event.stopPropagation();choose(index)}}>{multiple&&<span aria-hidden="true" className="anchored-select-check">{selectedValues.has(option.value)?'✓':''}</span>}{option.label}</button>)}</div>,portal)}</span>;
}

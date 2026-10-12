import {useState,useRef,useEffect,useLayoutEffect,useId} from 'react';
import {dateLabel,statuses} from '../shared.js';
import {WEDDING_STAGES,STAGE_STATUSES,weddingStage,weddingProgress} from '../wedding-control.js';
import {Icon} from './Mark.jsx';
import {SafeForm,FormField} from './Modal.jsx';
import {usePopover} from './usePopover.js';

function StagePopover({project,stage,onClose,onSave,panelRef,hostRef,triggerRef,commentInput,id}) {
  const saved=weddingStage(project.data.weddingControl,stage.id),canEdit=project.canManageWeddingControl;
  const [editing,setEditing]=useState(canEdit&&saved.status==='open'&&!saved.notRequired);
  const [draft,setDraft]=useState({...saved,status:saved.status==='open'&&!saved.notRequired?'done':saved.status});
  const [busy,setBusy]=useState(false);
  const [position,setPosition]=useState(null),live=useRef(false);
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[]);
  useEffect(()=>{if(editing)commentInput.current?.focus();else panelRef.current?.querySelector('button')?.focus()},[editing,commentInput,panelRef]);
  useLayoutEffect(()=>{
    const measure=()=>{
      const panel=panelRef.current,trigger=triggerRef.current,host=hostRef.current;
      if(!panel||!trigger||!host)return;
      const anchor=trigger.getBoundingClientRect(),container=host.getBoundingClientRect(),width=panel.offsetWidth,height=panel.scrollHeight,vw=document.documentElement.clientWidth,vh=window.innerHeight;
      const header=document.querySelector('.v2-topbar')?.getBoundingClientRect(),dock=document.querySelector('.v2-bottom-nav')?.getBoundingClientRect();
      const topEdge=header?.width?Math.max(0,header.bottom):0,bottomEdge=dock?.width?Math.min(vh,dock.top):vh;
      const below=Math.max(0,bottomEdge-anchor.bottom-12),above=Math.max(0,anchor.top-topEdge-12),up=below<height&&above>below,available=Math.max(80,up?above:below),visibleHeight=Math.min(height,available);
      const top=Math.max(topEdge+6,Math.min(up?anchor.top-visibleHeight-6:anchor.bottom+6,bottomEdge-visibleHeight-6));
      const next={left:Math.max(8,Math.min(anchor.left,vw-width-8))-container.left,top:top-container.top,maxHeight:available};
      setPosition(previous=>previous&&Object.keys(next).every(key=>previous[key]===next[key])?previous:next);
    };
    measure();const observer=new ResizeObserver(measure);if(panelRef.current)observer.observe(panelRef.current);
    window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true)};
  },[editing,panelRef,hostRef,triggerRef]);
  return <section ref={panelRef} id={id} className="wedding-stage-popover" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} style={position||{visibility:'hidden'}}>
    <header className="wedding-popover-header"><h3 id={`${id}-title`}>{stage.emoji} {stage.name}</h3><div>{!editing&&canEdit&&<button type="button" className="icon-button wedding-note-edit" aria-label={`Изменить этап ${stage.name}`} onClick={()=>setEditing(true)}><Icon name="pencil"/></button>}<button type="button" className="icon-button" aria-label="Закрыть комментарий" disabled={busy} onClick={()=>onClose(true)}><Icon name="close"/></button></div></header>
    {editing?<SafeForm className="form-stack wedding-stage-form" onSubmit={async()=>{setBusy(true);try{await onSave({stage:{id:stage.id,status:draft.status,comment:draft.comment,notRequired:draft.notRequired}});if(live.current)onClose(true)}finally{if(live.current)setBusy(false)}}}>
      <p className="wedding-note-project">{project.data.name}</p>
      <fieldset className="wedding-stage-statuses"><legend>Состояние этапа</legend>{Object.entries(STAGE_STATUSES).map(([key,label])=><label key={key} className={`wedding-status-choice is-${key} ${draft.status===key&&!draft.notRequired?'is-selected':''}`}><input type="radio" name="stage-status" value={key} checked={draft.status===key} disabled={draft.notRequired||busy} onChange={()=>setDraft({...draft,status:key})}/><span>{label}</span></label>)}</fieldset>
      <FormField label={draft.status==='problem'&&!draft.notRequired?'Что нужно решить':'Комментарий'}><textarea ref={commentInput} rows={3} maxLength={8000} disabled={busy} required={draft.status==='problem'&&!draft.notRequired} placeholder="Кто выбран, что согласовано, важные детали…" value={draft.comment} onChange={e=>setDraft({...draft,comment:e.target.value})}/></FormField>
      <label className="wedding-stage-optional"><input type="checkbox" checked={draft.notRequired} disabled={busy} onChange={e=>setDraft({...draft,notRequired:e.target.checked})}/>Не требуется для этой свадьбы</label>
      <div className="dialog-actions"><button type="button" className="button quiet" disabled={busy} onClick={()=>onClose(true)}>Отмена</button><button className="button" disabled={busy}>{busy?'Сохраняем…':'Сохранить'}</button></div>
    </SafeForm>:<div className="wedding-note-view"><p className="wedding-note-project">{project.data.name}</p><span className={`wedding-note-status is-${saved.notRequired?'open':saved.status}`}>{saved.notRequired?'Не требуется':STAGE_STATUSES[saved.status]}</span><p className="wedding-note-text">{saved.comment||'Комментарий пока не добавлен.'}</p>{saved.updatedAt&&<small className="quiet-copy">Обновлено {new Date(saved.updatedAt).toLocaleDateString('ru-RU')}</small>}</div>}
  </section>;
}

export function WeddingStatusCard({project,onOpen,onEdit,onSave,onTemplate}) {
  const d=project.data||project,control=d.weddingControl;
  const progress=weddingProgress(control),[selected,setSelected]=useState(null);
  const trigger=useRef(null),commentInput=useRef(null),popoverId=useId();
  const closeStage=restore=>{setSelected(null);if(restore)trigger.current?.focus()};
  const popover=usePopover(!!selected,closeStage,trigger,commentInput);
  const hasControl=control!==undefined;
  const [menuOpen,setMenuOpen]=useState(false),menuTrigger=useRef(null),menuId=useId();
  const menu=usePopover(menuOpen,()=>setMenuOpen(false),menuTrigger);
  const venue=weddingStage(control,'venue');
  const venueLabel=d.location||(venue.notRequired?'Площадка не требуется':venue.status==='done'?'Площадка выбрана':venue.status==='problem'?'Площадка требует внимания':'Площадка ещё не выбрана');
  const renderStage=stage=>{const state=weddingStage(control,stage.id),label=state.notRequired?'Не требуется':STAGE_STATUSES[state.status];return <button type="button" key={stage.id} className={`wedding-sticker is-${state.notRequired?'optional':state.status}`} aria-label={`${stage.name}: ${label}`} aria-haspopup="dialog" aria-expanded={selected?.id===stage.id} aria-controls={selected?.id===stage.id?popoverId:undefined} title={`${stage.name} · ${label}${state.comment?' · Есть комментарий':''}`} onClick={event=>{trigger.current=event.currentTarget;setSelected(selected?.id===stage.id?null:stage)}}><span className="wedding-sticker-art" aria-hidden="true">{stage.emoji}</span></button>};
  return <article className={`project-card wedding-status-card ${selected?'has-stage-popover':''}`}>
    <div className="project-card-top"><span className={`status-badge ${d.status||'planning'}`}><span className={`status-dot ${d.status||'planning'}`}/>{statuses[d.status]||'Подготовка'}</span>{(onEdit||onTemplate)&&<div ref={menu.host} className="wedding-actions-anchor"><button ref={menuTrigger} type="button" className="icon-button wedding-properties" onClick={()=>setMenuOpen(!menuOpen)} aria-label={`Меню свадьбы ${d.name}`} aria-expanded={menuOpen} aria-controls={menuOpen?menuId:undefined} title="Действия со свадьбой"><Icon name="more"/></button>{menuOpen&&<div ref={menu.panel} id={menuId} className="wedding-actions-menu">{onEdit&&<button type="button" onClick={()=>{setMenuOpen(false);onEdit()}}>Изменить свадьбу</button>}{onTemplate&&<button type="button" onClick={()=>{setMenuOpen(false);onTemplate()}}>Сохранить как шаблон</button>}</div>}</div>}</div>
    {hasControl&&<div ref={popover.host} className="wedding-stickers" role="group" aria-label="Этапы свадьбы">{WEDDING_STAGES.map(renderStage)}{selected&&<StagePopover key={`${project.id}:${selected.id}`} id={popoverId} project={project} stage={selected} panelRef={popover.panel} hostRef={popover.host} triggerRef={trigger} commentInput={commentInput} onClose={closeStage} onSave={changes=>onSave(project,changes)}/>}</div>}
    <button className="project-open wedding-card-identity" onClick={onOpen}><h2>{d.name}</h2><p><Icon name="calendar"/>{dateLabel(d.date)}</p><p><Icon name="venue"/>{venueLabel}</p></button>
    {hasControl&&<div className="wedding-card-control"><div className="wedding-progress-heading"><strong>{progress.percent}%</strong></div><div className="wedding-progress" role="progressbar" aria-label={`Готовность свадьбы ${d.name}`} aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${progress.percent}%`}}/></div></div>}
    <button type="button" className="project-card-foot wedding-card-open" onClick={onOpen}>Открыть свадьбу <Icon name="arrow"/></button>
  </article>;
}

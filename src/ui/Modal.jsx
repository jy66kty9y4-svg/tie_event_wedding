import { useEffect, useRef, useState } from 'react';

export function Modal({ title, children, onClose, wide = false }) {
  const root=useRef(null),dirty=useRef(false),closeRef=useRef(onClose);closeRef.current=onClose;
  const requestClose=()=>{if(!dirty.current||window.confirm('Закрыть без сохранения изменений?'))closeRef.current();};
  useEffect(()=>{
    const previous=document.activeElement,host=root.current;
    const focusable=()=>[...host.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(e=>e.getClientRects().length);
    const first=host.querySelector('[autofocus]')||focusable()[0];first?.focus();
    const key=e=>{if(e.key==='Escape'){e.preventDefault();requestClose();}if(e.key==='Tab'){const all=focusable(),first=all[0],last=all.at(-1);if(!all.length){e.preventDefault();host.focus();}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
    host.addEventListener('keydown',key);return()=>{host.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>event.currentTarget===event.target&&requestClose()}>
    <section ref={root} tabIndex={-1} className={`modal ${wide?'modal-wide':''}`} role="dialog" aria-modal="true" aria-label={title} onChangeCapture={()=>{dirty.current=true}} onClickCapture={event=>{const button=event.target.closest('button');if(button&&button.textContent.trim()==='Отмена'&&dirty.current&&!window.confirm('Закрыть без сохранения изменений?')){event.preventDefault();event.stopPropagation();}}}>
      <header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={requestClose} aria-label="Закрыть">×</button></header>{children}
    </section>
  </div>;
}

export function FormField({ label, hint, children }) {
  return <label className="form-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ConfirmDialog({ title = 'Подтвердите действие', children, confirm = 'Подтвердить', danger = false, onConfirm, onClose }) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <Modal title={title} onClose={onClose}><div className="dialog-body">{children}{error&&<p className="form-error">{error}</p>}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>Отмена</button><button disabled={busy} className={`button ${danger ? 'danger' : ''}`} onClick={async()=>{setBusy(true);try{await onConfirm()}catch(e){setError(e.message)}finally{setBusy(false)}}}>{busy?'Сохраняем…':confirm}</button></div></div></Modal>;
}

export function SafeForm({onSubmit,children,...props}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <form {...props} aria-busy={busy} onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{await onSubmit(event)}catch(error){setError(error.message||'Не удалось сохранить')}finally{setBusy(false)}}}>{children}{error&&<p className="form-error" role="alert">{error}</p>}</form>;
}

import { useEffect, useRef, useState } from 'react';

export function Modal({ title, children, onClose, wide = false }) {
  const close = useRef(null);
  useEffect(() => {
    const onKey = event => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.currentTarget === event.target && onClose()}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <header className="modal-header"><h2 id="dialog-title">{title}</h2><button ref={close} className="icon-button" onClick={onClose} aria-label="Закрыть">×</button></header>
      {children}
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

import { useEffect, useRef } from 'react';

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
  return <Modal title={title} onClose={onClose}><div className="dialog-body">{children}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>Отмена</button><button className={`button ${danger ? 'danger' : ''}`} onClick={onConfirm}>{confirm}</button></div></div></Modal>;
}

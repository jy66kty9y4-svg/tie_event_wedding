import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Modal} from './Modal.jsx';
export function InlineFinanceForm({targetId,title,onClose,children}){
  const [target,setTarget]=useState(undefined);
  useEffect(()=>{const host=document.getElementById(targetId);setTarget(host||null);if(host){host.scrollIntoView({block:'center',behavior:'smooth'});setTimeout(()=>host.querySelector('input,select')?.focus(),0)}},[targetId]);
  if(target===undefined)return null;
  if(!target)return <Modal title={title} onClose={onClose}>{children}</Modal>;
  return createPortal(<div className="sheet-column-editor"><header className="panel-header"><h3>{title}</h3><button type="button" className="icon-button" aria-label="Закрыть форму" onClick={onClose}>×</button></header>{children}</div>,target);
}

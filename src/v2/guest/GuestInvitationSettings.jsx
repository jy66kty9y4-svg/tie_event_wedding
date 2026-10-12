import React,{useState} from 'react';
import {personalInvitationsEnabled} from '../../guest-blueprint.js';
import './guest-sheet.css';

export function GuestInvitationSettings({state,projectId,run}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!state.canManageGuestInvitations) return null;
  const enabled=personalInvitationsEnabled(state.project);
  const toggle=async()=>{
    setBusy(true);setError('');
    try{await run('guestInvitations.settings',{projectId,version:state.project.version,enabled:!enabled})}
    catch(cause){setError(cause.message||'Не удалось изменить настройку')}
    finally{setBusy(false)}
  };
  return <section className="guest-invitation-settings" aria-label="Настройка персональных приглашений">
    <div><h2>Персональные приглашения</h2><p>После включения пара сможет создавать ссылки для своих гостей. При выключении ссылки временно перестают работать.</p>{error&&<p role="alert" className="guest-sheet-error">{error}</p>}</div>
    <button type="button" role="switch" aria-label="Персональные приглашения" aria-checked={enabled} disabled={busy} onClick={toggle}><span aria-hidden="true"/>{enabled?'ВКЛ':'ВЫКЛ'}</button>
  </section>;
}

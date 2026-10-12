import {useEffect,useRef,useState} from 'react';
import {useV2Data} from '../v2/calendar/Workspace.jsx';
import {Icon} from './Mark.jsx';

export function NotificationPopover({state,run,navigate,onClose,onUnreadChange,panelRef}){
 const[onlyUnread,setOnlyUnread]=useState(false),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[commandError,setCommandError]=useState('');
 const live=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[]);
 const {data,error,reload}=useV2Data(`/api/v2/notifications?${new URLSearchParams({offset:String(offset),...(onlyUnread?{unread:'true'}:{})})}`,state.time);
 useEffect(()=>{if(data)onUnreadChange(data.unread)},[data,onUnreadChange]);
 const execute=async(op,body,after)=>{
  setBusy(true);setCommandError('');
  try{await run(op,body);if(!live.current)return;await reload();if(live.current)await after?.()}catch(e){if(live.current)setCommandError(e.message)}finally{if(live.current)setBusy(false)}
 };
 const follow=async notification=>{if(notification.data.actionUrl){const accepted=await navigate(notification.data.actionUrl);if(accepted!==false)onClose()}else onClose()};
 return <section ref={panelRef} id="cabinet-notifications" className="notification-popover" role="dialog" aria-modal="false" aria-labelledby="notification-title">
  <header className="notification-popover-header"><div><h2 id="notification-title">Уведомления</h2><span>{data?.unread??0} непрочитанных</span></div><button type="button" className="icon-button" aria-label="Закрыть уведомления" onClick={onClose}><Icon name="close"/></button></header>
  <div className="notification-popover-controls"><label><input type="checkbox" checked={onlyUnread} onChange={e=>{setOnlyUnread(e.target.checked);setOffset(0)}}/>Только непрочитанные</label><button type="button" className="text-button" disabled={busy||!data?.unread} onClick={()=>execute('notification.readAll',{})}>Прочитать всё</button></div>
  {(error||commandError)&&<p className="notification-popover-error" role="alert">{commandError||error}</p>}
  <div className="notification-popover-list" aria-busy={busy||!data&&!error}>
   {!data&&!error?<p className="quiet-copy">Загружаем уведомления…</p>:data?.items.length?data.items.map(n=><article className={`notification-popover-row ${n.data.readAt?'':'is-unread'}`} key={n.id}>
    <span className="notification-source" aria-hidden="true"><Icon name={n.data.templateKey==='account.registered'?'applications':n.data.sourceKind==='task'?'tasks':n.data.sourceKind==='approval'?'approvals':'calendar'}/></span>
    <div className="notification-copy"><strong>{n.data.title}</strong><p>{n.data.body}</p><time dateTime={n.data.createdAt||n.updated_at}>{new Date(n.data.createdAt||n.updated_at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></div>
    <button type="button" className="icon-button notification-follow" disabled={busy} aria-label={`Перейти: ${n.data.title}`} title="Перейти к событию" onClick={()=>execute('notification.read',{entityId:n.id},()=>follow(n))}><Icon name="arrow"/></button>
   </article>):<p className="quiet-copy">{onlyUnread?'Непрочитанных уведомлений нет.':'Уведомлений пока нет.'}</p>}
  </div>
  {(offset>0||data?.nextOffset)&&<footer className="notification-popover-footer"><button type="button" className="text-button" disabled={!offset||busy} onClick={()=>setOffset(Math.max(0,offset-50))}>Назад</button><button type="button" className="text-button" disabled={!data?.nextOffset||busy} onClick={()=>setOffset(data.nextOffset)}>Показать ещё</button></footer>}
 </section>;
}

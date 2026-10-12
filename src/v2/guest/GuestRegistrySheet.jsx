import {GUEST_ACTIONS_COLUMN} from '../../sheet.js';
import React, {useEffect, useRef, useState} from 'react';
import {downloadGuestsXlsx} from '../../export-workbooks.js';
import {readableGuestField} from './readable.mjs';
import './guest-sheet.css';
import {countGuestsWithFoodRestrictions,personalInvitationsEnabled} from '../../guest-blueprint.js';
import {GuestInvitationSettings} from './GuestInvitationSettings.jsx';
import {ConfirmDialog} from '../../ui/Modal.jsx';
import {SheetDraftRow} from '../../ui/SheetDraftRow.jsx';
import {TableEditor} from '../../ui/ProjectTools.jsx';
import {SheetCell} from '../../ui/SheetCell.jsx';
import {ResizeHandle} from '../../ui/SheetLayout.jsx';
import {useTableScope,useTableView} from '../../ui/useTableView.js';
import {SheetZoom} from '../../ui/SheetZoom.jsx';

const responseLabels = {unanswered:'Нет ответа', confirmed:'Приду', declined:'Не смогу', tentative:'Пока не знаю'};
const guestRows = (state, table) => (state.entities || []).filter(item => item.kind === 'row' && item.parent_id === table.id && !item.deleted).sort((a,b)=>{const order=table.data.rowOrder||[],pos=id=>order.includes(id)?order.indexOf(id):1e9;return pos(a.id)-pos(b.id)||(a.sheetOrder??0)-(b.sheetOrder??0)});
const displayName = (row, nameId) => String(row.data?.[nameId] || 'Без имени');
const responseOf = (row, map) => {
  const value = row.data?.[map.rsvpStatus];
  return Object.entries(map.rsvpValues || {}).find(([, label]) => label === value)?.[0]
    || (['confirmed', 'declined', 'tentative'].includes(value) ? value : 'unanswered');
};
const invitationLabel = invite => invite.status === 'revoked' ? 'Отозвана' : invite.status === 'expired' ? 'Срок истёк' : 'Выдана';

function InviteSelectionHeader({rows, selected, setSelected}) {
  const control = useRef(null);
  const ids = rows.map(row => row.id);
  const selectedCount = ids.filter(id => selected.has(id)).length;
  useEffect(() => { if (control.current) control.current.indeterminate = selectedCount > 0 && selectedCount < ids.length; }, [selectedCount, ids.length]);
  const change = checked => setSelected(previous => {
    const next = new Set(previous);
    for (const id of ids) checked ? next.add(id) : next.delete(id);
    return next;
  });
  return <label className="guest-sheet-select-all" title="Отметьте гостей, которым нужна общая ссылка"><input ref={control} type="checkbox" disabled={!ids.length} checked={Boolean(ids.length) && selectedCount === ids.length} onChange={event => change(event.target.checked)}/><span>Для ссылки</span></label>;
}

export function GuestRegistrySheet(props) {
  const view=useTableScope(props.table.id,props.projectId);
  return <GuestSheetForDevice key={view.key} {...props} view={view}/>;
}
function GuestSheetForDevice({view,state, projectId, run, refresh, navigate, sourceId, can = () => false, table, mappingSetup}) {
  const map = table.data.semanticMap || {};
  const columns = (table.data.columns || []).filter(column => !(table.data.hiddenColumns||[]).includes(column.id) && column.id !== map.seatIndex && column.id !== map.seatingTable).map(column => ({...column,...(column.id===map.rsvpStatus?{allowEmpty:false,defaultValue:map.rsvpValues?.unanswered,optionLabels:Object.fromEntries(Object.entries(map.rsvpValues||{}).map(([key,value])=>[value,responseLabels[key]]))}:{}), readable:row => readableGuestField(can, table, row, column.id)}));
  const structureColumns = (table.data.columns || []).filter(column => column.id !== map.seatIndex && column.id !== map.seatingTable);
  const nameId = map.guestName || columns.find(column => column.id === 'name')?.id || columns.find(column => column.type === 'text')?.id;
  const all = guestRows(state, table);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [plusOne, setPlusOne] = useState(new Set());
  const [expiry, setExpiry] = useState('');
  const [link, setLink] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [localInvites, setLocalInvites] = useState([]);
  const [deleting,setDeleting]=useState(null);
  const focusedRow = useRef(null);
  const canAdd = Boolean(nameId) && can('create', table.id, null, nameId);
  const canStructure = can('structure', table.id);
  const viewColumns=[...columns.map(c=>c.id===nameId?{...c,desktopWidth:260}:c),{id:GUEST_ACTIONS_COLUMN,type:'actions',viewWidth:160,desktopWidth:160}];
  const {table:tableRef,layout,resize,scaleKey,initialScale,defaultFit}=useTableView({...view,columns:viewColumns,sheet:table.data,revision:all,onLayout:async(axis,key,value)=>{try{await run('sheet.layout',{projectId,entityId:table.id,axis,key,value});setError('')}catch(cause){setError(cause.message);throw cause}}});
  const widths=columns.map(column=>layout.columnWidths?.[column.id]||(column.id===nameId?260:180));
  const actionsWidth=layout.columnWidths?.[GUEST_ACTIONS_COLUMN]||160;
  const canDelete=canAdd||all.some(row=>can('delete',table.id,row.id));
  const canInvite = personalInvitationsEnabled(state.project) && Boolean(map.rsvpStatus) && Array.isArray(state.guestInvites);
  const canViewStatus = Boolean(map.rsvpStatus) && all.some(row => readableGuestField(can, table, row, map.rsvpStatus));
  const foodFields=[...new Set([map.allergies,map.diet].filter(Boolean))];
  const canViewFood=foodFields.some(field=>all.length?all.some(row=>readableGuestField(can,table,row,field)):can('read',table.id,null,field));
  const foodRestricted=canViewFood?countGuestsWithFoodRestrictions(all,map,(row,field)=>readableGuestField(can,table,row,field)):null;
  useEffect(()=>{if(!canInvite){setSelected(new Set());setPlusOne(new Set());setLink('');setLocalInvites([])}},[canInvite]);
  const canViewSeats = Boolean(map.seatingTable) && all.some(row => readableGuestField(can, table, row, map.seatingTable));
  const visible = all.filter(row => {
    const words = columns.filter(column => readableGuestField(can, table, row, column.id)).map(column => String(row.data[column.id] || '')).join(' ').toLocaleLowerCase('ru');
    return (!query || words.includes(query.toLocaleLowerCase('ru'))) && (filter === 'all' || readableGuestField(can, table, row, map.rsvpStatus) && responseOf(row, map) === filter);
  });
  const toggle = (setter, id) => setter(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  useEffect(() => { const row = all.find(item => item.id === sourceId); if (!row) return; setQuery(displayName(row, nameId)); setTimeout(() => focusedRow.current?.scrollIntoView({block:'center'}), 0); }, [sourceId, table.id]);
  const saveCell = async (row,column,value,format,formatOnly=false) => {
    await run('entity.edit',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,data:formatOnly?{}:{[column.id]:value},formats:{[column.id]:format},formatOnly,expectedValue:value});
  };
  const deleteGuest=async row=>{
    await run('entity.delete',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,confirm:true});
    setSelected(previous=>{const next=new Set(previous);next.delete(row.id);return next});setDeleting(null);
  };
  const saveStatus = async (row, value) => {
    setError('');
    try { await run('guest.rsvp.set', {projectId, guestTableId:table.id, schemaVersion:table.version, guestRowId:row.id, rowVersion:row.version, data:{values:{rsvp:value}}}); }
    catch (cause) { setError(cause.message || 'Не удалось изменить ответ'); }
  };
  const createGuest = async (data,formats) => {
    await run('entity.create', {projectId, kind:'row', parentId:table.id, schemaVersion:table.version, data,formats});
  };
  const saveColumns = async draft => {
    const nextStructureColumns=draft.columns;
    const keptIds = new Set(nextStructureColumns.map(column => column.id));
    const optionalMappings = Object.entries(map).filter(([key, value]) => key !== 'rsvpValues' && !['guestName','rsvpStatus','seatingTable','seatIndex'].includes(key) && typeof value === 'string');
    const disabled = optionalMappings.filter(([, columnId]) => !keptIds.has(columnId)).map(([key]) => key);
    let workingTable = table;
    if (disabled.length) workingTable = await run('guestMapping.save', {projectId, guestTableId:table.id, schemaVersion:table.version, data:{semanticMap:{disable:disabled}}, confirm:true});
    const workingMap = workingTable.data.semanticMap || {};
    const hiddenColumns = (workingTable.data.columns || []).filter(column => column.id === workingMap.seatIndex || column.id === workingMap.seatingTable);
    await run('entity.edit', {projectId, entityId:workingTable.id, version:workingTable.version, data:{...workingTable.data, confirmStructure:draft.confirmStructure, hiddenColumns:draft.hiddenColumns, columns:[...nextStructureColumns, ...hiddenColumns]}});
    await refresh?.();
  };
  const copyLink = async value => { try { await navigator.clipboard.writeText(value); setCopyStatus('Ссылка скопирована'); } catch { setCopyStatus('Скопируйте ссылку вручную'); } };
  const createInvite = async () => {
    setBusy(true); setError('');
    try {
      const result = await run('guestInvite.create', {projectId, guestTableId:table.id, schemaVersion:table.version, guestRowIds:[...selected], plusOneRowIds:[...plusOne].filter(id => selected.has(id)), expiresAt:expiry ? new Date(expiry).toISOString() : undefined});
      const value = `${location.origin}/w/${result.shareId || state.microsite?.shareId}#invite=${result.token}`;
      setLink(value); await copyLink(value);
      setLocalInvites(items => [{id:result.inviteId, version:result.version, rowIds:[...selected], expiresAt:result.expiresAt, status:'issued'}, ...items]);
      setSelected(new Set()); setPlusOne(new Set());
    } catch (cause) { setError(cause.message || 'Не удалось создать приглашение'); }
    finally { setBusy(false); }
  };
  const inviteAction = async (kind, invite) => {
    if (!window.confirm(kind === 'rotate' ? 'Старая ссылка перестанет работать. Перевыпустить?' : 'Гости больше не смогут открыть ссылку. Отозвать?')) return;
    setBusy(true); setError('');
    try {
      if (kind === 'rotate') {
        const result = await run('guestInvite.rotate', {projectId, inviteId:invite.id, version:invite.version, schemaVersion:table.version, expiresAt:expiry ? new Date(expiry).toISOString() : undefined});
        const value = `${location.origin}/w/${result.shareId || state.microsite?.shareId}#invite=${result.token}`;
        setLink(value); await copyLink(value);
      } else await run('guestInvite.revoke', {projectId, inviteId:invite.id, version:invite.version});
    } catch (cause) { setError(cause.message || 'Не удалось изменить приглашение'); }
    finally { setBusy(false); }
  };
  const confirmed = canViewStatus ? all.filter(row => readableGuestField(can, table, row, map.rsvpStatus) && responseOf(row, map) === 'confirmed').length : null;
  const pending = canViewStatus ? all.filter(row => readableGuestField(can, table, row, map.rsvpStatus) && ['unanswered','tentative'].includes(responseOf(row, map))).length : null;
  const seated = canViewSeats ? all.filter(row => readableGuestField(can, table, row, map.seatingTable) && row.data[map.seatingTable]).length : null;
  const invitations = state.guestInvites || localInvites;
  return <section className="guest-sheet-page" aria-label="Список гостей">
    <header className="guest-sheet-heading"><div><p className="guest-sheet-eyebrow">Список приглашённых</p><h1>Гости</h1><p>Добавляйте людей и заполняйте данные прямо в строках. Изменение ячейки сохраняется после выхода из неё.</p></div><div className="guest-sheet-header-actions"><button onClick={() => downloadGuestsXlsx(state)}>Скачать Excel</button><button onClick={() => navigate?.(`/app/projects/${projectId}/tables/${table.id}`)}>Полный реестр</button><button onClick={() => navigate?.(`/app/projects/${projectId}/seating`)}>Рассадка</button></div></header>
    <GuestInvitationSettings state={state} projectId={projectId} run={run}/>
    <div className="guest-sheet-stats" aria-label="Статистика гостей"><span><strong>{all.length}</strong> гостей</span><span><strong>{confirmed ?? '—'}</strong> подтвердили</span><span><strong>{pending ?? '—'}</strong> ждут ответа</span><span><strong>{seated ?? '—'}</strong> рассажены</span><span><strong>{foodRestricted ?? '—'}</strong> с пищевыми аллергиями / ограничениями</span></div>
    <div className="guest-sheet-tools"><label>Поиск<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Имя, контакт или примечание"/></label>{canViewStatus && <label>Ответ<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Все ответы</option>{Object.entries(responseLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>}{canStructure && <button className="guest-sheet-columns-button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(open => !open)}>Колонки</button>}<button className="guest-sheet-add" disabled={!canAdd} onClick={() => {setAdding(true); setFilter('all'); setQuery('');}}>+ Добавить гостя</button></div>
    {columnsOpen && <TableEditor inline simple table={{...table,data:{...table.data,columns:structureColumns}}} rowCount={all.length} protectedIds={[nameId,map.rsvpStatus].filter(Boolean)} requiredVisibleIds={[nameId]} removedColumns={table.data.deletedColumns||[]} onSave={saveColumns} onClose={() => setColumnsOpen(false)}/>}
    <p className="sheet-help">Выделите текст или нажмите правой кнопкой для форматирования. Потяните границы колонок и строк, чтобы изменить размер.</p>
    {error && <p className="guest-sheet-error" role="alert">{error}</p>}
    {!nameId ? <p className="guest-sheet-error">В реестре нет текстового поля для имени. Откройте полный реестр и добавьте его.</p> : <SheetZoom minScale={.1} storageKey={scaleKey} initialScale={initialScale} defaultFit={defaultFit} label="Таблица гостей" controlsLabel="Масштаб таблицы" className="guest-sheet-scroll"><table ref={tableRef} data-table-device={view.device} className="guest-sheet-table excel-sheet" style={{width:46+widths.reduce((a,b)=>a+b,0)+(canInvite?110:0)+(canViewSeats?180:0)+(canDelete?actionsWidth:0)}}><colgroup><col style={{width:46}}/>{canInvite&&<col style={{width:110}}/>}{columns.map((column,i)=><col key={column.id} style={{width:widths[i]}}/>)}{canViewSeats&&<col style={{width:180}}/>}{canDelete&&<col style={{width:actionsWidth}}/>}</colgroup><thead><tr><th className="sheet-index">№</th>{canInvite && <th className="guest-sheet-select-col"><InviteSelectionHeader rows={visible} selected={selected} setSelected={setSelected}/></th>}{columns.map((column,i) => <th key={column.id} className={column.id === nameId ? 'guest-sheet-name-col' : ''} data-column-id={column.id}>{column.name}{canStructure&&<ResizeHandle axis="columnWidths" id={column.id} label={column.name} value={widths[i]} onResize={resize}/>}</th>)}{canViewSeats && <th>Стол</th>}{canDelete&&<th className="guest-sheet-actions">Действия{canStructure&&<ResizeHandle axis="columnWidths" id={GUEST_ACTIONS_COLUMN} label="Действия" value={actionsWidth} onResize={resize}/>}</th>}</tr></thead><tbody>
      {visible.map((row,i) => <tr key={row.id} data-row-id={row.id} style={{height:layout.rowHeights?.[row.id]||44}} ref={sourceId === row.id ? focusedRow : null} className={sourceId === row.id ? 'is-addressed' : ''}><td className="sheet-index">{i+1}{canStructure&&<ResizeHandle axis="rowHeights" id={row.id} label={i+1} value={layout.rowHeights?.[row.id]||44} onResize={resize}/>}</td>{canInvite && <td className="guest-sheet-select-col"><label><input type="checkbox" aria-label={`Добавить ${displayName(row, nameId)} в ссылку`} checked={selected.has(row.id)} onChange={() => toggle(setSelected, row.id)}/>{selected.has(row.id) && <span className="guest-sheet-plus"><input type="checkbox" aria-label={`Плюс один для ${displayName(row, nameId)}`} checked={plusOne.has(row.id)} onChange={() => toggle(setPlusOne, row.id)}/>+1</span>}</label></td>}{columns.map(column => <td key={column.id} data-sheet-column={column.id} className={column.id === nameId ? 'guest-sheet-name-col' : ''} data-column-id={column.id}>{column.readable(row)?<SheetCell row={row} column={column} label={`${column.name}: ${displayName(row,nameId)}`} required={column.id===nameId} editable={can('edit',table.id,row.id,column.id)} relationRows={state.entities||[]} files={(state.entities||[]).filter(r=>r.kind==='file'&&!r.deleted)} members={state.assignableMembers||state.members||[]} onSave={(value,format,formatOnly)=>column.id===map.rsvpStatus&&!formatOnly?saveStatus(row,Object.entries(map.rsvpValues||{}).find(([,label])=>label===value)?.[0]||value):saveCell(row,column,value,format,formatOnly)}/>:<span>Нет доступа</span>}</td>)}{canViewSeats && <td className="guest-sheet-seat">{readableGuestField(can, table, row, map.seatingTable) ? (state.entities || []).find(item => item.id === row.data[map.seatingTable])?.data?.label || 'Без места' : 'Нет доступа'}</td>}{canDelete&&<td>{can('delete',table.id,row.id)&&<button type="button" className="text-button danger-text" onClick={()=>setDeleting(row)}>Удалить</button>}</td>}</tr>)}
      {!visible.length && <tr><td colSpan={columns.length + 1+(canInvite?1:0)+(canViewSeats?1:0)+(canDelete?1:0)} className="guest-sheet-empty">{all.length ? 'По вашему запросу гостей нет. Измените поиск или фильтр.' : 'Список пока пуст. Нажмите «Добавить гостя» и начните с имени.'}</td></tr>}
      {adding && <SheetDraftRow columns={columns.map(c=>c.id===map.rsvpStatus?{...c,computed:true}:c)} initialValues={map.rsvpStatus?{[map.rsvpStatus]:map.rsvpValues?.unanswered||'Не отправлено'}:{}} requiredIds={[nameId]} leading={canInvite?1:0} trailing={(canViewSeats?1:0)+(canDelete?1:0)} canEdit={column=>column.id!==map.rsvpStatus&&can('create',table.id,null,column.id)} relationRows={state.entities||[]} files={(state.entities||[]).filter(r=>r.kind==='file'&&!r.deleted)} members={state.assignableMembers||state.members||[]} onSave={createGuest} onCancel={() => setAdding(false)} label="Новый гость" saveLabel="Сохранить гостя" keepOpen/>}
    </tbody></table></SheetZoom>}
    {canInvite && <section className="guest-sheet-invites"><div className="guest-sheet-invite-bar"><div><h2>Приглашения</h2><p>Выберите гостей галочками в таблице, затем создайте одну ссылку для них.</p></div><label>Срок ссылки<input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)}/></label><button disabled={!selected.size || busy} onClick={createInvite}>Создать приглашение · {selected.size}</button></div>{link && <div className="guest-sheet-link" role="status"><strong>{copyStatus}</strong><code>{link}</code><button onClick={() => void copyLink(link)}>Скопировать ссылку</button></div>}{invitations.length > 0 && <details><summary>Выданные ссылки · {invitations.length}</summary><ul>{invitations.map(invite => <li key={invite.id}><span>{invite.recipientNames?.join(', ') || `${invite.rowIds?.length || invite.guestCount || '—'} гостей`} · {invitationLabel(invite)}</span><div><button disabled={busy || invite.status !== 'issued'} onClick={() => void inviteAction('rotate', invite)}>Перевыпустить</button><button disabled={busy || invite.status !== 'issued'} onClick={() => void inviteAction('revoke', invite)}>Отозвать</button></div></li>)}</ul></details>}</section>}
    {personalInvitationsEnabled(state.project) && !map.rsvpStatus && <details className="guest-sheet-mapping"><summary>Подключить ответы на приглашения</summary>{mappingSetup}</details>}
    {deleting&&<ConfirmDialog title="Удалить гостя" confirm="Удалить гостя" danger onClose={()=>setDeleting(null)} onConfirm={()=>deleteGuest(deleting)}><p>Удалить гостя «{displayName(deleting,nameId)}»? Его место в рассадке освободится. Запись можно восстановить из истории.</p></ConfirmDialog>}
  </section>;
}

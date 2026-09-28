import React, {useEffect, useRef, useState} from 'react';
import {downloadGuestsXlsx} from '../../export-workbooks.js';
import {readableGuestField} from './readable.mjs';
import './guest-sheet.css';

const responseLabels = {unanswered:'Нет ответа', confirmed:'Приду', declined:'Не смогу', tentative:'Пока не знаю'};
const editableTypes = new Set(['text', 'select', 'number', 'date', 'time', 'boolean', 'money', 'url']);
const guestRows = (state, table) => (state.entities || []).filter(item => item.kind === 'row' && item.parent_id === table.id && !item.deleted);
const displayName = (row, nameId) => String(row.data?.[nameId] || 'Без имени');
const responseOf = (row, map) => {
  const value = row.data?.[map.rsvpStatus];
  return Object.entries(map.rsvpValues || {}).find(([, label]) => label === value)?.[0]
    || (['confirmed', 'declined', 'tentative'].includes(value) ? value : 'unanswered');
};
const invitationLabel = invite => invite.status === 'revoked' ? 'Отозвана' : invite.status === 'expired' ? 'Срок истёк' : 'Выдана';
const columnTypeLabels = {text:'Текст', select:'Список', boolean:'Флажок', number:'Число', money:'Деньги', date:'Дата', time:'Время', url:'Ссылка', file:'Файл', relation:'Связь', formula:'Вычисление', users:'Участники'};
const customColumn = () => ({id:`guest_${globalThis.crypto?.randomUUID?.().slice(0, 8) || Date.now()}`, name:'Новая колонка', type:'text'});

function GuestCell({row, column, nameId, editable, onSave}) {
  const stored = column.type === 'money' && row.data?.[column.id] !== undefined ? String(row.data[column.id] / 100) : row.data?.[column.id] ?? '';
  const [value, setValue] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => { setValue(stored); setError(''); }, [stored, row.version]);
  const save = async next => {
    if (pending.current || String(next) === String(stored)) return;
    if (column.id === nameId && !String(next).trim()) { setError('Укажите имя гостя'); return; }
    pending.current = true;
    setBusy(true);
    setError('');
    try { await onSave(row, column, next); }
    catch (cause) { setError(cause.message || 'Не удалось сохранить'); }
    finally { pending.current = false; setBusy(false); }
  };
  const label = `${column.name}: ${displayName(row, nameId)}`;
  if (!column.readable(row)) return <span className="guest-sheet-readonly">Нет доступа</span>;
  if (!editable) return <span className="guest-sheet-readonly">{column.type === 'boolean' ? (stored ? 'Да' : 'Нет') : String(stored || '—')}</span>;
  if (column.type === 'select') return <><select aria-label={label} value={value} disabled={busy} onChange={event => { setValue(event.target.value); void save(event.target.value); }}><option value="">—</option>{(column.options || []).map(option => <option key={option} value={option}>{option}</option>)}</select>{error && <small role="alert">{error}</small>}</>;
  if (column.type === 'boolean') return <input type="checkbox" aria-label={label} checked={Boolean(value)} disabled={busy} onChange={event => { setValue(event.target.checked); void save(event.target.checked); }}/>;
  return <><input
    aria-label={label}
    type={['number', 'money', 'date', 'time', 'url'].includes(column.type) ? (column.type === 'money' ? 'number' : column.type) : 'text'}
    step={['number', 'money'].includes(column.type) ? 'any' : undefined}
    value={value}
    disabled={busy}
    onChange={event => setValue(event.target.value)}
    onBlur={() => { if (cancelled.current) { cancelled.current = false; return; } void save(value); }}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelled.current = true; setValue(stored); event.currentTarget.blur(); } }}
  />{error && <small role="alert">{error}</small>}</>;
}

function NewGuestRow({columns, nameId, statusId, canCreate, onCreate, onCancel}) {
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus(); }, []);
  const submit = async event => {
    event.preventDefault();
    if (!String(draft[nameId] || '').trim()) { setError('Укажите имя гостя'); nameRef.current?.focus(); return; }
    setBusy(true); setError('');
    try { await onCreate(Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== ''))); setDraft({}); nameRef.current?.focus(); }
    catch (cause) { setError(cause.message || 'Не удалось добавить гостя'); }
    finally { setBusy(false); }
  };
  return <tr className="guest-sheet-new"><td colSpan={columns.length + 2}><form onSubmit={submit}>
    <div className="guest-sheet-new-fields">{columns.filter(column => column.id !== statusId && canCreate(column.id)).map(column => <label key={column.id} className={column.type === 'boolean' ? 'guest-sheet-new-boolean' : undefined}><span>{column.name}</span>{column.type === 'select' ? <select value={draft[column.id] || ''} onChange={event => setDraft({...draft, [column.id]:event.target.value})}><option value="">—</option>{(column.options || []).map(option => <option key={option} value={option}>{option}</option>)}</select> : column.type === 'boolean' ? <span className="guest-sheet-check"><input aria-label={column.name} type="checkbox" checked={Boolean(draft[column.id])} onChange={event => setDraft({...draft, [column.id]:event.target.checked})}/> Да</span> : <input ref={column.id === nameId ? nameRef : undefined} type={['date','time','number','money','url'].includes(column.type) ? (column.type === 'money' ? 'number' : column.type) : 'text'} value={draft[column.id] || ''} onChange={event => setDraft({...draft, [column.id]:event.target.value})}/>}</label>)}</div>
    <div className="guest-sheet-new-actions"><button className="guest-sheet-save" disabled={busy}>Сохранить гостя</button><button type="button" onClick={onCancel}>Готово</button>{error && <small role="alert">{error}</small>}</div>
  </form></td></tr>;
}

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

function GuestColumnsEditor({columns, requiredIds, onSave, onClose}) {
  const [draft, setDraft] = useState(() => columns.map(column => ({...column, options:column.options ? [...column.options] : undefined})));
  const [initialIds] = useState(() => new Set(columns.map(column => column.id)));
  const [dragging, setDragging] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (index, patch) => setDraft(items => items.map((item, itemIndex) => itemIndex === index ? {...item, ...patch} : item));
  const move = (index, step) => setDraft(items => {
    const target = index + step;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const drop = target => {
    if (dragging === null || dragging === target) { setDragging(null); return; }
    setDraft(items => { const next = [...items], [item] = next.splice(dragging, 1); next.splice(target, 0, item); return next; });
    setDragging(null);
  };
  const submit = async event => {
    event.preventDefault();
    if (draft.some(column => !column.name.trim())) { setError('Назовите каждую колонку'); return; }
    setBusy(true); setError('');
    try { await onSave(draft); onClose(); }
    catch (cause) { setError(cause.message || 'Не удалось сохранить колонки'); }
    finally { setBusy(false); }
  };
  return <form className="guest-sheet-column-editor" onSubmit={submit}>
    <header><div><h2>Колонки таблицы</h2><p>Перетащите колонку за маркер ⋮⋮ или используйте стрелки. Удаление применится после сохранения.</p></div><button type="button" onClick={() => setDraft(items => [...items, customColumn()])}>+ Добавить колонку</button></header>
    <div className="guest-sheet-column-list">{draft.map((column, index) => {
      const existing = initialIds.has(column.id);
      const lockedType = existing;
      const required = requiredIds.has(column.id);
      return <div key={column.id} className={dragging === index ? 'is-dragging' : ''} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => { event.preventDefault(); drop(index); }}>
        <span className="guest-sheet-column-drag" draggable role="button" tabIndex="0" aria-label={`Перетащить колонку ${column.name}`} onDragStart={event => { setDragging(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }} onDragEnd={() => setDragging(null)}>⋮⋮</span>
        <input aria-label={`Название колонки ${index + 1}`} value={column.name} onChange={event => update(index, {name:event.target.value})}/>
        <select aria-label={`Тип колонки ${index + 1}`} value={column.type} disabled={lockedType} title={lockedType ? 'Тип существующей колонки сохраняется, чтобы не повредить данные' : undefined} onChange={event => update(index, {type:event.target.value, ...(event.target.value === 'select' ? {options:column.options || []} : {})})}>{Object.entries(columnTypeLabels).filter(([id]) => existing || editableTypes.has(id)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        {column.type === 'select' && !existing ? <input aria-label={`Варианты колонки ${index + 1}`} placeholder="Варианты через запятую" value={(column.options || []).join(', ')} onChange={event => update(index, {options:event.target.value.split(',').map(value => value.trim()).filter(Boolean)})}/> : <span aria-hidden="true"/>}
        <span className="guest-sheet-column-actions"><button type="button" aria-label={`${column.name} влево`} disabled={index === 0} onClick={() => move(index, -1)}>←</button><button type="button" aria-label={`${column.name} вправо`} disabled={index === draft.length - 1} onClick={() => move(index, 1)}>→</button><button type="button" className="guest-sheet-column-delete" aria-label={`Удалить колонку ${column.name}`} disabled={required} title={required ? 'ФИО и Приглашение нужны для списка гостей' : `Удалить колонку ${column.name}`} onClick={() => {
          if(existing&&!window.confirm(`Удалить колонку «${column.name}»? Значения останутся в истории изменений, но колонка исчезнет из реестра.`))return;
          setDraft(items=>items.filter(item=>item.id!==column.id));
        }}>×</button></span>
      </div>;
    })}</div>
    {error && <p className="guest-sheet-error" role="alert">{error}</p>}
    <footer><button type="button" onClick={onClose}>Отмена</button><button className="guest-sheet-save" disabled={busy}>Сохранить колонки</button></footer>
  </form>;
}

export function GuestRegistrySheet({state, projectId, run, refresh, navigate, sourceId, can = () => false, table, mappingSetup}) {
  const map = table.data.semanticMap || {};
  const columns = (table.data.columns || []).filter(column => editableTypes.has(column.type) && column.id !== map.seatIndex && column.id !== map.seatingTable).map(column => ({...column, readable:row => readableGuestField(can, table, row, column.id)}));
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
  const focusedRow = useRef(null);
  const canAdd = Boolean(nameId) && can('create', table.id, null, nameId);
  const canStructure = can('structure', table.id);
  const canInvite = Boolean(map.rsvpStatus) && Array.isArray(state.guestInvites);
  const canViewStatus = Boolean(map.rsvpStatus) && all.some(row => readableGuestField(can, table, row, map.rsvpStatus));
  const canViewSeats = Boolean(map.seatingTable) && all.some(row => readableGuestField(can, table, row, map.seatingTable));
  const visible = all.filter(row => {
    const words = columns.filter(column => readableGuestField(can, table, row, column.id)).map(column => String(row.data[column.id] || '')).join(' ').toLocaleLowerCase('ru');
    return (!query || words.includes(query.toLocaleLowerCase('ru'))) && (filter === 'all' || readableGuestField(can, table, row, map.rsvpStatus) && responseOf(row, map) === filter);
  });
  const toggle = (setter, id) => setter(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  useEffect(() => { const row = all.find(item => item.id === sourceId); if (!row) return; setQuery(displayName(row, nameId)); setTimeout(() => focusedRow.current?.scrollIntoView({block:'center'}), 0); }, [sourceId, table.id]);
  const saveCell = async (row, column, value) => {
    const next = value === '' ? '' : column.type === 'money' ? Math.round(Number(value) * 100) : column.type === 'number' ? Number(value) : value;
    await run('entity.edit', {projectId, entityId:row.id, version:row.version, schemaVersion:table.version, data:{[column.id]:next}});
  };
  const saveStatus = async (row, value) => {
    setError('');
    try { await run('guest.rsvp.set', {projectId, guestTableId:table.id, schemaVersion:table.version, guestRowId:row.id, rowVersion:row.version, data:{values:{rsvp:value}}}); }
    catch (cause) { setError(cause.message || 'Не удалось изменить ответ'); }
  };
  const createGuest = async data => {
    const values = Object.fromEntries(Object.entries(data).map(([id, value]) => {
      const type = columns.find(column => column.id === id)?.type;
      return [id, type === 'money' ? Math.round(Number(value) * 100) : type === 'number' ? Number(value) : value];
    }));
    await run('entity.create', {projectId, kind:'row', parentId:table.id, schemaVersion:table.version, data:values});
  };
  const saveColumns = async nextStructureColumns => {
    const keptIds = new Set(nextStructureColumns.map(column => column.id));
    const optionalMappings = Object.entries(map).filter(([key, value]) => key !== 'rsvpValues' && !['guestName','rsvpStatus','seatingTable','seatIndex'].includes(key) && typeof value === 'string');
    const disabled = optionalMappings.filter(([, columnId]) => !keptIds.has(columnId)).map(([key]) => key);
    let workingTable = table;
    if (disabled.length) workingTable = await run('guestMapping.save', {projectId, guestTableId:table.id, schemaVersion:table.version, data:{semanticMap:{disable:disabled}}, confirm:true});
    const workingMap = workingTable.data.semanticMap || {};
    const hiddenColumns = (workingTable.data.columns || []).filter(column => column.id === workingMap.seatIndex || column.id === workingMap.seatingTable);
    await run('entity.edit', {projectId, entityId:workingTable.id, version:workingTable.version, data:{...workingTable.data, confirmStructure:true, columns:[...nextStructureColumns, ...hiddenColumns]}});
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
    <div className="guest-sheet-stats"><span><strong>{all.length}</strong> гостей</span><span><strong>{confirmed ?? '—'}</strong> подтвердили</span><span><strong>{pending ?? '—'}</strong> ждут ответа</span><span><strong>{seated ?? '—'}</strong> рассажены</span></div>
    <div className="guest-sheet-tools"><label>Поиск<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Имя, контакт или примечание"/></label>{canViewStatus && <label>Ответ<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Все ответы</option>{Object.entries(responseLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>}{canStructure && <button className="guest-sheet-columns-button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(open => !open)}>Колонки</button>}<button className="guest-sheet-add" disabled={!canAdd} onClick={() => {setAdding(true); setFilter('all'); setQuery('');}}>+ Добавить гостя</button></div>
    {columnsOpen && <GuestColumnsEditor key={table.version} columns={structureColumns} requiredIds={new Set([map.guestName, map.rsvpStatus].filter(Boolean))} onSave={saveColumns} onClose={() => setColumnsOpen(false)}/>}
    {error && <p className="guest-sheet-error" role="alert">{error}</p>}
    {!nameId ? <p className="guest-sheet-error">В реестре нет текстового поля для имени. Откройте полный реестр и добавьте его.</p> : <div className="guest-sheet-scroll"><table className="guest-sheet-table" style={{minWidth:`${Math.max(900, (canInvite ? 110 : 0) + (columns.length + (canViewSeats ? 1 : 0)) * 105)}px`}}><thead><tr>{canInvite && <th className="guest-sheet-select-col"><InviteSelectionHeader rows={visible} selected={selected} setSelected={setSelected}/></th>}{columns.map(column => <th key={column.id} className={column.id === nameId ? 'guest-sheet-name-col' : ''} data-column-id={column.id}>{column.name}</th>)}{canViewSeats && <th>Стол</th>}</tr></thead><tbody>
      {visible.map(row => <tr key={row.id} ref={sourceId === row.id ? focusedRow : null} className={sourceId === row.id ? 'is-addressed' : ''}>{canInvite && <td className="guest-sheet-select-col"><label><input type="checkbox" aria-label={`Добавить ${displayName(row, nameId)} в ссылку`} checked={selected.has(row.id)} onChange={() => toggle(setSelected, row.id)}/>{selected.has(row.id) && <span className="guest-sheet-plus"><input type="checkbox" aria-label={`Плюс один для ${displayName(row, nameId)}`} checked={plusOne.has(row.id)} onChange={() => toggle(setPlusOne, row.id)}/>+1</span>}</label></td>}{columns.map(column => <td key={column.id} className={column.id === nameId ? 'guest-sheet-name-col' : ''} data-column-id={column.id}>{column.id === map.rsvpStatus ? (readableGuestField(can, table, row, column.id) ? (can('edit', table.id, row.id, column.id) ? <select aria-label={`Ответ RSVP: ${displayName(row, nameId)}`} value={responseOf(row, map)} onChange={event => void saveStatus(row, event.target.value)}>{Object.entries(responseLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select> : responseLabels[responseOf(row, map)]) : 'Нет доступа') : <GuestCell row={row} column={column} nameId={nameId} editable={can('edit', table.id, row.id, column.id)} onSave={saveCell}/>}</td>)}{canViewSeats && <td className="guest-sheet-seat">{readableGuestField(can, table, row, map.seatingTable) ? (state.entities || []).find(item => item.id === row.data[map.seatingTable])?.data?.label || 'Без места' : 'Нет доступа'}</td>}</tr>)}
      {!visible.length && <tr><td colSpan={columns.length + 2} className="guest-sheet-empty">{all.length ? 'По вашему запросу гостей нет. Измените поиск или фильтр.' : 'Список пока пуст. Нажмите «Добавить гостя» и начните с имени.'}</td></tr>}
      {adding && <NewGuestRow columns={columns} nameId={nameId} statusId={map.rsvpStatus} canCreate={id => can('create', table.id, null, id)} onCreate={createGuest} onCancel={() => setAdding(false)}/>}
    </tbody></table></div>}
    {canInvite && <section className="guest-sheet-invites"><div className="guest-sheet-invite-bar"><div><h2>Приглашения</h2><p>Выберите гостей галочками в таблице, затем создайте одну ссылку для них.</p></div><label>Срок ссылки<input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)}/></label><button disabled={!selected.size || busy} onClick={createInvite}>Создать приглашение · {selected.size}</button></div>{link && <div className="guest-sheet-link" role="status"><strong>{copyStatus}</strong><code>{link}</code><button onClick={() => void copyLink(link)}>Скопировать ссылку</button></div>}{invitations.length > 0 && <details><summary>Выданные ссылки · {invitations.length}</summary><ul>{invitations.map(invite => <li key={invite.id}><span>{invite.recipientNames?.join(', ') || `${invite.rowIds?.length || invite.guestCount || '—'} гостей`} · {invitationLabel(invite)}</span><div><button disabled={busy || invite.status !== 'issued'} onClick={() => void inviteAction('rotate', invite)}>Перевыпустить</button><button disabled={busy || invite.status !== 'issued'} onClick={() => void inviteAction('revoke', invite)}>Отозвать</button></div></li>)}</ul></details>}</section>}
    {!map.rsvpStatus && <details className="guest-sheet-mapping"><summary>Подключить ответы на приглашения</summary>{mappingSetup}</details>}
  </section>;
}

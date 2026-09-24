import React, {useEffect, useState} from 'react';
import {coupleBudgetTotals, coupleBudgetOrganizerIncluded} from '../couple-budget.js';
import './couple-budget.css';

const number = new Intl.NumberFormat('ru-RU', {maximumFractionDigits:2});
const display = cents => number.format(cents / 100);
const editValue = cents => cents == null ? '' : String(cents / 100);

function EditableCell({row, field, value, label, onSave, name = false, note = false, group = false}) {
  const isText=name||note;
  const [draft, setDraft] = useState(isText ? value : editValue(value));
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!active && !saving) setDraft(isText ? value : editValue(value)); }, [value, active, saving, isText]);
  const save = async () => {
    setActive(false);
    const next = draft.trim();
    if (name && !next) { setError('Укажите название'); return; }
    if (isText && next === value) return;
    if (!isText && next === editValue(value)) return;
    if (!isText && next && !/^(?:\d+)(?:[.,]\d{1,2})?$/.test(next)) { setError('Сумма: не более двух знаков после запятой'); return; }
    const normalized = isText ? next : next === '' ? null : Math.round(Number(next.replace(',', '.')) * 100);
    if (!isText && normalized === value) return;
    setSaving(true);
    try { await onSave(row, field, normalized); }
    catch { setDraft(isText ? value : editValue(value)); }
    finally { setSaving(false); }
  };
  return <><input
    className={`couple-budget-input${name?' is-name':''}${note?' is-note':''}${group?' is-group':''}`}
    aria-label={label}
    title={isText?'Нажмите, чтобы изменить текст':label}
    inputMode={isText?undefined:'decimal'}
    type="text"
    maxLength={name?200:note?500:undefined}
    value={draft}
    aria-invalid={!!error}
    disabled={saving}
    onFocus={() => setActive(true)}
    onChange={event => {setDraft(event.target.value);setError('');}}
    onBlur={save}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(isText ? value : editValue(value)); setError(''); event.currentTarget.blur(); } }}
  />{error&&<small className="couple-budget-error" role="alert">{error}</small>}</>;
}

function InlineAdd({kind, group, onSave, onCancel}) {
  const [name,setName]=useState(''),[note,setNote]=useState(''),[organizer,setOrganizer]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const wholeOrganizer=[28,51].includes(group?.row);
  return <form className="couple-budget-add-form" onSubmit={async event=>{
    event.preventDefault();
    if(!name.trim()){setError('Укажите название');return;}
    setBusy(true);setError('');
    try{await onSave(kind,kind==='section'?{name:name.trim()}:{sectionId:group.row,name:name.trim(),note:note.trim(),organizer:wholeOrganizer||organizer});onCancel();}
    catch(reason){setError(reason.message||'Не удалось сохранить');setBusy(false);}
  }}>
    <label>{kind==='section'?'Новый раздел':'Новая статья'}<input autoFocus maxLength="200" value={name} onChange={event=>setName(event.target.value)} placeholder={kind==='section'?'Название раздела':'Название статьи'}/></label>
    {kind==='item'&&<><label>Примечание<input maxLength="500" value={note} onChange={event=>setNote(event.target.value)} placeholder="Необязательно"/></label>{!wholeOrganizer&&<label className="couple-budget-check"><input type="checkbox" checked={organizer} onChange={event=>setOrganizer(event.target.checked)}/> Включить в бюджет организатора</label>}</>}
    <div className="couple-budget-add-actions"><button type="submit" disabled={busy}>Добавить</button><button type="button" onClick={onCancel} disabled={busy}>Отмена</button></div>
    {error&&<small role="alert">{error}</small>}
  </form>;
}

export function CoupleBudget({state, onSave, onStructure, onDocuments}) {
  const [query,setQuery]=useState(''),[adding,setAdding]=useState(null);
  const sheet = (state.entities || []).find(item => item.kind === 'coupleBudget' && !item.deleted)?.data || {};
  const {groups,groupTotals,overall,organizer}=coupleBudgetTotals(sheet);
  const fieldValue = (field, row) => sheet[field]?.[row] ?? null;
  const rowValue = row => (fieldValue('actual', row) || 0) - (fieldValue('prepaid', row) || 0);
  const title = (row, fallback) => sheet.names?.[row] || fallback;
  const note = item => sheet.notes?.[item.row] ?? item.note ?? '';
  const columns = [['estimated','Предполагаемые'],['actual','Фактические'],['prepaid','Предоплата'],['remaining','Осталось']];
  const totalCells = totals => columns.map(([field]) => <td key={field} className={field==='remaining'?'couple-budget-remaining':''}>{display(totals[field])}</td>);
  const search=query.trim().toLocaleLowerCase('ru');
  const visibleGroups=groups.map(group=>{
    const match=title(group.row,group.name).toLocaleLowerCase('ru').includes(search);
    const items=!search||match?group.items:group.items.filter(item=>`${title(item.row,item.name)} ${note(item)}`.toLocaleLowerCase('ru').includes(search));
    return {...group,visibleItems:items,match};
  }).filter(group=>!search||group.match||group.visibleItems.length);
  const visibleCount=visibleGroups.reduce((total,group)=>total+group.visibleItems.length,0);
  const totalCount=groups.reduce((total,group)=>total+group.items.length,0);
  const focusName=event=>event.currentTarget.closest('.couple-budget-name')?.querySelector('input')?.focus();
  return <section className="couple-budget-workspace" aria-label="Смета пары">
    <div className="couple-budget-intro"><p>Смета пары</p><span>Названия и суммы меняются в таблице. «Осталось» = фактические расходы − предоплата.</span></div>
    <div className="couple-budget-toolbar"><label><span className="sr-only">Поиск по смете</span><input type="search" aria-label="Поиск по смете" placeholder="Найти раздел или статью" value={query} onChange={event=>setQuery(event.target.value)}/></label><span>{search?`Найдено статей: ${visibleCount}`:`Статей: ${totalCount}`}</span>{search&&<button type="button" onClick={()=>setQuery('')}>Сбросить поиск</button>}</div>
    <div className="couple-budget-scroll"><table className="couple-budget-sheet">
      <colgroup><col className="couple-budget-col-name"/><col className="couple-budget-col-estimated"/><col className="couple-budget-col-actual"/><col className="couple-budget-col-prepaid"/><col className="couple-budget-col-remaining"/><col className="couple-budget-col-note"/></colgroup>
      <thead><tr className="couple-budget-title"><th>СМЕТА</th><th/><th/><th/><th><button type="button" onClick={onDocuments}>Ваши документы</button></th><th/></tr></thead>
      <tbody>
        <tr className="couple-budget-summary-head"><th/><th>Предполагаемые</th><th>Фактические</th><th>Всего предоплачено</th><th>Осталось оплатить</th><th/></tr>
        <tr className="couple-budget-summary"><th>Общий бюджет</th>{totalCells(overall)}<td/></tr>
        <tr className="couple-budget-summary"><th>Общий бюджет для организатора</th>{totalCells(organizer)}<td/></tr>
        {search&&<tr className="couple-budget-search-note"><td colSpan="6">Поиск не меняет суммы: итоги рассчитаны по всей смете.</td></tr>}
        {visibleGroups.map(group => <React.Fragment key={group.row}>
          <tr className="couple-budget-spacer"><td colSpan="6"/></tr>
          <tr className="couple-budget-section-head"><th/><th>Предполагаемые</th><th>Фактические</th><th>Предоплата</th><th>Осталось</th><th/></tr>
          <tr className="couple-budget-group"><th><div className="couple-budget-name"><EditableCell row={group.row} field="name" value={title(group.row,group.name)} label={`Название раздела ${title(group.row,group.name)}`} onSave={onSave} name group/><button type="button" onClick={focusName} aria-label={`Изменить раздел ${title(group.row,group.name)}`}>✎</button></div></th><td colSpan="5"><button className="couple-budget-insert" type="button" onClick={()=>setAdding(group.row)}>+ Добавить статью</button></td></tr>
          {adding===group.row&&<tr className="couple-budget-add-row"><td colSpan="6"><InlineAdd kind="item" group={group} onSave={onStructure} onCancel={()=>setAdding(null)}/></td></tr>}
          {group.visibleItems.map(item => <tr className="couple-budget-item" key={item.row}>
            <th><div className="couple-budget-name"><EditableCell row={item.row} field="name" value={title(item.row,item.name)} label={`Название статьи ${title(item.row,item.name)}`} onSave={onSave} name/><button type="button" onClick={focusName} aria-label={`Изменить статью ${title(item.row,item.name)}`}>✎</button></div></th>
            {columns.slice(0,3).map(([field,label]) => <td key={field} className="couple-budget-editable"><EditableCell row={item.row} field={field} value={fieldValue(field,item.row)} label={`${label}: ${title(item.row,item.name)}`} onSave={onSave}/></td>)}
            <td className="couple-budget-remaining">{display(rowValue(item.row))}</td>
            <td className="couple-budget-note"><EditableCell row={item.row} field="note" value={note(item)} label={`Примечание: ${title(item.row,item.name)}`} onSave={onSave} note/>{String(item.row).startsWith('item_')&&![28,51].includes(group.row)&&<label className="couple-budget-organizer"><input type="checkbox" checked={coupleBudgetOrganizerIncluded(sheet,item.row)} onChange={event=>onSave(item.row,'organizer',event.target.checked)}/>Для организатора</label>}</td>
          </tr>)}
          <tr className="couple-budget-total"><th>{group.totalLabel}</th>{totalCells(groupTotals[group.row])}<td/></tr>
        </React.Fragment>)}
        {search&&!visibleGroups.length&&<tr className="couple-budget-no-results"><td colSpan="6">По вашему запросу ничего не найдено.</td></tr>}
        {!search&&<tr className="couple-budget-add-section"><td colSpan="6">{adding==='section'?<InlineAdd kind="section" onSave={onStructure} onCancel={()=>setAdding(null)}/>:<button type="button" onClick={()=>setAdding('section')}>+ Добавить раздел</button>}</td></tr>}
      </tbody>
    </table></div>
  </section>;
}

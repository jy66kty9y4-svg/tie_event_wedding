import {Select} from './Select.jsx';
import {useEffect,useRef,useState} from 'react';
import {BudgetCell,FormatMenu} from './BudgetCell.jsx';
import {budgetStyle,displayBudgetAmount,applyBudgetFormat} from '../budget-format.js';
import {compute} from '../shared.js';
import {sheetNumber,sheetValue} from '../sheet.js';
import './couple-budget.css';

export function SheetCell({column,row,label,editable,onSave,relationRows=[],files=[],members=[],required=false}) {
  const stored=row.data?.[column.id];
  const value=column.type==='formula'?compute(column.formula||'',row.data||{}):(stored==null||stored==='')?column.defaultValue??stored:stored;
  const format=row.data?.cellFormats?.[column.id];
  const money=column.type==='money'||column.type==='formula'&&column.resultType==='money';
  const simple=['text','url','money','number','formula'].includes(column.type);
  const [draft,setDraft]=useState(value??''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const cancelBlur=useRef(false),pending=useRef(false),host=useRef(null),menu=useRef(null);
  const [popup,setPopup]=useState(null),[formatDraft,setFormatDraft]=useState(format||null);
  useEffect(()=>setFormatDraft(format||null),[JSON.stringify(format)]);
  const finishFormat=()=>{setPopup(null);if(JSON.stringify(formatDraft||null)!==JSON.stringify(format||null))void save(value,formatDraft,true).catch(()=>{});};
  useEffect(()=>{if(!popup)return;const outside=e=>{if(!host.current?.contains(e.target)&&!menu.current?.contains(e.target))finishFormat()};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[popup,formatDraft]);
  useEffect(()=>{if(!pending.current)setDraft(value??'')},[value]);
  const save=async(next,nextFormat=format,formatOnly=false)=>{
    if(pending.current)return;
    if(!formatOnly&&required&&!String(next??'').trim())throw new Error('Заполните обязательную ячейку');
    pending.current=true;setBusy(true);setError('');
    try{await onSave(next,nextFormat,formatOnly)}catch(reason){setError(reason.message);throw reason}finally{pending.current=false;setBusy(false)}
  };
  if(simple)return <BudgetCell row={row.id} field={column.id} value={value??null} format={format} label={label} canEdit={editable} computed={column.type==='formula'||column.computed} textMode={['text','url'].includes(column.type)} note={['text','url'].includes(column.type)} limit={column.type==='text'?8000:column.type==='url'?2000:40} required={required} formatable={column.formatable!==false}
    displayValue={v=>money?displayBudgetAmount(v):['number','formula'].includes(column.type)?sheetNumber(v):String(v??'')}
    parseValue={text=>sheetValue(column,text)} onSave={(_row,_field,next,nextFormat,formatOnly)=>save(next,nextFormat,formatOnly)}/>;
  const SelectControl=Select;
  const choices=column.type==='file'?files:column.type==='users'?members:column.type==='relation'?relationRows.filter(item=>column.targetKind==='seatingTable'?item.kind==='seatingTable':item.kind==='row'):[];
  const change=next=>{setDraft(next);void save(next).catch(()=>{})};
  const display=column.type==='boolean'?(value?'Да':'Нет'):['file','relation','users'].includes(column.type)?(Array.isArray(value)?value:[value]).map(id=>choices.find(item=>item.id===id)).filter(Boolean).map(item=>item.name||item.data?.name||item.data?.label||item.data?.title).join(', '):column.optionLabels?.[value]||String(value??'');
  if(!editable||column.computed)return column.type==='file'&&value?<a href={`/api/files/${encodeURIComponent(value)}`} style={budgetStyle(format?.style)}>{display||'Файл'}</a>:<span style={budgetStyle(format?.style)}>{display||'—'}</span>;
  return <><span ref={host} className="sheet-cell-special" style={budgetStyle(formatDraft?.style)} onContextMenu={e=>{if(column.formatable===false)return;e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();setPopup({left:Math.max(8,Math.min(rect.left,window.innerWidth-Math.min(360,window.innerWidth-16)-8)),top:Math.max(8,Math.min(rect.bottom+8,window.innerHeight-256))})}}>{column.type==='boolean'?<input aria-label={label} type="checkbox" checked={Boolean(draft)} disabled={busy} onChange={e=>change(e.target.checked)}/>:['select','relation','file','users'].includes(column.type)?<SelectControl className="sheet-cell-control" aria-label={label} multiple={column.type==='users'} value={column.type==='users'?(Array.isArray(draft)?draft:[]):draft??''} disabled={busy} onChange={e=>change(column.type==='users'?[...e.target.selectedOptions].map(item=>item.value):e.target.value)}>{column.type!=='users'&&column.allowEmpty!==false&&<option value="">{column.emptyLabel||'—'}</option>}{column.type==='select'?(column.options||[]).map(option=><option key={option} value={option}>{column.optionLabels?.[option]||option}</option>):choices.map(item=><option key={item.id} value={item.id}>{item.name||item.data?.name||item.data?.label||item.data?.title||item.id}</option>)}</SelectControl>:<input className="sheet-cell-control" aria-label={label} type={column.type} value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} onBlur={()=>{if(cancelBlur.current){cancelBlur.current=false;return}if(draft!==(value??''))void save(draft).catch(()=>{})}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){cancelBlur.current=true;setDraft(value??'');e.currentTarget.blur()}}}/>}</span>{column.type==='file'&&value&&<a className="text-button" href={`/api/files/${encodeURIComponent(value)}`}>Открыть файл</a>}{error&&<small role="alert" className="sheet-cell-error">{error}</small>}{popup&&<FormatMenu menuRef={menu} position={popup} isText={false} range={{from:0,to:0}} format={formatDraft} text="" onApply={patch=>setFormatDraft(applyBudgetFormat(formatDraft,'',0,0,patch,false))} onDone={finishFormat}/>}</>;
}

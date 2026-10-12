import {useEffect,useRef,useState} from 'react';
import {SheetCell} from './SheetCell.jsx';

// Drafts use the same typed cells as saved rows. Values and formatting are
// submitted together; leaving a cell never creates a partial database row.
export function SheetDraftRow({columns,initialValues={},requiredIds=[],canEdit=()=>true,relationRows=[],files=[],members=[],leading=0,trailing=0,onSave,onCancel,label='Новая строка',saveLabel='Сохранить',keepOpen=false,children}) {
  const [data,setData]=useState(()=>({...initialValues,cellFormats:initialValues.cellFormats||{}}));
  const latest=useRef(data),root=useRef(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{root.current?.querySelector('[role="textbox"],input,select')?.focus()},[]);
  const update=(column,value,format,formatOnly)=>{
    const next={...latest.current,...(!formatOnly?{[column.id]:value}:{}),cellFormats:{...latest.current.cellFormats,[column.id]:format}};
    latest.current=next;setData(next);
  };
  const submit=async()=>{
    if(busy)return;
    // Blur commits the active rich-text/date cell before reading the draft.
    if(root.current?.contains(document.activeElement))document.activeElement.blur();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    if(root.current?.querySelector('[aria-invalid="true"],[role="alert"]')){setError('Проверьте значение ячейки');return}
    for(const id of requiredIds){if(latest.current[id]==null||String(latest.current[id]).trim()===''){setError(`Заполните поле «${columns.find(c=>c.id===id)?.name||id}»`);return}}
    setBusy(true);setError('');
    try {
      const editable=columns.filter(c=>c.type!=='formula'&&!c.computed&&canEdit(c));
      const values=Object.fromEntries(editable.filter(c=>Object.hasOwn(latest.current,c.id)).map(c=>[c.id,latest.current[c.id]]));
      const formats=Object.fromEntries(columns.filter(c=>canEdit(c)&&c.formatable!==false&&Object.hasOwn(latest.current.cellFormats,c.id)).map(c=>[c.id,latest.current.cellFormats[c.id]]));
      await onSave(values,formats);
      if(keepOpen){const next={...initialValues,cellFormats:{}};latest.current=next;setData(next);root.current?.querySelector('[role="textbox"],input,select')?.focus()}
      else onCancel?.();
    } catch(reason){setError(reason.message||'Не удалось сохранить строку')}
    finally{setBusy(false)}
  };
  const count=columns.length+1+leading+trailing;
  return <><tr ref={root} className="sheet-new-row" aria-label={label} aria-busy={busy}><td className="sheet-index">+</td>{Array.from({length:leading},(_,i)=><td key={`before-${i}`}/>)}{columns.map(column=><td key={column.id} data-column-id={column.id} className={column.type==='money'?'sheet-money':undefined}><SheetCell column={column} row={{id:'draft',data}} label={`${label}: ${column.name}`} required={requiredIds.includes(column.id)} editable={!busy&&canEdit(column)} relationRows={relationRows} files={files} members={members} onSave={(value,format,formatOnly)=>update(column,value,format,formatOnly)}/></td>)}{Array.from({length:trailing},(_,i)=><td key={`after-${i}`}/>)}</tr><tr className="sheet-draft-actions"><td colSpan={count}><div className="inline-actions">{children}<button type="button" className="button small" disabled={busy} onClick={submit}>{busy?'Сохраняем…':saveLabel}</button><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Отмена</button>{error&&<span className="form-error" role="alert">{error}</span>}</div></td></tr></>;
}

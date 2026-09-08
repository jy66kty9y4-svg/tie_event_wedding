import {useEffect,useMemo,useState} from 'react';

const fields=[
 ['title','Название','text',true],['startTime','Начало','time',true],['endTime','Окончание','time',false],
 ['dayOffset','День от свадьбы','number',false,true],['endDayOffset','День окончания','number',false,true],
 ['required','Обязательный пункт','boolean',false,true],['assignedUserIds','Участники проекта','users',false,true]
];

export function TimingSetup({state,projectId,run,refresh,table:givenTable}){
 const table=givenTable||(state.entities||[]).find(row=>row.kind==='table'&&row.data.key==='timing'&&!row.deleted),columns=table?.data?.columns||[],old=table?.data?.semanticMap||{},initial=Object.fromEntries(fields.map(([key,,type,required,creatable])=>{const mapped=columns.find(column=>column.id===old[key]);return [key,mapped?.type===type?old[key]:creatable?'__create__':required?'':''];}));
 const[draft,setDraft]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useMemo(()=>fields.filter(field=>field[4]&&draft[field[0]]==='__create__').map(field=>field[1]),[draft]);
 useEffect(()=>setDraft(initial),[table?.id,table?.version]);
 if(!table)return null;
 const connected=old.title&&old.startTime;
 const save=async event=>{event.preventDefault();setBusy(true);setError('');try{const semanticMap=Object.fromEntries(fields.filter(([key])=>draft[key]&&draft[key]!=='__create__').map(([key])=>[key,draft[key]])),createMissing=fields.filter(field=>field[4]&&draft[field[0]]==='__create__').map(field=>field[0]);await run('timing.configure',{projectId,entityId:table.id,schemaVersion:table.version,data:{semanticMap,createMissing},confirm:!!Object.keys(old).length});await refresh?.();}catch(caught){setError(caught.message||'Не удалось подключить тайминг')}finally{setBusy(false)}};
 return <section className="panel form-stack v2-timing-setup"><div className="panel-header"><div><h2>{connected?'Смысловые поля тайминга':'Подключить тайминг к календарю'}</h2><p className="quiet-copy">Выберите реальные колонки таблицы. Текст «Ответственный» не назначает сотрудника: для занятости используется отдельное поле участников.</p></div></div><form className="form-stack" onSubmit={save}>{fields.map(([key,label,type,required,creatable])=><label key={key}>{label}{required?' *':''}<select required={required} value={draft[key]||''} onChange={event=>setDraft(current=>({...current,[key]:event.target.value}))}><option value="">Не подключать</option>{columns.filter(column=>column.type===type).map(column=><option key={column.id} value={column.id}>{column.name} · {column.id}</option>)}{creatable&&<option value="__create__">Создать отдельное поле</option>}</select></label>)}{pending.length>0&&<div className="quiet-copy"><strong>Предпросмотр:</strong> будут добавлены поля: {pending.join(', ')}. Существующие колонки и значения сохранятся.</div>}{error&&<p className="form-error" role="alert">{error}</p>}<button className="button" disabled={busy}>{busy?'Подключаем…':connected?'Сохранить сопоставление':'Подтвердить и подключить'}</button></form></section>;
}

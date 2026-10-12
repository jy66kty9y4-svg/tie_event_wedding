import {useRef,useState} from 'react';
import {dateLabel} from '../shared.js';
import './wedding-date.css';

export function WeddingDateField({value='',onChange,label='Дата свадьбы',readOnly=false,hint=null}){
  const [open,setOpen]=useState(!value);
  const previousDate=useRef(value);
  const changeDate=event=>{previousDate.current=event.target.value;onChange(event.target.value)};
  return <fieldset className="wedding-date-field">
    <legend>{label}</legend>
    {readOnly?<p>{value?dateLabel(value):'Пока не определена'}</p>:<>
      <label className="wedding-date-open"><input type="checkbox" checked={open} onChange={event=>{
        const next=event.target.checked;setOpen(next);
        if(next){previousDate.current=value;onChange('');}else onChange(previousDate.current||'');
      }}/><span>Дата пока не определена</span></label>
      {!open&&<input aria-label={label} type="date" value={value} onInput={changeDate} onChange={changeDate}/>}
      {hint&&<small>{hint}</small>}
    </>}
  </fieldset>;
}

import {useEffect,useMemo,useState} from 'react';
import {Mark} from './Mark.jsx';
import {imageOptions,questionnaireQuestions,questionnaireSections} from '../questionnaire.js';
import './questionnaire.css';

function savedDraft(key){try{return JSON.parse(sessionStorage.getItem(key)||'{}')}catch{return {}}}

export function QuestionnairePage({state,application,onBack,onSubmit,onLogout}){
  const draftKey=`tie:questionnaire:${state.user.id}`;
  const existing=application?.data?.questionnaire||{};
  const [draft,setDraft]=useState(()=>({...existing,...savedDraft(draftKey)}));
  const [contact,setContact]=useState(()=>{const saved=savedDraft(draftKey);return saved.contact||application?.data?.contact||''});
  const [date,setDate]=useState(()=>{const saved=savedDraft(draftKey);return saved.date||application?.data?.date||''});
  const [otherImage,setOtherImage]=useState(()=>{const image=draft.images?.find(option=>!imageOptions.includes(option));return image||''});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const completed=useMemo(()=>questionnaireQuestions.filter(({id})=>id==='images'?draft.images?.length:String(draft[id]||'').trim()).length,[draft]);
  useEffect(()=>{try{sessionStorage.setItem(draftKey,JSON.stringify({...draft,contact,date}))}catch{}},[draft,contact,date,draftKey]);
  const set=(key,value)=>setDraft(current=>({...current,[key]:value}));
  const toggleImage=(option,checked)=>setDraft(current=>({ ...current,images:checked?[...new Set([...(current.images||[]),option])]:(current.images||[]).filter(value=>value!==option)}));
  const setCustomImage=value=>{setOtherImage(value);setDraft(current=>({...current,images:[...(current.images||[]).filter(option=>imageOptions.includes(option)),...(value.trim()?[value.trim()]:[])]}));};
  const submit=async event=>{
    event.preventDefault();
    const answers=Object.fromEntries(questionnaireQuestions.map(({id})=>[id,id==='images'?draft.images||[]:String(draft[id]||'').trim()]));
    if(!answers.images.length){setError('Выберите хотя бы один образ в разделе «Про эстетику».');document.getElementById('questionnaire-images')?.scrollIntoView({behavior:'smooth',block:'center'});return;}
    setBusy(true);setError('');
    try{await onSubmit({answers,contact:contact.trim(),date});sessionStorage.removeItem(draftKey)}
    catch(caught){setError(caught.message||'Не удалось отправить анкету');window.scrollTo({top:0,behavior:'smooth'})}
    finally{setBusy(false)}
  };
  return <div className="questionnaire-page">
    <header className="questionnaire-header"><button className="questionnaire-brand" type="button" onClick={onBack} aria-label="Назад к заявке"><Mark compact/><strong>tie</strong></button><span>{state.agency.name}</span><button type="button" className="questionnaire-exit" onClick={onLogout}>Выйти</button></header>
    <main className="questionnaire-layout"><aside className="questionnaire-sidebar"><button type="button" className="questionnaire-back" onClick={onBack}>← К заявке</button><p>Ваша история</p><strong>{completed} / {questionnaireQuestions.length}</strong><span>ответов заполнено</span><div className="questionnaire-progress" role="progressbar" aria-valuenow={completed} aria-valuemin="0" aria-valuemax={questionnaireQuestions.length} aria-label="Заполнено вопросов"><i style={{width:`${completed/questionnaireQuestions.length*100}%`}}/></div><nav aria-label="Разделы анкеты">{questionnaireSections.map((section,index)=><a key={section.title} href={`#questionnaire-section-${index}`}>{String(index+1).padStart(2,'0')} <span>{section.title}</span></a>)}</nav></aside>
      <div className="questionnaire-content"><div className="questionnaire-intro"><span className="questionnaire-kicker">Давайте знакомиться</span><h1>Ваша история начинается здесь.</h1><p>Ответьте так, как чувствуете. Здесь нет правильных слов — только ваши. Черновик сохраняется в этом браузере до отправки.</p></div>
        <form onSubmit={submit} className="questionnaire-form">
          {!application&&<section className="questionnaire-section" aria-labelledby="questionnaire-contact-heading"><div className="questionnaire-section-head"><span>00 / Связь</span><h2 id="questionnaire-contact-heading">Чтобы мы нашли друг друга</h2><p>Эти данные нужны организатору для ответа на вашу заявку.</p></div><div className="questionnaire-fields"><label className="questionnaire-field"><span>Дата свадьбы <em>*</em></span><input required type="date" value={date} onChange={event=>setDate(event.target.value)}/></label><label className="questionnaire-field"><span>Почта или телефон <em>*</em></span><input required maxLength="500" value={contact} onChange={event=>setContact(event.target.value)} placeholder="Как с вами связаться"/></label></div></section>}
          {questionnaireSections.map((section,index)=><section key={section.title} id={`questionnaire-section-${index}`} className="questionnaire-section" aria-labelledby={`questionnaire-heading-${index}`}><div className="questionnaire-section-head"><span>{String(index+1).padStart(2,'0')} / {String(questionnaireSections.length).padStart(2,'0')}</span><h2 id={`questionnaire-heading-${index}`}>{section.title}</h2></div><div className="questionnaire-fields">{section.questions.map(([id,label])=>id==='images'?<fieldset key={id} className="questionnaire-field questionnaire-images" id="questionnaire-images"><legend>{label} <em>*</em></legend><div className="questionnaire-image-options">{imageOptions.map(option=><label key={option}><input type="checkbox" checked={!!draft.images?.includes(option)} onChange={event=>toggleImage(option,event.target.checked)}/><span>{option}</span></label>)}</div><label className="questionnaire-other"><span>Другое</span><input maxLength="200" value={otherImage} onChange={event=>setCustomImage(event.target.value)} placeholder="Ваш образ"/></label></fieldset>:<label key={id} className="questionnaire-field"><span>{label} <em>*</em></span>{id==='names'?<input required maxLength="2000" value={draft[id]||''} onChange={event=>set(id,event.target.value)} placeholder="Как вас зовут?"/>:<textarea required rows="3" maxLength="2000" value={draft[id]||''} onChange={event=>set(id,event.target.value)} placeholder="Ваш ответ"/>}</label>)}</div></section>)}
          <div className="questionnaire-submit"><span>Осталось только отправить ответы</span><p>Организатор увидит анкету вместе с вашей заявкой. Личный кабинет пары откроется после подтверждения.</p>{error&&<p className="questionnaire-error" role="alert">{error}</p>}<div><button type="button" className="questionnaire-cancel" onClick={onBack}>Вернуться</button><button type="submit" disabled={busy}>{busy?'Отправляем…':application?'Сохранить анкету':'Отправить анкету и заявку'} <span aria-hidden="true">↗</span></button></div></div>
        </form>
      </div>
    </main>
  </div>;
}

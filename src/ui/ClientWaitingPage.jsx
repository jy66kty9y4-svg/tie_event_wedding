import {useState} from 'react';
import {Mark} from './Mark.jsx';
import './client-waiting.css';

const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phone=/^\+?[\d\s()\-]{7,}$/;

function Contact({value}){
  const contact=String(value||'').trim();
  if(!contact)return <p>Контакт агентства пока не указан. Организатор ответит по контакту из вашей заявки.</p>;
  if(email.test(contact))return <a href={`mailto:${contact}`}>{contact}</a>;
  if(phone.test(contact))return <a href={`tel:${contact.replace(/[^+\d]/g,'')}`}>{contact}</a>;
  if(/^https:\/\/[^\s]+$/i.test(contact))return <a href={contact} target="_blank" rel="noopener noreferrer">{contact}</a>;
  return <p>{contact}</p>;
}

export function ClientWaitingPage({state,application,onQuestionnaire,onRespond,onCheckAccess,onLogout}){
  const [checking,setChecking]=useState(false);
  const [checkError,setCheckError]=useState('');
  const status=application?.data?.status||'none';
  const reason=application?.data?.reason;
  const copy={
    none:{eyebrow:'Первый шаг',title:'Расскажите нам о вашей свадьбе.',body:'Заполните анкету, и организатор свяжется с вами. Личный кабинет пары откроется после подтверждения заявки.'},
    review:{eyebrow:'Заявка получена',title:'Спасибо, мы получили вашу заявку.',body:'Организатор свяжется с вами по указанному контакту. Личный кабинет пары откроется после подтверждения заявки.'},
    clarification:{eyebrow:'Нужно уточнение',title:'Организатор ждёт вашего ответа.',body:'Уточните детали заявки, чтобы мы смогли продолжить подготовку.'},
    rejected:{eyebrow:'Нужно исправление',title:'Кабинет пары пока не открыт.',body:'Вы можете изменить заявку и отправить её на повторное рассмотрение.'},
    approved:{eyebrow:'Заявка подтверждена',title:'Ваша свадьба уже в работе.',body:'Обновите доступ: кабинет пары откроется, когда организатор завершит подключение.'}
  }[status]||{eyebrow:'Заявка получена',title:'Спасибо, мы получили вашу заявку.',body:'Организатор свяжется с вами. Личный кабинет пары откроется после подтверждения заявки.'};
  const check=async()=>{setChecking(true);setCheckError('');try{await onCheckAccess()}catch(error){setCheckError(error.message||'Не удалось проверить доступ. Повторите позже.')}finally{setChecking(false)}};
  return <div className="client-waiting">
    <header className="client-waiting-header"><div className="client-waiting-brand"><Mark compact/><span>tie</span></div><span className="client-waiting-agency">{state.agency.name}</span><button type="button" onClick={onLogout}>Выйти</button></header>
    <main className="client-waiting-main"><div className="client-waiting-rings" aria-hidden="true"><i/><i/></div><section className="client-waiting-message" aria-labelledby="client-waiting-title"><p className="client-waiting-eyebrow">{copy.eyebrow}</p><h1 id="client-waiting-title">{copy.title}</h1><p className="client-waiting-lead">{copy.body}</p>{reason&&['clarification','rejected'].includes(status)&&<p className="client-waiting-reason"><strong>Сообщение организатора</strong>{reason}</p>}<div className="client-waiting-actions">{status!=='approved'&&<button className="client-waiting-primary" type="button" onClick={onQuestionnaire}>{application?.data?.questionnaire?'Изменить анкету':'Заполнить анкету'}</button>}{['clarification','rejected'].includes(status)&&<button className="client-waiting-refresh" type="button" onClick={onRespond}>{status==='clarification'?'Уточнить заявку':'Изменить заявку'}</button>}{status!=='none'&&<button className="client-waiting-refresh" type="button" onClick={check} disabled={checking}>{checking?'Проверяем доступ…':'Проверить доступ'}</button>}</div>{checkError&&<p className="client-waiting-error" role="alert">{checkError}</p>}</section><aside className="client-waiting-contact"><span>Связаться с агентством</span><strong>{state.agency.name}</strong><Contact value={state.agency.settings?.contact}/></aside></main>
    <footer className="client-waiting-footer">Личный кабинет появится здесь после подтверждения организатором.</footer>
  </div>;
}

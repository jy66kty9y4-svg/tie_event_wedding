import {useState} from 'react';
import {Modal,FormField,SafeForm} from './Modal.jsx';
import {dateLabel} from '../shared.js';
import {questionnaireSections} from '../questionnaire.js';

export function AccountApprovalForm({user,projects,onSave,onClose}) {
  const [weddingId,setWeddingId]=useState(user.onboarding.projectId||'');
  return <Modal title="Подтвердить аккаунт" onClose={onClose}><SafeForm className="form-stack" onSubmit={async()=>{await onSave(weddingId);onClose();}}>
    <p className="form-intro"><strong>{user.name}</strong><br/>{[user.phone,user.email].filter(Boolean).join(' · ')}</p>
    <p className="form-intro">Подтвердите аккаунт и назначьте свадьбу. Пользователь заполнит анкету, после чего откроется личный кабинет пары.</p>
    <FormField label="Свадьба"><select required autoFocus value={weddingId} onChange={event=>setWeddingId(event.target.value)}><option value="">Выберите свадьбу</option>{projects.map(project=><option key={project.id} value={project.id}>{project.data.name} · {dateLabel(project.data.date)}</option>)}</select></FormField>
    {!projects.length&&<p className="form-intro">Сначала создайте свадьбу в разделе «Свадьбы», затем вернитесь к подтверждению аккаунта.</p>}
    <div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>Отмена</button><button className="button" disabled={!projects.length}>Подтвердить и назначить свадьбу</button></div>
  </SafeForm></Modal>;
}

export function AccountAnswers({user,onClose}) {
  return <Modal title={`Анкета — ${user.name}`} wide onClose={onClose}><div className="application-answers"><p className="application-answers-intro">{user.onboarding.project?.name}<br/>Дата в брифе: {dateLabel(user.onboarding.weddingDate??user.onboarding.project?.date)}</p>{questionnaireSections.map(section=><section key={section.title}><h3>{section.title}</h3>{section.questions.map(([id,label])=><div key={id}><strong>{label}</strong><p>{Array.isArray(user.onboarding.questionnaire?.[id])?user.onboarding.questionnaire[id].join(', '):user.onboarding.questionnaire?.[id]||'—'}</p></div>)}</section>)}</div></Modal>;
}

import {useState} from 'react';
import {FormField,Modal,SafeForm} from './Modal.jsx';
import './user-management.css';

export function UserCreateForm({roles=[],projects=[],onSave,onClose}){
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[roleId,setRoleId]=useState(''),[projectId,setProjectId]=useState('');
  const role=roles.find(item=>item.id===roleId),projectRequired=['couple','coordinator','contractor'].includes(role?.key);
  return <Modal title="Новый пользователь" onClose={onClose}><SafeForm className="form-stack" onSubmit={async event=>{event.preventDefault();await onSave({name,email,password,roleId,projectId:projectId||null});onClose()}}>
    <p className="form-intro">Создайте учётную запись и назначьте ей рабочую роль. Передайте пароль пользователю безопасным способом.</p>
    <FormField label="Имя"><input autoFocus required value={name} onChange={event=>setName(event.target.value)}/></FormField>
    <FormField label="Почта"><input type="email" required value={email} onChange={event=>setEmail(event.target.value)}/></FormField>
    <FormField label="Пароль" hint="Не менее 10 символов."><input type="password" autoComplete="new-password" minLength="10" maxLength="256" required value={password} onChange={event=>setPassword(event.target.value)}/></FormField>
    <div className="form-columns"><FormField label="Роль"><select required value={roleId} onChange={event=>{setRoleId(event.target.value);setProjectId('')}}><option value="">Выберите роль</option>{roles.filter(item=>!item.protected).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField><FormField label="Свадьба"><select value={projectId} disabled={!roleId||role?.key==='organizer'} required={projectRequired} onChange={event=>setProjectId(event.target.value)}><option value="">{projectRequired?'Выберите свадьбу':'Всё агентство'}</option>{projects.map(item=><option key={item.id} value={item.id}>{item.data?.name||item.name}</option>)}</select></FormField></div>
    <div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>Отмена</button><button className="button">Создать пользователя</button></div>
  </SafeForm></Modal>;
}

export function UserPasswordForm({user,onSave,onClose}){
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  return <Modal title={`Сменить пароль · ${user.name}`} onClose={onClose}><SafeForm className="form-stack" onSubmit={async event=>{event.preventDefault();if(password!==confirmation)throw new Error('Пароли не совпадают');await onSave(password);onClose()}}>
    <p className="form-intro">После смены пароля все открытые сеансы пользователя завершатся. Новый пароль передайте ему безопасным способом.</p>
    <FormField label="Новый пароль"><input autoFocus required type="password" autoComplete="new-password" minLength="10" maxLength="256" value={password} onChange={event=>setPassword(event.target.value)}/></FormField>
    <FormField label="Повторите пароль"><input required type="password" autoComplete="new-password" minLength="10" maxLength="256" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></FormField>
    <div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>Отмена</button><button className="button">Сменить пароль</button></div>
  </SafeForm></Modal>;
}

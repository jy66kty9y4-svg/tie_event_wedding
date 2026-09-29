import {TimingView} from './ui/TimingView.jsx';
import {TimingSetup} from './v2/TimingSetup.jsx';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { api, command, discardCommand, getOfflineStatus, initClient, loadState, logout, prepareProject, retryCommand, subscribe, syncQueue } from './client.js';
import { PROJECT_FILE_MAX_BYTES, dateLabel, money, permissionLabels, permissions, statuses, today } from './shared.js';
import { PublicHome } from './ui/PublicHome.jsx';
import { AppShell } from './ui/AppShell.jsx';
import { ClientWaitingPage } from './ui/ClientWaitingPage.jsx';
import { QuestionnairePage } from './ui/QuestionnairePage.jsx';
import { questionnaireSections } from './questionnaire.js';
import { ConfirmDialog, FormField, Modal, SafeForm } from './ui/Modal.jsx';
import { Mark, Icon } from './ui/Mark.jsx';
import { Notice } from './ui/Notice.jsx';
import { TableWorkspace } from './ui/TableWorkspace.jsx';
import { findProjectTable } from './ui/project-tables.mjs';
import { isPastWedding } from './project-date-tabs.mjs';
import { weddingVendorCategories } from './vendor-category-tabs.mjs';
import {SectionEditor,TableEditor,InvitationEditor,Payouts,ConflictEditor} from './ui/ProjectTools.jsx';
import {GrantEditor,TemplateEditor,CategoryEditor} from './ui/ManagementForms.jsx';
import {UserCreateForm,UserPasswordForm} from './ui/UserAccountForms.jsx';
import {CoupleBudget} from './ui/CoupleBudget.jsx';
import {Dashboard,CalendarWorkspace,CalendarIntegrationSettings,NotificationCenter,NotificationPreferences,ReadinessSettings,VerificationPanel} from './v2/calendar/Workspace.jsx';
import {GuestWorkspace,SeatingWorkspace} from './v2/guest/Workspace.jsx';
import {TaskWorkspace,ApprovalWorkspace,RescheduleDialog} from './v2/workflow/Workspace.jsx';
import {MicrositeWorkspace,AgencyPublishingWorkspace} from './v2/publishing/Workspace.jsx';
import {parseRoute,viewUrl} from './v2/routes.js';
import {confirmNavigation} from './ui/unsaved-changes.mjs';
import {downloadBudgetXlsx,downloadTableXlsx} from './export-workbooks.js';
import './styles.css';
import './ui/collections.css';
import './ui/applications.css';
import './ui/settings-workspace.css';
const applicationDraftKey='tie:application-draft';
const adminWorkspaceKey='tie:admin-workspace';
const initialAdminWorkspace=()=>{try{const saved=sessionStorage.getItem(adminWorkspaceKey);return ['organizer','couple','contractor'].includes(saved)?saved:'organizer'}catch{return 'organizer'}};
function savedApplication(){try{return JSON.parse(sessionStorage.getItem(applicationDraftKey)||'{}')}catch{return {}}}
const entryParams=new URLSearchParams(location.search);
const applicationEntry=entryParams.get('application')==='1';
const loginEntry=entryParams.get('login')==='1';
const incomingSource=Object.fromEntries(['sourceCaseId','sourcePackageId'].map(key=>[key,entryParams.get(key)]).filter(([,value])=>value));
if(Object.keys(incomingSource).length){try{sessionStorage.setItem(applicationDraftKey,JSON.stringify({...savedApplication(),...incomingSource}))}catch{}}
const arr = value => Array.isArray(value) ? value : [];
const dataOf = item => item?.data || item || {};
const byKind = (state, kind) => arr(state?.entities || state?.global).filter(item => item.kind === kind && !item.deleted);
const agencySlug = () => new URLSearchParams(location.search).get('agency') || 'tie';
const has = (state, action, projectId = null) => !!state?.user?.protected || arr(state?.grants).some(g=>(g.project_id===null || g.project_id===projectId) && (g.permissions||[]).includes(action));
const awaitingClientAccess=state=>!!state?.user&&!state.project&&!has(state,'projects')&&!arr(state.projects).length&&!arr(state.grants).some(g=>g.role_key&&g.role_key!=='couple');
const permitted=(state,action,section,row,field)=>!!state?.user?.protected||arr(state?.grants).some(g=>{
 const actions=Array.isArray(action)?action:[action],r=g.restrictions||{};
 return actions.every(a=>g.permissions.includes(a))&&(g.project_id===null||g.project_id===state?.project?.id)&&(!r.sections?.length||r.sections.includes(section))&&(!r.rows?.length||row===undefined||r.rows.includes(row))&&(!r.fields?.length||field===undefined||(Array.isArray(field)?field:[field]).every(f=>r.fields.includes(f)))&&(!(r.rows?.length||r.fields?.length)||!actions.some(a=>['structure','invite','history'].includes(a)));
});
const initialProject = {
  name: '',
  date: '',
  location: '',
  limit: '',
  notes: ''
};
function useForm(initial) {
  const [values, setValues] = useState(initial);
  return [values, (key, value) => setValues(current => ({
    ...current,
    [key]: value
  })), setValues];
}
function FormActions({
  onCancel,
  label = 'Сохранить',
  busy
}) {
  return <div className="dialog-actions"><button className="button quiet" type="button" onClick={onCancel}>Отмена</button><button className="button" disabled={busy}>{busy ? 'Сохраняем…' : label}</button></div>;
}
function AuthDialog({
  mode,
  onClose,
  onAuth
}) {
  const setup = mode === 'setup';
  const [f, set] = useForm({
    name: '',
    email: '',
    password: '',
    agencyName: '',
    slug: 'tie'
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const endpoint = mode === 'login' ? '/api/login' : setup ? '/api/setup' : '/api/register';
      const body = mode === 'login' ? {
        email: f.email,
        password: f.password,
        slug: agencySlug()
      } : setup ? f : {
        name: f.name,
        email: f.email,
        password: f.password,
        slug: agencySlug(), invitation: new URLSearchParams(location.search).get('invite') || undefined
      };
      const result = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if(setup) { const url=new URL(location.href); url.searchParams.set("agency",f.slug); history.replaceState(null,"",url); }
      await onAuth(result);
    } catch (err) {
      setError(err.message || 'Не удалось продолжить');
    } finally {
      setBusy(false);
    }
  };
  return <Modal title={mode === 'login' ? 'Войти в tie' : setup ? 'Настроить агентство' : 'Создать аккаунт'} onClose={onClose}><SafeForm onSubmit={submit} className="form-stack">{mode !== 'login' && <><FormField label="Ваше имя"><input autoFocus required value={f.name} onChange={e => set('name', e.target.value)} /></FormField>{setup && <><FormField label="Название агентства"><input required value={f.agencyName} onChange={e => set('agencyName', e.target.value)} /></FormField><FormField label="Адрес агентства" hint="Латинские буквы, цифры и дефис."><input required pattern="(?:[a-z0-9]|-){2,50}" value={f.slug} onChange={e => set('slug', e.target.value.toLowerCase())} /></FormField></>}</>}<FormField label="Почта"><input autoFocus={mode === 'login'} type="email" required aria-invalid={!!error} aria-describedby={error?'auth-error':undefined} value={f.email} onChange={e => set('email', e.target.value)} /></FormField><FormField label="Пароль"><input type="password" minLength="10" required aria-invalid={!!error} aria-describedby={error?'auth-error':undefined} value={f.password} onChange={e => set('password', e.target.value)} /></FormField>{error && <p id="auth-error" className="form-error" role="alert">{error}</p>}<FormActions onCancel={onClose} label={mode === 'login' ? 'Войти' : setup ? 'Настроить агентство' : 'Создать аккаунт'} busy={busy} /></SafeForm></Modal>;
}
function ApplicationDialog({
  onClose, onSent
}) {
  const [f, set] = useForm({
    name: '',
    date: '',
    contact: '',
    message: '',...savedApplication()
  });
  const requestId=useRef(crypto.randomUUID());
  useEffect(()=>{try{sessionStorage.setItem(applicationDraftKey,JSON.stringify(f))}catch{}},[f]);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault();
    try {
      await api('/api/command', {
        method: 'POST',
        body: JSON.stringify({
          id: requestId.current,
          op: 'application.create',
          data: f
        })
      });
      sessionStorage.removeItem(applicationDraftKey);setSent(true);
      await onSent?.();
    } catch (err) {
      setError(err.message);
    }
  };
  return <Modal title="Заявка на свадьбу" onClose={onClose}>{sent ? <div className="dialog-body"><p>Заявка отправлена. Мы напишем по указанному контакту.</p><button className="button" onClick={onClose}>Готово</button></div> : <SafeForm className="form-stack" onSubmit={submit}><p className="form-intro">Расскажите самое важное — детали можно уточнить позже.</p><FormField label="Как к вам обращаться"><input required autoFocus value={f.name} onChange={e => set('name', e.target.value)} /></FormField><FormField label="Дата свадьбы"><input required type="date" value={f.date} onChange={e => set('date', e.target.value)} /></FormField><FormField label="Почта или телефон"><input required value={f.contact} onChange={e => set('contact', e.target.value)} /></FormField><FormField label="Что для вас важно"><textarea required value={f.message} onChange={e => set('message', e.target.value)} /></FormField>{error && <p className="form-error">{error}</p>}<FormActions onCancel={onClose} label="Отправить заявку" /></SafeForm>}</Modal>;
}
function ProjectForm({
  project,
  templates = [],
  showBudgetLimit = true,
  onClose,
  onSave, onReschedule
}) {
  const [f, set] = useForm({
    ...initialProject,
    status: 'planning',
    offline: ['payouts'],
    ...dataOf(project),
    limit: dataOf(project).limit != null ? Number(dataOf(project).limit) / 100 : ''
  });
  const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    try {
      const values={...f};
      if(showBudgetLimit)values.limit=f.limit === '' ? null : Math.round(Number(f.limit) * 100);
      else delete values.limit;
      await onSave(values);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return <Modal title={project ? 'Данные свадьбы' : 'Новая свадьба'} onClose={onClose}><SafeForm className="form-stack" onSubmit={submit}><FormField label="Название"><input autoFocus required placeholder="Алина и Максим" value={f.name} onChange={e => set('name', e.target.value)} /></FormField><div className="form-columns"><FormField label="Дата"><input required type="date" disabled={!!project} value={f.date} onChange={e => set('date', e.target.value)} />{project&&<button type="button" className="text-button" onClick={onReschedule}>Перенести дату или часовой пояс</button>}</FormField>{showBudgetLimit&&<FormField label="Лимит бюджета, ₽"><input type="number" min="0" step="0.01" value={f.limit} onChange={e => set('limit', e.target.value)} /></FormField>}</div>{project&&<FormField label="Место"><input placeholder="Площадка ещё не выбрана" value={f.location} onChange={e => set('location', e.target.value)} /></FormField>}<FormField label="Заметка для команды"><textarea value={f.notes} onChange={e => set('notes', e.target.value)} /></FormField>{!project&&templates.length>0&&<FormField label="Шаблон"><select value={f.templateId||''} onChange={e=>set('templateId',e.target.value)}><option value="">Основной</option>{templates.map(t=><option value={t.id} key={t.id}>{t.data.name}</option>)}</select></FormField>}{project&&<><FormField label="Состояние проекта"><select value={f.status} onChange={e=>set('status',e.target.value)}>{['planning','confirmed','completed','archived'].map(k=><option value={k} key={k}>{statuses[k]||k}</option>)}</select></FormField><fieldset className="permission-grid"><legend>Доступно без сети после подготовки</legend>{Object.entries({payouts:'Предстоящие выплаты',budget:'Полная смета и журнал',vendors:'Подрядчики',files:'Список файлов'}).map(([key,label])=><label key={key}><input type="checkbox" checked={f.offline.includes(key)} onChange={e=>set('offline',e.target.checked?[...f.offline,key]:f.offline.filter(x=>x!==key))}/>{label}</label>)}</fieldset><p className="quiet-copy">Каждая рабочая таблица включается отдельно в её структуре. Файлы требуют сети для скачивания.</p></>}<FormActions onCancel={onClose} label={project ? 'Сохранить изменения' : 'Создать свадьбу'} busy={busy} /></SafeForm></Modal>;
}
function Projects({state,onProject,onCreate,onEdit}) {
  const [query,setQuery]=useState(''),[status,setStatus]=useState(''),[dateTab,setDateTab]=useState('current');
  const all=arr(state.projects),now=new Date(),past=all.filter(project=>isPastWedding(project,now)),current=all.filter(project=>!isPastWedding(project,now));
  const inTab=dateTab==='past'?past:current,projects=inTab.filter(project=>{
    const d=dataOf(project); return (!status||d.status===status)&&JSON.stringify(d).toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'));
  });
  const filtered=!!query||!!status;
  return <><PageHeader eyebrow="Рабочее пространство" title="Свадьбы" action={has(state,'projects')&&<button className="button" onClick={onCreate}><Icon name="plus"/>Новая свадьба</button>}><p className="subtitle">Актуальные свадьбы и прошедшие даты — отдельно.</p></PageHeader><div className="project-date-tabs" role="tablist" aria-label="Свадьбы по дате"><button type="button" role="tab" aria-selected={dateTab==='current'} aria-controls="project-date-panel" className={dateTab==='current'?'active':''} onClick={()=>setDateTab('current')}>Актуальные <span>{current.length}</span></button><button type="button" role="tab" aria-selected={dateTab==='past'} aria-controls="project-date-panel" className={dateTab==='past'?'active':''} onClick={()=>setDateTab('past')}>Завершено <span>{past.length}</span></button></div><p className="project-date-note">Вкладка определяется датой свадьбы. Сегодняшние свадьбы остаются актуальными.</p><div id="project-date-panel" role="tabpanel" className="project-date-panel"><div className="filters collection-filters"><label className="search"><Icon name="search"/><input aria-label="Поиск свадьбы" placeholder="Найти пару или площадку" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Состояние свадьбы" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Все свадьбы</option>{['planning','confirmed','completed','archived'].map(k=><option value={k} key={k}>{statuses[k]||k}</option>)}</select><span className="quiet-copy">Найдено: {projects.length}</span></div><div className="project-grid collection-projects">{projects.map(project=>{const d=dataOf(project);return <article className="project-card" key={project.id}><div className="project-card-top"><span className={`status-badge ${d.status||'planning'}`}><span className={`status-dot ${d.status||'planning'}`}/>{statuses[d.status]||'Подготовка'}</span>{has(state,'projects')&&<button className="icon-button" onClick={()=>onEdit(project)} aria-label={`Изменить свадьбу ${d.name||project.name}`}>•••</button>}</div><button className="project-open" onClick={()=>onProject(project)}><h2>{d.name||project.name}</h2><p><Icon name="calendar"/>{dateLabel(d.date)}</p><p><Icon name="projects"/>{d.location||'Площадка ещё не выбрана'}</p><span className="project-card-foot">Открыть свадьбу <Icon name="arrow"/></span></button></article>})}</div>{!projects.length&&<Empty title={filtered?'Свадьбы не найдены':dateTab==='past'?'Завершённых свадеб пока нет':'Актуальных свадеб пока нет'} text={filtered?'Измените запрос или выберите другое состояние.':dateTab==='past'?'Свадьбы появятся здесь на следующий день после даты проведения.':all.length?'Все свадьбы с прошедшими датами находятся во вкладке «Завершено».':'Создайте первую свадьбу или одобрьте входящую заявку.'} action={!all.length&&has(state,'projects')?'Новая свадьба':null} onAction={onCreate}/>}</div></>;
}
function PageHeader({
  eyebrow,
  title,
  action,
  children
}) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</div>{action}</header>;
}
function Empty({
  title,
  text,
  action,
  onAction
}) {
  return <section className="empty-panel"><Mark /><h2>{title}</h2><p>{text}</p>{action && <button className="button" onClick={onAction}>{action}</button>}</section>;
}
function Overview({
  state,
  onProjectEdit,
  openTab,
  onMovement
}) {
  const project = state.project;
  const d = dataOf(project);
  const fin = state.financials || {};
  const limit = d.limit;
  const remaining = limit == null ? null : limit - (fin.agreed || 0);
  const upcoming = byKind(state, 'obligation').filter(item => dataOf(item).dueDate && (dataOf(item).due ?? Math.max(0,(dataOf(item).agreed || 0) - (fin.paid?.[item.id] || 0))) > 0).sort((a, b) => String(dataOf(a).dueDate).localeCompare(String(dataOf(b).dueDate))).slice(0, 5);
  return <><PageHeader eyebrow="Свадьба" title={d.name || 'Проект'} action={state.canManageWeddingDetails?<button className="button quiet" onClick={onProjectEdit}>Изменить данные</button>:null}><p className="subtitle">{dateLabel(d.date)} {d.location && ` · ${d.location}`}</p></PageHeader><div className="metric-grid"><Metric label="Согласовано" value={money(fin.agreed || 0)} note="стоимость услуг" /><Metric label="Оплачено" value={money(fin.totalPaid || 0)} note="фактические выплаты" /><Metric label="К оплате" value={money(fin.due || 0)} note="по обязательствам" /><Metric label="У организаторов" value={money(fin.custody || 0)} note="средства пары" />{state.canViewBudgetLimit&&<Metric label="До лимита" value={remaining == null ? 'Не задан' : money(remaining)} note={limit == null ? 'задайте бюджет проекта' : `лимит ${money(limit)}`} />}</div><div className="split-grid"><section className="panel"><div className="panel-header"><div><p className="eyebrow">Ближайшие выплаты</p><h2>Кому и когда платить</h2></div><button className="text-button" onClick={() => openTab('estimate')}>Вся смета <Icon name="arrow" /></button></div>{upcoming.length ? <div className="due-list">{upcoming.map(item => {
            const x = dataOf(item);
            return <div key={item.id}><span className="date-chip">{dateLabel(x.dueDate)}</span><strong>{x.title}</strong><span>{money(x.due ?? Math.max(0,(x.agreed || x.planned || 0)-(fin.paid?.[item.id] || 0)))}</span></div>;
          })}</div> : <Empty title="Нет запланированных выплат" text="Добавьте статью сметы с датой или условием оплаты." action="Добавить статью" onAction={() => openTab('estimate')} />}</section><section className="panel note-panel"><p className="eyebrow">Подготовка</p><h2>{d.status ? statuses[d.status] : 'Подготовка'}</h2><p>{d.notes || 'Добавьте заметку, чтобы команда видела ключевой контекст проекта.'}</p><button className="text-button" onClick={() => openTab('timing')}>Открыть тайминг <Icon name="arrow" /></button></section></div><section className="panel custody-panel"><div><p className="eyebrow">Деньги пары</p><h2>Реестр средств у организаторов</h2><p>Это отдельный остаток: он не является доходом агентства.</p><div>{Object.entries(fin.holders||{}).map(([id,value])=><small className="holder-line" key={id}>{(state.custodians||[]).find(u=>u.id===id)?.name||'Организатор'}: {money(value)}</small>)}</div></div><strong>{money(fin.custody || 0)}</strong><button className="button quiet" onClick={onMovement}>Записать движение</button></section></>;
}
function Metric({
  label,
  value,
  note
}) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
function CategoryList({items,onEdit}) { return onEdit?<div className="panel category-list"><div className="button-group">{items.map(c=><button className="button quiet small" key={c.id} onClick={()=>onEdit(c)}>{c.data.name}{c.data.archived?' · Архив':''}</button>)}<button className="text-button" onClick={()=>onEdit()}>+ Категория</button></div></div>:null; }
function Finance(props) {
  const [view,setView]=useState('sheet');
  useEffect(()=>setView('sheet'),[props.state.project?.id]);
  if(props.agency)return <FinanceLedger {...props}/>;
  return <><nav className="v2-cash-tabs" aria-label="Разделы финансов пары"><button className={view==='sheet'?'active':''} aria-current={view==='sheet'?'page':undefined} onClick={()=>setView('sheet')}>Смета пары</button><button className={view==='ledger'?'active':''} aria-current={view==='ledger'?'page':undefined} onClick={()=>setView('ledger')}>Реестр выплат</button></nav>{view==='sheet'?<CoupleBudget state={props.state} onSave={props.onBudgetCell} onStructure={props.onBudgetStructure} onDocuments={props.onDocuments}/>:<FinanceLedger {...props}/>}</>;
}
function FinanceLedger({
  state,
  agency = false,
  onMovement,
  onEditObligation,
  onAddObligation,
  onEditMovement,
  onDeleteMovement, onCategory, onDeleteObligation, onOpenProject
}) {
  const fin = state.financials || {};
  const obligations = byKind(state, 'obligation');
  const movements = byKind(state, 'movement');
  const [kind, setKind] = useState('');
  const [agencyTab,setAgencyTab]=useState('projects');
  const [period, setPeriod] = useState('');
  const [category,setCategory]=useState(''),[fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState('');
  const categories=byKind(state,'category');
  const shown = movements.filter(m => (!kind || dataOf(m).type === kind) && (!period || String(dataOf(m).date || '').startsWith(period)) && (!category || dataOf(m).categoryId===category) && (!fromDate||dataOf(m).date>=fromDate) && (!toDate||dataOf(m).date<=toDate));
  if(agency){const revenue=state.agencyRevenue||{totalExpected:0,commissionExpected:0,feeExpected:0,received:0,projects:[]},commissionItems=revenue.projects.flatMap(card=>card.items.filter(item=>item.type==='commission').map(item=>({...item,projectId:card.projectId,projectName:card.projectName})));return <><PageHeader eyebrow="Агентство" title="Касса агентства" action={<button className="button" onClick={onMovement}><Icon name="plus"/>Движение</button>}/><div className="metric-grid v2-agency-cash-metrics"><Metric label="Ожидается от свадеб" value={money(revenue.totalExpected)} note="комиссии и гонорары"/><Metric label="Агентские комиссии" value={money(revenue.commissionExpected)} note="ожидаемые поступления"/><Metric label="Гонорар агентства" value={money(revenue.feeExpected)} note="по сметам свадеб"/><Metric label="В кассе сейчас" value={money(fin.own||0)} note="получено минус расходы"/></div><nav className="v2-cash-tabs" aria-label="Разделы кассы"><button className={agencyTab==='projects'?'active':''} onClick={()=>setAgencyTab('projects')}>По свадьбам</button><button className={agencyTab==='commission'?'active':''} onClick={()=>setAgencyTab('commission')}>Агентская комиссия <span>{money(revenue.commissionExpected)}</span></button><button className={agencyTab==='operations'?'active':''} onClick={()=>setAgencyTab('operations')}>Операции</button></nav>{agencyTab==='projects'&&(revenue.projects.length?<div className="v2-agency-cash-grid">{revenue.projects.map(card=><article className="v2-agency-cash-card" key={card.projectId}><header><div><span>{dateLabel(card.date)}</span><h2>{card.projectName}</h2></div><i>{statuses[card.status]||'Свадьба'}</i></header><p>Ожидаемый доход агентства</p><strong>{money(card.totalExpected)}</strong><dl><div><dt>Агентская комиссия</dt><dd>{money(card.commissionExpected)}</dd></div><div><dt>Гонорар агентства</dt><dd>{money(card.feeExpected)}</dd></div></dl><details><summary>Детализация · {card.items.length}</summary>{card.items.length?<div>{card.items.map(item=><p key={item.id}><span>{item.type==='commission'?'Комиссия':'Гонорар'} · {item.counterparty}</span><b>{money(item.amount)}</b><small>{item.title}{item.dueDate?` · ${dateLabel(item.dueDate)}`:''}</small></p>)}</div>:<small>Доход агентства по этой свадьбе ещё не заполнен.</small>}</details><button className="text-button" onClick={()=>onOpenProject?.(card.projectId)}>Открыть смету <Icon name="arrow"/></button></article>)}</div>:<Empty title="Свадеб пока нет" text="Карточки появятся после создания первой свадьбы."/>)}{agencyTab==='commission'&&<section className="panel v2-commission-ledger"><div className="panel-header"><div><p className="eyebrow">Ожидаемые поступления</p><h2>Агентская комиссия</h2></div><strong>{money(revenue.commissionExpected)}</strong></div>{commissionItems.length?<div className="data-list">{commissionItems.map(item=><div className="data-row static" key={item.id}><div><strong>{item.counterparty}</strong><small>{item.projectName} · {item.title}{item.dueDate?` · ${dateLabel(item.dueDate)}`:''}</small></div><span>{money(item.amount)}</span><button className="text-button" onClick={()=>onOpenProject?.(item.projectId)}>Смета</button></div>)}</div>:<p className="quiet-copy">Агентские комиссии ещё не заполнены в сметах свадеб.</p>}</section>}{agencyTab==='operations'&&<><div className="metric-grid"><Metric label="Собственные средства" value={money(fin.own||0)} note="отдельно от средств пар"/><Metric label="Доходы" value={money(fin.income||0)} note="фактические поступления"/><Metric label="Расходы" value={money(fin.expense||0)} note="операции агентства"/></div><CategoryList items={categories} onEdit={onCategory}/><div className="filters ledger-filters"><label>Тип <select value={kind} onChange={e=>setKind(e.target.value)}><option value="">Все</option><option value="income">Доход</option><option value="expense">Расход</option></select></label><label>Месяц <input type="month" value={period} onChange={e=>setPeriod(e.target.value)}/></label><label>Категория<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Все</option>{categories.map(c=><option value={c.id} key={c.id}>{c.data.name}</option>)}</select></label><label>С даты<input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label><label>По дату<input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label></div><Ledger movements={shown} agency onEdit={onEditMovement} onDelete={onDeleteMovement}/></>}</>}
  return <><PageHeader eyebrow="Смета" title="Смета и выплаты" action={<div className="button-group"><button className="button quiet" onClick={()=>downloadBudgetXlsx(state)}>Скачать Excel</button><button className="button quiet" onClick={onAddObligation}><Icon name="plus" />Статья</button><button className="button" onClick={onMovement}><Icon name="plus" />Движение</button></div>} /><div className="metric-grid"><Metric label="Согласовано" value={money(fin.agreed || 0)} note="стоимость услуг" /><Metric label="Планируется" value={money(fin.planned || 0)} note="оценки без договора" /><Metric label="Не определено" value={String(fin.unknown || 0)} note="цена ещё не согласована" /><Metric label="Оплачено" value={money(fin.totalPaid || 0)} note="фактические выплаты" /><Metric label="Осталось" value={money(fin.due || 0)} note="по согласованным статьям" /></div><section className="panel"><div className="panel-header"><div><p className="eyebrow">Реестр выплат</p><h2>Статьи сметы</h2></div></div>{obligations.length?<div className="collection-table-scroll"><table className="estimate-table"><thead><tr><th>Статья</th><th>Стоимость для пары</th>{state.canViewAgencyCommission&&<th>Агентская комиссия</th>}<th>Оплачено</th><th>Осталось</th><th><span className="sr-only">Действия</span></th></tr></thead><tbody>{obligations.map(item=>{const d=dataOf(item),paid=d.paid??fin.paid?.[item.id]??0;return <tr key={item.id}><td data-label="Статья"><button className="text-button" onClick={()=>onEditObligation(item)}>{d.title}</button><small>{d.dueDate?`Срок: ${dateLabel(d.dueDate)}`:d.condition||'Срок не указан'}</small></td><td data-label="Стоимость для пары">{d.priceKind==='included'?'Включено в пакет':d.agreed==null?'Цена не определена':money(d.agreed)}</td>{state.canViewAgencyCommission&&<td data-label="Агентская комиссия" className="v2-commission-amount">{d.agencyCommission?money(d.agencyCommission):'—'}</td>}<td data-label="Оплачено">{money(paid)}</td><td data-label="Осталось">{money(d.due??Math.max(0,(d.agreed||0)-paid))}</td><td className="estimate-actions"><button className="icon-button" aria-label={`Изменить статью ${d.title}`} onClick={()=>onEditObligation(item)}><Icon name="settings"/></button>{onDeleteObligation&&<button className="icon-button" aria-label={`Удалить статью ${d.title}`} onClick={()=>onDeleteObligation(item)}><Icon name="trash"/></button>}</td></tr>})}</tbody></table></div>:<Empty title="Смета пуста" text="Добавьте согласованную услугу или ориентировочную стоимость." action="Добавить статью" onAction={onAddObligation}/>}</section><CategoryList items={categories} onEdit={onCategory}/>{Object.keys(fin.byCategory||{}).length>0&&<section className="panel"><h2>Стоимость по категориям</h2>{Object.entries(fin.byCategory).map(([id,value])=><div className="data-row static" key={id}><span>{categories.find(c=>c.id===id)?.data.name||'Без категории'}</span><strong>{money(value)}</strong></div>)}</section>}<div className="filters ledger-filters"><label>Тип <select value={kind} onChange={e => setKind(e.target.value)}><option value="">Все</option>{[['deposit','Поступление'],['payment','Выплата'],['refund','Возврат'],['transfer','Передача'],['fee','Гонорар']].map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label><label>Месяц <input type="month" value={period} onChange={e => setPeriod(e.target.value)} /></label><label>Категория<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Все</option>{categories.map(c=><option value={c.id} key={c.id}>{c.data.name}</option>)}</select></label><label>С даты<input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label><label>По дату<input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label></div><Ledger movements={shown} onEdit={onEditMovement} onDelete={onDeleteMovement} /></>;
}
function Ledger({
  movements = [],
  agency,
  onEdit,
  onDelete
}) {
  return <section className="panel"><div className="panel-header"><div><p className="eyebrow">Журнал</p><h2>{agency ? 'Операции агентства' : 'Движение средств пары'}</h2></div></div>{movements.length ? <div className="data-list">{movements.map(move => {
        const d = dataOf(move);
        return <div key={move.id} className="data-row static"><div><strong>{d.description || d.type}</strong><small>{dateLabel(d.date)} · {agency ? 'Средства агентства' : d.source === 'custody' ? 'Средства пары у организатора' : 'Прямая оплата'}</small></div><span>{money(d.amount || 0)}</span><span>{onEdit && <button className="text-button" onClick={() => onEdit(move)}>Изменить</button>}{onDelete && <button className="text-button danger-text" onClick={() => onDelete(move)}>Удалить</button>}</span></div>;
      })}</div> : <p className="quiet-copy">Операций пока нет.</p>}</section>;
}
function ObligationForm({
  obligation,
  categories=[], users=[],
  showAgencyCommission=false,
  onClose,
  onSave
}) {
  const d = dataOf(obligation);
  const [f, set] = useForm({
    title: d.title || '',
    priceKind: d.priceKind || 'amount',
    agreed: d.agreed == null ? '' : Number(d.agreed) / 100,
    planned: d.planned == null ? '' : Number(d.planned) / 100,
    dueDate: d.dueDate || '',
    condition: d.condition || '',
    categoryId:d.categoryId||'',
    responsible: d.responsible || '',
    fee: !!d.fee,
    ...(showAgencyCommission?{agencyCommission:d.agencyCommission==null?'':Number(d.agencyCommission)/100}:{})
  });
  return <Modal title={obligation ? 'Статья сметы' : 'Новая статья сметы'} onClose={onClose}><SafeForm className="form-stack" onSubmit={async e => {
      e.preventDefault();
      const payload={
        ...f,
        agreed: f.priceKind === 'amount' && f.agreed !== '' ? Math.round(Number(f.agreed) * 100) : null,
        planned: f.planned === '' ? null : Math.round(Number(f.planned) * 100)
      };if(showAgencyCommission)payload.agencyCommission=f.agencyCommission===''?null:Math.round(Number(f.agencyCommission)*100);await onSave(payload);
      onClose();
    }}><FormField label="За что платим"><input autoFocus required value={f.title} onChange={e => set('title', e.target.value)} /></FormField><FormField label="Статус цены"><select value={f.priceKind} onChange={e => set('priceKind', e.target.value)}><option value="amount">Согласованная сумма</option><option value="unknown">Цена неизвестна</option><option value="included">Включено в другую услугу</option></select></FormField><div className="form-columns">{f.priceKind === 'amount' && <FormField label="Стоимость для пары, ₽"><input required type="number" step=".01" min="0" value={f.agreed} onChange={e => set('agreed', e.target.value)} /></FormField>}{showAgencyCommission&&<FormField label="Агентская комиссия, ₽" hint="Видна только организаторам и попадёт в прогноз кассы агентства."><input type="number" step=".01" min="0" value={f.agencyCommission} onChange={e=>set('agencyCommission',e.target.value)}/></FormField>}</div><FormField label="Оценка для пары, ₽"><input type="number" step=".01" min="0" value={f.planned} onChange={e => set('planned', e.target.value)} /></FormField><FormField label="Дата выплаты"><input type="date" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} /></FormField><FormField label="Условие оплаты"><input placeholder="После подтверждения площадки" value={f.condition} onChange={e => set('condition', e.target.value)} /></FormField><FormField label="Категория"><select value={f.categoryId} onChange={e=>set('categoryId',e.target.value)}><option value="">Без категории</option>{categories.filter(c=>!c.data.archived||c.id===f.categoryId).map(c=><option key={c.id} value={c.id}>{c.data.name}</option>)}</select></FormField><FormField label="Ответственный"><select value={f.responsible} onChange={e=>set('responsible',e.target.value)}><option value="">Не назначен</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></FormField><label className="check-field"><input type="checkbox" checked={f.fee} onChange={e => set('fee', e.target.checked)} /> Это гонорар агентства</label><FormActions onCancel={onClose} /></SafeForm></Modal>;
}
function MovementForm({
  projectId,
  agency,
  movement,
  obligations = [],
  users = [],
  categories = [], files = [],
  onClose,
  onSave
}) {
  const d = dataOf(movement);
  const [f, set] = useForm({
    type: d.type || (agency ? 'income' : 'deposit'),
    amount: d.amount == null ? '' : Number(d.amount) / 100,
    date: d.date || today(),
    description: d.description || '',
    source: d.source || (agency ? 'direct' : 'custody'),
    obligationId: d.obligationId || '',
    categoryId: d.categoryId || '',
    counterparty:d.counterparty||'',method:d.method||'',fileId:d.fileId||'',
    from: d.from || '',
    to: d.to || ''
  });
  const [error, setError] = useState('');
  const types = agency ? [['income', 'Доход агентства'], ['expense', 'Расход агентства']] : [['deposit', 'Получено от пары'], ['payment', 'Выплата подрядчику'], ['refund', 'Возврат паре'], ['transfer', 'Передача организатору'], ['fee', 'Оплата гонорара']];
  const needsObligation = ['payment', 'fee'].includes(f.type);
  const needsTo = ['deposit', 'transfer'].includes(f.type);
  const needsFrom = f.type === 'transfer' || f.type === 'refund' || needsObligation && f.source === 'custody';
  const submit = async e => {
    e.preventDefault();
    try {
      setError('');
      await onSave({
        projectId,
        data: {
          ...f,
          counterparty:f.counterparty||undefined,method:f.method||undefined,
          categoryId:f.type==='fee'?'':f.categoryId,
          amount: Math.round(Number(f.amount) * 100)
        }
      });
      onClose();
    } catch (caught) {
      setError(caught.message || 'Не удалось сохранить движение');
    }
  };
  return <Modal title={agency ? 'Операция агентства' : movement?.id ? 'Изменить движение' : 'Новое движение средств'} onClose={onClose}><SafeForm className="form-stack" onSubmit={submit}><FormField label="Тип"><select value={f.type} onChange={e => set('type', e.target.value)}>{types.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></FormField><div className="form-columns"><FormField label="Сумма, ₽"><input autoFocus required type="number" min="0.01" step=".01" value={f.amount} onChange={e => set('amount', e.target.value)} /></FormField><FormField label="Дата"><input required type="date" value={f.date} onChange={e => set('date', e.target.value)} /></FormField></div><FormField label="Описание"><input required value={f.description} onChange={e => set('description', e.target.value)} placeholder="Кому или за что" /></FormField>{needsObligation && <FormField label="Статья сметы"><select required value={f.obligationId} onChange={e => set('obligationId', e.target.value)}><option value="">Выберите статью</option>{obligations.map(o => <option key={o.id} value={o.id}>{dataOf(o).title}</option>)}</select></FormField>}{<FormField label="Категория"><select value={f.categoryId} onChange={e => set('categoryId', e.target.value)}><option value="">Без категории</option>{categories.map(c => <option key={c.id} value={c.id}>{dataOf(c).name}</option>)}</select></FormField>}{!agency && <FormField label="Контур денег"><select value={f.source} onChange={e => set('source', e.target.value)}><option value="custody">Средства пары у организаторов</option><option value="direct">Оплата напрямую</option></select></FormField>}{needsFrom && <FormField label="Выдавший организатор"><select required value={f.from} onChange={e => set('from', e.target.value)}><option value="">Выберите участника</option>{users.map(u => <option key={u.id} value={u.id}>{dataOf(u).name || dataOf(u).email}</option>)}</select></FormField>}{needsTo && <FormField label="Получивший организатор"><select required value={f.to} onChange={e => set('to', e.target.value)}><option value="">Выберите участника</option>{users.map(u => <option key={u.id} value={u.id}>{dataOf(u).name || dataOf(u).email}</option>)}</select></FormField>}<FormField label={f.type==='deposit'?'Кто передал деньги':'Кому передали деньги'}><input value={f.counterparty} onChange={e=>set('counterparty',e.target.value)} placeholder="Имя участника или подрядчика"/></FormField><FormField label="Способ оплаты"><input value={f.method} onChange={e=>set('method',e.target.value)} placeholder="Наличные, перевод, карта"/></FormField><FormField label="Подтверждение или расписка"><select value={f.fileId} onChange={e=>set('fileId',e.target.value)}><option value="">Без файла</option>{files.map(file=><option key={file.id} value={file.id}>{file.data.name}</option>)}</select></FormField>{error && <p className="form-error">{error}</p>}<FormActions onCancel={onClose} label="Сохранить движение" /></SafeForm></Modal>;
}
function Applications({
  state, onCreate,
  onReview,
  onRespond
}) {
  const apps = arr(state.applications);
  const [tab,setTab]=useState('new');
  const [answersItem,setAnswersItem]=useState(null);
  const newApps=apps.filter(item=>!dataOf(item).status||dataOf(item).status==='review');
  const processedApps=apps.filter(item=>dataOf(item).status&&dataOf(item).status!=='review');
  const visible=onReview?(tab==='new'?newApps:processedApps):apps;
  return <><PageHeader eyebrow="Заявки" title={onReview?"Входящие обращения":"Мои заявки"} action={!onReview&&!apps.length&&<button className="button" onClick={onCreate}>Оставить заявку</button>}/>{!onReview&&arr(state.notifications).length>0&&<section className="panel"><h2>Уведомления</h2>{state.notifications.map(n=><p key={n.id}>{n.data.message||n.data.title||n.data.text}</p>)}</section>}{onReview&&<div className="application-tabs" role="tablist" aria-label="Заявки на регистрацию"><button type="button" role="tab" aria-selected={tab==='new'} onClick={()=>setTab('new')}>Новые <span>{newApps.length}</span></button><button type="button" role="tab" aria-selected={tab==='processed'} onClick={()=>setTab('processed')}>Обработанные <span>{processedApps.length}</span></button></div>}<section className="panel">{visible.length ? <div className="data-list">{visible.map(item => {
          const d = dataOf(item);
          const needsResponse=['clarification','rejected'].includes(d.status);
          return <article className="application-row" key={item.id}><div><span className={`status-badge ${d.status || 'review'}`}>{statuses[d.status] || 'На рассмотрении'}</span><h2>{d.name}</h2>{onReview&&<div className="application-questionnaire-status"><span className={d.questionnaire?'is-complete':'is-missing'}>{d.questionnaire?'Анкета заполнена':'Анкета не заполнена'}</span>{d.questionnaire&&<button type="button" className="text-button" onClick={()=>setAnswersItem(item)}>Посмотреть ответы</button>}</div>}<p>{dateLabel(d.date)} · {d.contact}</p>{d.message && <p>{d.message}</p>}{d.reason && <p className="reason">Решение: {d.reason}</p>}</div>{onReview && ['review','clarification'].includes(d.status || 'review') && <button className="button quiet" onClick={() => onReview(item)}>Рассмотреть</button>}{!onReview && needsResponse && <button className="button" onClick={()=>onRespond(item)}>Уточнить заявку</button>}{!onReview && d.status==='review' && <span className="quiet-copy">Заявка принята и ожидает решения.</span>}{!onReview && d.status==='approved' && <span className="quiet-copy">Проект открыт в вашем кабинете.</span>}</article>;
        })}</div> : <Empty title={onReview&&tab==='processed'?'Обработанных заявок нет':'Новых заявок нет'} text={onReview&&tab==='processed'?'Заявки после решения появятся здесь.':'Обращения с публичной страницы появятся здесь.'} />}</section>{answersItem&&<Modal title={`Анкета — ${dataOf(answersItem).name}`} wide onClose={()=>setAnswersItem(null)}><div className="application-answers"><p className="application-answers-intro">Ответы пары · {dataOf(answersItem).questionnaireSubmittedAt?new Date(dataOf(answersItem).questionnaireSubmittedAt).toLocaleDateString('ru-RU'):'дата не указана'}</p>{questionnaireSections.map(section=><section key={section.title}><h3>{section.title}</h3>{section.questions.map(([id,label])=><div key={id}><strong>{label}</strong><p>{Array.isArray(dataOf(answersItem).questionnaire?.[id])?dataOf(answersItem).questionnaire[id].join(', '):dataOf(answersItem).questionnaire?.[id]||'—'}</p></div>)}</section>)}</div></Modal>}</>;
}
function ApplicationResponseForm({ application, onClose, onSave }) { const d=dataOf(application); const [f,set]=useForm({name:d.name||'',date:d.date||'',contact:d.contact||'',message:d.message||''}); const [error,setError]=useState(''); return <Modal title="Уточнить заявку" onClose={onClose}><SafeForm className="form-stack" onSubmit={async e=>{e.preventDefault();try{await onSave(f);onClose();}catch(caught){setError(caught.message||'Не удалось отправить уточнение');}}}><p className="form-intro">Исправьте или дополните данные. Заявка вернётся на рассмотрение.</p><FormField label="Как к вам обращаться"><input required value={f.name} onChange={e=>set('name',e.target.value)}/></FormField><FormField label="Дата свадьбы"><input required type="date" value={f.date} onChange={e=>set('date',e.target.value)}/></FormField><FormField label="Почта или телефон"><input required value={f.contact} onChange={e=>set('contact',e.target.value)}/></FormField><FormField label="Что уточнили"><textarea required value={f.message} onChange={e=>set('message',e.target.value)}/></FormField>{error&&<p className="form-error">{error}</p>}<FormActions onCancel={onClose} label="Отправить уточнение"/></SafeForm></Modal>; }
function ReviewForm({
  application,
  onClose,
  onSave
}) {
  const [f, set] = useForm({
    status: 'approved',
    reason: ''
  });
  return <Modal title="Рассмотреть заявку" onClose={onClose}><SafeForm className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave(f);
      onClose();
    }}><FormField label="Решение"><select value={f.status} onChange={e => set('status', e.target.value)}><option value="approved">Одобрить и создать свадьбу</option><option value="clarification">Запросить уточнение</option><option value="rejected">Отклонить</option></select></FormField><FormField label="Причина или сообщение" hint="Причина обязательна для уточнения и отклонения."><textarea required={f.status !== 'approved'} value={f.reason} onChange={e => set('reason', e.target.value)} /></FormField><FormActions onCancel={onClose} label="Сохранить решение" /></SafeForm></Modal>;
}
function Catalog({state,onCategory,projectMode,onVendor}) {
  const [query,setQuery]=useState(''),[archived,setArchived]=useState(false),[categoryTab,setCategoryTab]=useState('all');
  const all=byKind(state,projectMode?'selection':'vendor');
  const visibleItems=all.filter(item=>archived||!dataOf(item).archived);
  const categoryRows=projectMode?weddingVendorCategories(all,archived):new Map(byKind(state,'vendorCategory').map(category=>[category.id,{name:category.data.name,count:visibleItems.filter(item=>item.data.categoryId===category.id).length}]));
  const activeTab=categoryTab==='selected'||categoryRows.has(categoryTab)?categoryTab:'all';
  const canAdd=!projectMode||has(state,'catalog');
  const vendors=all.filter(v=>{
    const d=dataOf(v),matchesArchive=archived||!d.archived,matchesQuery=JSON.stringify(d).toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'));
    if(!matchesArchive||!matchesQuery)return false;
    if(activeTab==='all')return true;
    if(activeTab==='selected')return !!d.selected;
    return (d.categoryId||`name:${d.categoryName||'Без категории'}`)===activeTab;
  });
  const emptyTitle=activeTab==='selected'?'Пара ещё не сделала итоговый выбор':all.length?'Подрядчики не найдены':'Подборка пока не собрана';
  const emptyText=activeTab==='selected'?'Выбранные парой подрядчики появятся здесь автоматически.':all.length?'Измените запрос, категорию или включите архив.':'Организатор добавит сюда подходящие варианты.';
  return <><PageHeader eyebrow={projectMode?'Подбор подрядчиков':'Справочник агентства'} title="Подрядчики" action={canAdd?<button className="button" onClick={()=>onVendor()}><Icon name="plus"/>Добавить подрядчика</button>:null}><p className="subtitle">{projectMode?'Предложения организатора по категориям и итоговый выбор пары.':'Контакты, услуги и актуальные условия проверенной команды.'}</p></PageHeader><nav className="vendor-category-tabs" aria-label="Категории подрядчиков">{projectMode&&<button type="button" className={`vendor-final-tab ${activeTab==='selected'?'active':''}`} onClick={()=>setCategoryTab('selected')}>Итоговый выбор <span>{visibleItems.filter(item=>item.data.selected).length}</span></button>}<button type="button" className={activeTab==='all'?'active':''} onClick={()=>setCategoryTab('all')}>{projectMode?'Все предложения':'Все подрядчики'} <span>{visibleItems.length}</span></button>{[...categoryRows].map(([key,category])=><button type="button" key={key} className={activeTab===key?'active':''} onClick={()=>setCategoryTab(key)}>{category.name} <span>{category.count}</span></button>)}</nav><div className="filters collection-filters"><label className="search"><Icon name="search"/><input aria-label="Поиск подрядчика" placeholder="Имя, услуга или контакт" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="check-field"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Показать архив</label><span className="quiet-copy">Найдено: {vendors.length}</span></div>{!projectMode&&<CategoryList items={byKind(state,'vendorCategory')} onEdit={onCategory}/>}<div className="collection-vendors">{vendors.map(v=>{const d=dataOf(v),categoryName=d.categoryName||categoryRows.get(d.categoryId)?.name||'Без категории';return <article key={v.id} className="collection-vendor"><header><div className="vendor-monogram">{(d.title||d.name||'?').split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('')}</div><span className={`status-badge ${d.selected?'approved':''}`}>{d.archived?'В архиве':projectMode?(d.selected?'Выбор пары':'Предложен'):'В каталоге'}</span></header><small className="vendor-category-label">{categoryName}</small><h2>{d.title||d.name}</h2><p className="vendor-services">{d.services||d.category||'Услуги не указаны'}</p><p className="vendor-contact">{d.contact||'Контакты не указаны'}</p>{!projectMode&&<small className="quiet-copy">Обновлено {dateLabel(d.updatedOn)} · Свадеб: {(state.vendorHistory||[]).filter(h=>h.data.vendorId===v.id).length}</small>}<footer><strong>{d.price!=null?money(d.price):'Цена по запросу'}</strong><span className="vendor-card-actions">{d.portfolio&&<a className="button quiet small" href={d.portfolio} target="_blank" rel="noreferrer">Портфолио <Icon name="arrow"/></a>}<button className="button quiet small" onClick={()=>onVendor(v)}>Открыть</button></span></footer></article>})}</div>{!vendors.length&&<Empty title={emptyTitle} text={emptyText} action={canAdd&&!all.length?'Добавить подрядчика':null} onAction={()=>onVendor()}/>}</>;
}
function VendorForm({vendor,projectMode,categories=[],catalog=[],showAgencyCommission=false,readOnly=false,onSelect,onCreateCategory,onDelete,onClose,onSave}) {
 const d=dataOf(vendor),categoryOptions=d.categoryId&&!categories.some(c=>c.id===d.categoryId)?[...categories,{id:d.categoryId,data:{name:d.categoryName||'Текущая категория'}}]:categories;const [f,set]=useForm({name:d.name||d.title||'',contact:d.contact||'',services:d.services||'',price:d.price==null?'':d.price/100,terms:d.terms||'',notes:d.notes||'',portfolio:d.portfolio||'',updatedOn:d.updatedOn||today(),categoryId:d.categoryId||'',newCategoryName:'',vendorId:d.vendorId||'',selected:!!d.selected,dueDate:d.dueDate||'',workingTime:d.workingTime||'',archived:!!d.archived,...(projectMode&&showAgencyCommission?{agencyCommission:d.agencyCommission==null?'':d.agencyCommission/100}:{})});const [error,setError]=useState('');
 const choose=id=>{const v=catalog.find(v=>v.id===id);set('vendorId',id);if(v){for(const key of ['name','contact','services','terms','portfolio'])set(key,v.data[key]||'');set('price',v.data.price==null?'':v.data.price/100);set('categoryId',v.data.categoryId||'');}};
 if(readOnly)return <Modal title="Карточка подрядчика" onClose={onClose}><div className="vendor-readonly"><span className={`status-badge ${d.selected?'approved':''}`}>{d.selected?'Итоговый выбор':'Предложен организатором'}</span><small className="vendor-category-label">{d.categoryName||'Без категории'}</small><h2>{d.title||d.name}</h2><dl><div><dt>Услуги и пакет</dt><dd>{d.services||'Не указаны'}</dd></div><div><dt>Стоимость для пары</dt><dd>{d.price!=null?money(d.price):'Цена по запросу'}</dd></div><div><dt>Условия</dt><dd>{d.terms||'Не указаны'}</dd></div><div><dt>Контакты</dt><dd>{d.contact||'Не указаны'}</dd></div>{d.workingTime&&<div><dt>Время работы</dt><dd>{d.workingTime}</dd></div>}{d.notes&&<div><dt>Комментарий</dt><dd>{d.notes}</dd></div>}</dl><div className="dialog-actions">{d.portfolio&&<a className="button quiet" href={d.portfolio} target="_blank" rel="noreferrer">Открыть портфолио <Icon name="arrow"/></a>}<button type="button" className="button quiet" onClick={onClose}>Закрыть</button><button type="button" className="button" onClick={async()=>{try{await onSelect(!d.selected);onClose()}catch(caught){setError(caught.message||'Не удалось сохранить выбор')}}}>{d.selected?'Отменить выбор':'Выбрать подрядчика'}</button></div>{error&&<p className="form-error">{error}</p>}</div></Modal>;
 return <Modal title={projectMode?'Подрядчик для подборки':'Карточка подрядчика'} onClose={onClose}><SafeForm className="form-stack" onSubmit={async e=>{e.preventDefault();try{let categoryId=f.categoryId;if(categoryId==='__new__'){if(!f.newCategoryName.trim())throw new Error('Введите название новой категории');const created=await onCreateCategory(f.newCategoryName.trim());categoryId=created.id;}const {newCategoryName,...fields}=f;const payload={...fields,categoryId,...(projectMode?{title:f.name}:{}),price:f.price===''?null:Math.round(Number(f.price)*100)};if(projectMode&&showAgencyCommission)payload.agencyCommission=f.agencyCommission===''?null:Math.round(Number(f.agencyCommission)*100);await onSave(payload);onClose()}catch(e){setError(e.message)}}}>
 {projectMode&&catalog.length>0&&<FormField label="Выбрать из каталога"><select value={f.vendorId} onChange={e=>choose(e.target.value)}><option value="">Свой вариант</option>{catalog.filter(v=>!v.data.archived).map(v=><option key={v.id} value={v.id}>{v.data.name}</option>)}</select></FormField>}
 <FormField label="Имя или название"><input required value={f.name} onChange={e=>set('name',e.target.value)}/></FormField><FormField label="Контакты"><input value={f.contact} onChange={e=>set('contact',e.target.value)}/></FormField><FormField label="Услуги и пакет"><textarea value={f.services} onChange={e=>set('services',e.target.value)}/></FormField>
 <FormField label="Категория"><select value={f.categoryId} onChange={e=>set('categoryId',e.target.value)}><option value="">Без категории</option>{categoryOptions.filter(c=>!c.data.archived||c.id===d.categoryId).map(c=><option key={c.id} value={c.id}>{c.data.name}</option>)}{onCreateCategory&&<option value="__new__">+ Создать новую категорию</option>}</select></FormField>{f.categoryId==='__new__'&&<FormField label="Название новой категории" hint="После сохранения она появится в списке для следующих подрядчиков."><input required autoFocus maxLength="240" value={f.newCategoryName} onChange={e=>set('newCategoryName',e.target.value)}/></FormField>}<div className={projectMode&&showAgencyCommission?'form-columns':undefined}><FormField label={projectMode?'Стоимость для пары, ₽':'Актуальная цена, ₽'}><input type="number" min="0" step="0.01" value={f.price} onChange={e=>set('price',e.target.value)}/></FormField>{projectMode&&showAgencyCommission&&<FormField label="Агентская комиссия, ₽" hint="Пара эту сумму не увидит."><input type="number" min="0" step="0.01" value={f.agencyCommission} onChange={e=>set('agencyCommission',e.target.value)}/></FormField>}</div><FormField label="Условия"><textarea value={f.terms} onChange={e=>set('terms',e.target.value)}/></FormField><FormField label="Портфолио"><input type="url" value={f.portfolio} onChange={e=>set('portfolio',e.target.value)}/></FormField>
 {projectMode?<><label className="check-field"><input type="checkbox" checked={f.selected} onChange={e=>set('selected',e.target.checked)}/>Итоговый выбор пары — включить в смету</label><FormField label="Дата выплаты"><input type="date" value={f.dueDate} onChange={e=>set('dueDate',e.target.value)}/></FormField><FormField label="Время работы"><input value={f.workingTime} onChange={e=>set('workingTime',e.target.value)}/></FormField></>:<FormField label="Дата обновления"><input type="date" value={f.updatedOn} onChange={e=>set('updatedOn',e.target.value)}/></FormField>}
 <FormField label={projectMode?'Заметка для пары и команды':'Внутренняя заметка агентства'}><textarea value={f.notes} onChange={e=>set('notes',e.target.value)}/></FormField>{!projectMode&&<label className="check-field"><input type="checkbox" checked={f.archived} onChange={e=>set('archived',e.target.checked)}/>В архиве</label>}{error&&<p className="form-error">{error}</p>}{onDelete&&<button type="button" className="text-button danger-text" onClick={onDelete}>Удалить запись</button>}<FormActions onCancel={onClose}/></SafeForm></Modal>;
}

function Roles({
  state,
  onRole,
  onGrant,
  onCreateUser,
  onPassword,
  onRemove,
  onRestore
}) {
  const roles = arr(state.roles);
  const users = arr(state.users);
  const canEditRoles=has(state,'access');
  const [query,setQuery]=useState('');
  const [showDisabled,setShowDisabled]=useState(false);
  const normalizedQuery=query.trim().toLocaleLowerCase('ru');
  const matches=user=>`${user.name||''} ${user.email||''}`.toLocaleLowerCase('ru').includes(normalizedQuery);
  const activeUsers=users.filter(user=>!user.disabled&&matches(user));
  const disabledUsers=users.filter(user=>user.disabled);
  const filteredDisabled=disabledUsers.filter(matches);
  const disabledVisible=showDisabled||Boolean(normalizedQuery);
  const userRow=user=><div className={`user-management-row${user.disabled?' is-disabled':''}`} key={user.id}><div className="user-management-identity"><span className="user-management-initial" aria-hidden="true">{(user.name||user.email).slice(0,1).toUpperCase()}</span><div><strong>{user.name||user.email}</strong><small>{user.email}</small></div></div><span className={`user-management-status${user.disabled?'':' is-active'}`}>{user.disabled?'Деактивирован':user.protected?'Защищён':'Активен'}</span>{user.manageable&&<div className="user-management-actions">{canEditRoles&&<button type="button" className="text-button" onClick={()=>onGrant(user)}>Доступ</button>}{user.disabled?<button type="button" className="text-button" onClick={()=>onRestore(user)}>Восстановить</button>:<><button type="button" className="text-button" onClick={()=>onPassword(user)}>Сменить пароль</button><button type="button" className="text-button danger-text" onClick={()=>onRemove(user)}>Удалить</button></>}</div>}</div>;
  return <><div className="settings-section-heading"><div><span>Люди и роли</span><h2>Доступ к агентству</h2><p>Здесь видны все зарегистрированные пользователи. Управлять чужим доступом можно только в пределах своих прав.</p></div><div className="button-group">{canEditRoles&&<button className="button quiet" onClick={() => onGrant()}>Назначить доступ</button>}{canEditRoles&&<button className="button quiet" onClick={() => onRole()}><Icon name="plus" />Роль</button>}<button className="button" onClick={onCreateUser}><Icon name="plus"/>Пользователь</button></div></div><div className={canEditRoles?'split-grid user-management-layout':undefined}>{canEditRoles&&<section className="panel"><div className="panel-header"><h2>Роли</h2></div><div className="data-list">{roles.map(role => {
            const d = dataOf(role);
            return <button className="data-row" key={role.id} onClick={() => onRole(role)}><div><strong>{d.name}</strong><small>{arr(d.permissions).map(p => permissionLabels[p] || p).join(' · ') || 'Нет прав'}</small></div><Icon name="arrow" /></button>;
          })}</div></section>}<section className="panel"><div className="panel-header"><h2>Активные пользователи <span className="settings-count">{activeUsers.length}</span></h2></div><label className="settings-user-search"><Icon name="search"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Поиск по имени или почте" aria-label="Поиск пользователей"/></label><div className="user-management-list">{activeUsers.map(userRow)}{!activeUsers.length&&<p className="settings-user-empty">{normalizedQuery?'Активные пользователи не найдены.':'Активных пользователей пока нет.'}</p>}</div><div className="user-management-archive"><button type="button" className="user-management-archive-toggle" aria-expanded={disabledVisible} onClick={()=>setShowDisabled(value=>!value)}><span><Icon name="folder"/>Деактивированные</span><span className="settings-count">{disabledUsers.length}</span><Icon name="arrow"/></button>{disabledVisible&&<div className="user-management-list user-management-disabled-list">{filteredDisabled.map(userRow)}{!filteredDisabled.length&&<p className="settings-user-empty">{normalizedQuery?'Деактивированные пользователи не найдены.':'Деактивированных пользователей пока нет.'}</p>}</div>}</div></section></div></>;
}
function RoleForm({
  role,
  onClose,
  onSave,
  onDelete
}) {
  const d = dataOf(role);
  const [f, set] = useForm({
    name: d.name || '',
    permissions: arr(d.permissions)
  });
  const toggle = p => set('permissions', f.permissions.includes(p) ? f.permissions.filter(x => x !== p) : [...f.permissions, p]);
  return <Modal wide title={role ? 'Роль' : 'Новая роль'} onClose={onClose}><SafeForm className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave(f);
      onClose();
    }}><FormField label="Название"><input autoFocus required value={f.name} onChange={e => set('name', e.target.value)} /></FormField><fieldset className="permission-grid"><legend>Разрешения</legend>{permissions.map(p => <label key={p}><input type="checkbox" checked={f.permissions.includes(p)} onChange={() => toggle(p)} />{permissionLabels[p]}</label>)}</fieldset>{onDelete&&<button type="button" className="text-button danger-text" onClick={onDelete}>Удалить роль</button>}<FormActions onCancel={onClose} /></SafeForm></Modal>;
}


function Settings({
  state,
  onSave
}) {
  const d = dataOf(state.agency);
  const [f, set] = useForm({
    name: d.name || '',
    tagline: d.settings?.tagline || '',
    description: d.settings?.description || '',
    contact: d.settings?.contact || '',
    services: arr(d.settings?.services).join('\n'), portfolio:arr(d.settings?.portfolio)
  });
  return <><div className="settings-section-heading"><div><span>Публичная страница</span><h2>Сайт агентства</h2><p>Название, описание и контакты, которые увидят будущие пары.</p></div></div><section className="settings-site-layout"><SafeForm className="panel form-stack" onSubmit={async e => {
        e.preventDefault();
        await onSave({
          name: f.name,
          settings: {
            tagline: f.tagline,
            description: f.description,
            contact: f.contact,
            services: f.services.split('\n').filter(Boolean),
            portfolio: f.portfolio
          }
        });
      }}><FormField label="Название агентства"><input required value={f.name} onChange={e => set('name', e.target.value)} /></FormField><FormField label="Фраза на публичной странице"><input value={f.tagline} onChange={e => set('tagline', e.target.value)} /></FormField><FormField label="Описание"><textarea value={f.description} onChange={e => set('description', e.target.value)} /></FormField><FormField label="Контакт"><input value={f.contact} onChange={e => set('contact', e.target.value)} /></FormField><FormField label="Услуги, по одной в строке"><textarea value={f.services} onChange={e => set('services', e.target.value)} /></FormField><fieldset className="form-stack"><legend>Портфолио публичного сайта</legend>{f.portfolio.map((item,i)=><div key={i} className="form-stack"><FormField label="Название истории"><input required value={item.title} onChange={e=>set('portfolio',f.portfolio.map((x,n)=>n===i?{...x,title:e.target.value}:x))}/></FormField><FormField label="Изображение (ссылка)"><input required type="url" value={item.image} onChange={e=>set('portfolio',f.portfolio.map((x,n)=>n===i?{...x,image:e.target.value}:x))}/></FormField><FormField label="Описание истории"><textarea value={item.description||''} onChange={e=>set('portfolio',f.portfolio.map((x,n)=>n===i?{...x,description:e.target.value}:x))}/></FormField><button type="button" className="text-button danger-text" onClick={()=>set('portfolio',f.portfolio.filter((_,n)=>n!==i))}>Удалить историю</button></div>)}<button type="button" className="text-button" onClick={()=>set('portfolio',[...f.portfolio,{title:'',image:'',description:''}])}>+ История</button></fieldset><div><button className="button">Сохранить настройки</button></div></SafeForm><aside className="settings-site-note"><span>tie.event</span><p>Эти данные используются на публичной странице агентства. Истории, пакеты услуг и частые вопросы редактируются ниже, в разделе публикаций.</p><a href="/" target="_blank" rel="noreferrer">Открыть сайт ↗</a></aside></section></>;
}
function SettingsDirectories({state,onTemplate,onVendor,onVendorCategory,onFinanceCategory}){
  const options=[
    ...(has(state,'catalog')?[['vendors','Подрядчики'],['vendorCategories','Категории подрядчиков']]:[]),
    ...(has(state,'templates')?[['templates','Шаблоны свадеб']]:[]),
    ...(has(state,'agencyFinance')?[['financeCategories','Категории агентства']]:[])
  ];
  const [selected,setSelected]=useState(options[0]?.[0]||'vendors');
  const current=options.some(([id])=>id===selected)?selected:options[0]?.[0];
  const categoryKind=current==='vendorCategories'?'vendorCategory':'category';
  const categories=byKind(state,categoryKind);
  const heading=current==='vendorCategories'?'Категории подрядчиков':'Категории агентства';
  return <><div className="settings-section-heading"><div><span>Структура работы</span><h2>Справочники</h2><p>Общие записи агентства для новых и действующих свадеб.</p></div></div><nav className="settings-subtabs" aria-label="Справочники">{options.map(([id,label])=><button key={id} type="button" className={current===id?'active':''} aria-current={current===id?'page':undefined} onClick={()=>setSelected(id)}>{label}</button>)}</nav>
    {current==='vendors'&&<Catalog state={state} onCategory={onVendorCategory} onVendor={onVendor}/>}
    {current==='templates'&&<section className="panel settings-directory-panel"><div className="panel-header"><div><h2>Шаблоны свадеб</h2><p>Изменения применятся только к новым проектам.</p></div><button className="button" onClick={()=>onTemplate()}>Создать шаблон</button></div><div className="data-list">{byKind(state,'template').map(item=><button className="data-row" key={item.id} onClick={()=>onTemplate(item)}><div><strong>{item.data.name}</strong><small>{arr(item.data.tables).length} таблиц</small></div><Icon name="arrow"/></button>)}</div></section>}
    {['vendorCategories','financeCategories'].includes(current)&&<section className="panel settings-directory-panel"><div className="panel-header"><div><h2>{heading}</h2><p>{current==='vendorCategories'?'Откройте категорию, чтобы переименовать, архивировать или удалить её.':'Используйте категории для единообразных подборок и записей.'}</p></div><button className="button" onClick={()=>current==='vendorCategories'?onVendorCategory():onFinanceCategory()}>Добавить категорию</button></div><div className="data-list">{categories.map(item=><button className="data-row" key={item.id} onClick={()=>current==='vendorCategories'?onVendorCategory(item):onFinanceCategory(item)}><div><strong>{item.data.name}</strong><small>{item.data.archived?'В архиве':'Активна'}</small></div><Icon name="arrow"/></button>)}{!categories.length&&<p className="settings-user-empty">Категорий пока нет.</p>}</div></section>}
  </>;
}
function SettingsWorkspace({state,workspaceMode,onWorkspace,site,publication,access,integrations,directories}){
  const tabs=[...(site||publication?[['site','Сайт']]:[]),...(access?[['access','Доступ']]:[]),['integrations','Интеграции'],...(directories?[['directories','Справочники']]:[])];
  const [selected,setSelected]=useState(tabs[0]?.[0]||'integrations');
  const [siteSection,setSiteSection]=useState(site?'details':'publication');
  const tab=tabs.some(([id])=>id===selected)?selected:tabs[0][0];
  return <div className="settings-workspace"><PageHeader eyebrow="Агентство" title="Настройки"/><div className="settings-workspace-top"><div><span>Центр управления</span><p>Сайт, люди, подключения и общие справочники — в одном месте.</p></div>{onWorkspace&&<label className="settings-workspace-select"><span>Рабочее пространство</span><select aria-label="Рабочее пространство" value={workspaceMode} onChange={event=>onWorkspace(event.target.value)}><option value="organizer">Организаторы</option><option value="couple">Молодожёны</option><option value="contractor">Подрядчики</option></select></label>}</div><nav className="settings-workspace-tabs" role="tablist" aria-label="Разделы настроек">{tabs.map(([id,label])=><button key={id} type="button" role="tab" aria-selected={tab===id} onClick={()=>setSelected(id)}>{label}</button>)}</nav><div className="settings-workspace-body" role="tabpanel">
    {tab==='site'&&<>{site&&publication&&<nav className="settings-subtabs" aria-label="Разделы сайта"><button type="button" className={siteSection==='details'?'active':''} onClick={()=>setSiteSection('details')}>О сайте</button><button type="button" className={siteSection==='publication'?'active':''} onClick={()=>setSiteSection('publication')}>Публикации</button></nav>}{siteSection==='details'&&site?site:publication||site}</>}
    {tab==='access'&&access}
    {tab==='integrations'&&<><div className="settings-section-heading"><div><span>Подключения</span><h2>Интеграции</h2><p>Календарь и уведомления, которые помогают команде не терять важное.</p></div></div>{integrations}</>}
    {tab==='directories'&&directories}
  </div></div>;
}
function Offline({
  project,
  status,
  onPrepare,
  onSync,
  onDiscard,
  onRetry
}) {
  return <section className="offline-card"><div><span className="offline-symbol"><Icon name="offline" /></span><div><p className="eyebrow">Офлайн</p><h2>{status?.preparedAt ? 'Проект подготовлен' : 'Подготовьте работу без сети'}</h2><p>{status?.preparedAt ? `Снимок сохранён ${new Date(status.preparedAt).toLocaleString('ru-RU')}.` : 'Сохранятся только отмеченные таблицы и допустимые изменения строк.'}</p></div></div><div className="button-group"><button className="button quiet" onClick={onPrepare}>Подготовить проект</button><button className="button" onClick={onSync}>Синхронизировать {status?.pending ? `(${status.pending})` : ''}</button></div>{arr(status?.conflicts).length > 0 && <div className="conflicts"><h3>Нужно решить конфликты</h3>{status.conflicts.map(c => <div key={c.id}><p>{c.error || 'Версия данных изменилась на сервере.'}</p><button className="text-button" onClick={() => onRetry(c.id)}>Сравнить и решить</button><button className="text-button danger-text" onClick={() => onDiscard(c.id)}>Удалить из очереди</button></div>)}</div>}</section>;
}
function TableLibrary({tables,sections,setView,onSection,onTable}) {
 const [archive,showArchive]=useState(false);
 return <><div className="table-tools"><button className="button quiet" onClick={()=>onSection()}>+ Раздел</button><label className="check-field"><input type="checkbox" checked={archive} onChange={e=>showArchive(e.target.checked)}/>Показать архив</label></div>{[...sections].filter(s=>archive||!s.data.archived).sort((a,b)=>a.data.order-b.data.order).map(section=><section className="panel" key={section.id}><div className="panel-header"><h2>{section.data.name}{section.data.archived?' · Архив':''}</h2><div className="button-group"><button className="text-button" onClick={()=>onSection(section)}>Изменить</button><button className="text-button danger-text" onClick={()=>onSection(section,'delete')}>Удалить</button></div></div><div className="card-list">{tables.filter(t=>t.data.sectionId===section.id&&(archive||!t.data.archived)).sort((a,b)=>a.data.order-b.data.order).map(table=><article className="vendor-card" key={table.id}><button className="vendor-monogram" aria-label={`Открыть ${table.data.name}`} onClick={()=>setView(`project:table:${table.id}`)}>▦</button><div><h2>{table.data.name}{table.data.archived?' · Архив':''}</h2><p>{table.data.columns.length} колонок · {table.data.offline?'офлайн':'онлайн'}</p></div><div><button className="text-button" onClick={()=>onTable(table)}>Изменить</button><button className="text-button danger-text" onClick={()=>onTable(table,'delete')}>Удалить</button></div></article>)}</div></section>)}</>;
}

function Workspace({
  state,
  view,
  setView,
  onProjectEdit,
  onMovement,
  onAddObligation,
  onEditObligation,
  onTable,
  onVendor,
  onEditMovement,
  onDeleteMovement,
  onCreateTable,
  onSection,
  offline,
  offlineActions,
  onFile,
  onInvite,
  onRestore, onCategory, onDeleteObligation, onBudgetCell, onBudgetStructure, runV2
}) {
  const [, tab = 'overview', targetTableId] = view.split(':');
  const [timingMode,setTimingMode]=useState('timeline'),[timingRow,setTimingRow]=useState(null);
  useEffect(()=>{setTimingMode('timeline');setTimingRow(null)},[view]);
  const entities = arr(state.entities);
  const tables = entities.filter(e => e.kind === 'table' && !e.deleted);
  const table = findProjectTable(tables, tab, targetTableId);
  const rows = table ? entities.filter(e => e.parent_id === table.id && !e.deleted) : [];
  const audience=tab==='timing-pair'?'Пара':tab==='timing-team'?'Команда':null;
  const tableExport=()=>downloadTableXlsx({
    project:dataOf(state.project).name,
    table,
    rows,
    relationRows:entities.filter(e=>['row','seatingTable'].includes(e.kind)),
    files:entities.filter(e=>e.kind==='file'&&!e.deleted),
    members:state.assignableMembers||state.members||[],
    audience,
    title:audience?`Тайминг — ${audience.toLowerCase()}`:dataOf(table).name,
    fileName:`${dataOf(state.project).name} — ${audience==='Пара'?'тайминг пары':audience==='Команда'?'тайминг команды':dataOf(table).name}`
  });
  let content;
  if (tab === 'payouts' || (state.offline && !state.financials && ['overview','estimate'].includes(tab))) content=<Payouts state={state} onPay={onMovement}/>;else if(tab==='offline')content=<PageHeader eyebrow="Работа без сети" title="Данные на этом устройстве"/>;else if (tab === 'overview') content = <Overview state={state} onProjectEdit={onProjectEdit} openTab={key => setView(`project:${key}`)} onMovement={onMovement} />;else if (tab === 'estimate') content = <Finance state={state} onBudgetCell={onBudgetCell} onBudgetStructure={onBudgetStructure} onDocuments={()=>setView('project:files')} onCategory={onCategory} onDeleteObligation={onDeleteObligation} onMovement={onMovement} onAddObligation={onAddObligation} onEditObligation={onEditObligation} onEditMovement={onEditMovement} onDeleteMovement={onDeleteMovement} />;else if (tab === 'catalog') content = <Catalog state={state} projectMode onVendor={onVendor} />;else if (tab === 'files') content = <Files state={state} onFile={onFile} />;else if (tab === 'history') content = <History state={state} onRestore={onRestore} />;else if (tab === 'tables') content = <><PageHeader eyebrow="Структура проекта" title="Все рабочие таблицы" action={<button className="button" onClick={onCreateTable}><Icon name="plus"/>Таблица</button>}/><TableLibrary tables={tables} sections={entities.filter(e=>e.kind==='section'&&!e.deleted)} setView={setView} onSection={onSection} onTable={(item,action)=>action==='delete'?onTable('delete',item):onTable('structure',item)}/></>;else content = <>{!tab.startsWith('timing')&&<PageHeader eyebrow="Рабочая таблица" title={dataOf(table).name || (tab === 'guests' ? 'Гости и рассадка' : 'Тайминг дня')} action={<button className="button quiet" onClick={onInvite}><Icon name="plus" />Пригласить участника</button>} />}{tab.startsWith('timing')&&runV2&&!state.offline&&<details className="v2-timing-details"><summary>Настройка календаря и ответственных</summary><TimingSetup state={state} projectId={state.project.id} table={table} run={runV2}/></details>}{tab.startsWith('timing')&&<div className="collection-view-toggle" aria-label="Вид тайминга"><button className={timingMode==='timeline'?'active':''} aria-pressed={timingMode==='timeline'} onClick={()=>setTimingMode('timeline')}>Программа дня</button><button className={timingMode==='table'?'active':''} aria-pressed={timingMode==='table'} onClick={()=>{setTimingRow(null);setTimingMode('table')}}>Рабочая таблица</button></div>}{tab.startsWith('timing')&&timingMode==='timeline'?<TimingView table={table} rows={rows} members={state.assignableMembers||state.members||[]} audience={audience} onExport={tableExport} canCreate={permitted(state,'create',table?.id,null,null)} canEditRow={row=>(table?.data?.columns||[]).some(col=>permitted(state,'edit',table?.id,row.id,col.id))} onEditRow={row=>{setTimingRow(row.id);setTimingMode('table')}} onAddRow={async()=>{await onTable('add',table);setTimingRow(null);setTimingMode('table')}}/>:<TableWorkspace initialEditRowId={timingRow} members={state.assignableMembers||state.members||[]} key={table?.id} relationRows={entities.filter(e=>['row','seatingTable'].includes(e.kind))} table={table} rows={rows} files={entities.filter(e=>e.kind==='file'&&!e.deleted)} audience={audience} onExport={tableExport} canEdit={has(state,'edit',state.project.id)} canCreate={permitted(state,'create',table?.id,null,null)} canStructure={permitted(state,['edit','structure'],table?.id,table?.id,null)} canEditField={(row,col)=>permitted(state,'edit',table?.id,row.id,col.id)} canDeleteRow={row=>permitted(state,'delete',table?.id,row.id,null)} onEditRow={(row, data) => onTable('edit', row, data)} onAddRow={() => onTable('add', table)} onEditTable={() => onTable('structure', table)} onDeleteRow={row => onTable('delete', row)} onReorder={rowOrder=>onTable('reorder',table,rowOrder)} />}</>;
  return <>{content}{['files','catalog'].includes(tab)&&runV2&&<VerificationPanel state={state} projectId={state.project.id} run={runV2} type={tab==='files'?'file':'selection'}/>}{(tab==='offline'||offline?.pending||arr(offline?.conflicts).length>0)&&<Offline project={state.project} status={offline} {...offlineActions} />}</>;
}
const documentSections=[['personal','Личные'],['pending_signature','На подпись'],['signed','Подписано']];
function Files({state,onFile}) {
  const [section,setSection]=useState('personal');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const all=arr(state.files||state.entities).filter(x=>x.kind==='file'&&!x.deleted),files=all.filter(file=>(dataOf(file).documentStatus||'personal')===section);
  const choose=async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setError('');if(file.size<1||file.size>PROJECT_FILE_MAX_BYTES){setError('Размер файла: от 1 байта до 5 МБ');return;}setBusy(true);try{await onFile(file,section)}catch(caught){setError(caught.message||'Не удалось загрузить файл')}finally{setBusy(false)}};
  return <><PageHeader eyebrow="Свадьба" title="Документы" action={<label className={`button ${busy?'disabled':''}`} aria-disabled={busy}><input className="sr-only" type="file" disabled={busy} onChange={choose}/><Icon name="plus"/>{busy?'Загружаем…':`Загрузить в «${documentSections.find(([key])=>key===section)?.[1]}»`}</label>}/><p className="quiet-copy">До 5 МБ. Формат файла не ограничен.</p>{error&&<p className="form-error" role="alert">{error}</p>}<nav className="v2-document-tabs" aria-label="Разделы документов">{documentSections.map(([key,label])=><button key={key} className={section===key?'active':''} onClick={()=>setSection(key)}>{label}<span>{all.filter(file=>(dataOf(file).documentStatus||'personal')===key).length}</span></button>)}</nav><section className="panel">{files.length?<div className="data-list">{files.map(file=><a className="data-row" key={file.id} href={`/api/files/${file.id}`}><div><strong>{dataOf(file).name||'Документ'}</strong><small>{dataOf(file).size?`${Math.round(dataOf(file).size/1024)} КБ`:'Скачать документ'}</small></div><Icon name="arrow"/></a>)}</div>:<Empty title="В этом разделе документов пока нет" text="Загрузите документ — он останется внутри этой свадьбы."/>}</section></>;
}

const historyActions={create:'Создано',edit:'Изменено',delete:'Удалено',restore:'Восстановлено',setStatus:'Изменён статус',setOrganizerFocus:'Изменён список организатора',guest_rsvp_set:'Обновлён ответ гостя',seating_assign:'Гость рассажен',seating_unassign:'Гость снят с места',seating_plan_save:'Изменён план зала',seating_table_edit:'Изменён стол',guest_columns_migration:'Обновлена структура гостей'};
const historyFields={title:'Название',name:'Название',date:'Дата',dueDate:'Дедлайн',fixedDate:'Фиксированная дата',offsetDays:'Смещение срока',status:'Статус',agreed:'Стоимость для пары',planned:'Плановая стоимость',agencyCommission:'Агентская комиссия',priceKind:'Статус цены',categoryId:'Категория',condition:'Условие оплаты',responsible:'Ответственный',location:'Место',limit:'Лимит бюджета',selected:'Итоговый выбор',terms:'Условия',portfolio:'Портфолио',documentStatus:'Раздел документа',label:'Название',capacity:'Количество мест',shape:'Форма',widthM:'Ширина',heightM:'Высота'};
const historyIgnored=new Set(['id','version','updated_at','organizerFocusedAt','organizerFocusedBy','sourceTemplateId','sourceTemplateVersion','sourceTemplateKey','order']);
const historyParse=value=>{try{return JSON.parse(value||'null')}catch{return null}};
const historyOptions={status:{todo:'К выполнению',doing:'В работе',done:'Готово',skipped:'Не требуется',planning:'Подготовка',confirmed:'Подтверждено',completed:'Завершено',archived:'Архив'},priceKind:{amount:'Согласованная сумма',unknown:'Цена неизвестна',included:'Включено'},documentStatus:{personal:'Личные',pending_signature:'На подпись',signed:'Подписано'},shape:{round150:'Круглый 150 см',round:'Круглый 180 см',rect:'Прямоугольный 180 × 90 см',snakeQuarter:'Змейка ¼ круга',custom:'Своя форма'},priority:{normal:'Обычный',high:'Высокий'},dueMode:{relative:'От даты свадьбы',fixed:'Фиксированная дата'}};
const historyValue=(key,value,state)=>{if(value===null||value===undefined||value==='')return 'Не указано';if(historyOptions[key]?.[value])return historyOptions[key][value];if(['agreed','planned','agencyCommission','limit'].includes(key)&&Number.isFinite(Number(value)))return money(Number(value));if(typeof value==='boolean')return value?'Да':'Нет';const references=[...(state.entities||[]),...(state.global||[]),...(state.assignableMembers||[]),...(state.members||[])],resolve=id=>{const found=references.find(item=>item.id===id),data=dataOf(found);return data.title||data.name||data.label||found?.name||null};if(Array.isArray(value))return value.length?value.map(item=>resolve(item)||'Выбрано').join(', '):'Нет';if(key.endsWith('Id'))return resolve(value)||'Выбрано';if(typeof value==='object')return 'Состав списка изменён';return String(value)};
const historyCategory=(kind,keys)=>keys.some(key=>['dueDate','fixedDate','offsetDays','date'].includes(key))?'Дедлайны':['obligation','movement','category','coupleBudget'].includes(kind)||keys.some(key=>['agreed','planned','agencyCommission','priceKind','limit'].includes(key))?'Смета':['task','comment'].includes(kind)?'Задачи':['vendor','vendorCategory','selection'].includes(kind)?'Подрядчики':['seatingPlan','seatingTable'].includes(kind)?'Рассадка':kind==='file'?'Документы':['row','table'].includes(kind)?'Гости':'Общее';
function historyDetails(item,state){const beforeRow=historyParse(item.before_json),afterRow=historyParse(item.after_json),before=beforeRow?.data||{},after=afterRow?.data||{},record=(state.entities||[]).find(row=>row.id===item.entity_id),table=(state.entities||[]).find(row=>row.id===(record?.parent_id||afterRow?.parent_id||beforeRow?.parent_id)),columns=new Map((table?.data?.columns||[]).map(column=>[column.id,column.name])),keys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!historyIgnored.has(key)&&JSON.stringify(before[key])!==JSON.stringify(after[key]));return {category:historyCategory(item.kind,keys),changes:keys.slice(0,12).map(key=>({label:historyFields[key]||columns.get(key)||'Данные записи',before:historyValue(key,before[key],state),after:historyValue(key,after[key],state)}))};}
function History({
  state,
  onRestore
}) {
  const items=arr(state.history);
  return <><PageHeader eyebrow="Только для агентства" title="История изменений"/><section className="v2-history-list">{items.length?items.map(item=>{const details=historyDetails(item,state);return <article className="panel v2-history-card" key={item.id}><header><span>{details.category}</span><div><strong>{historyActions[item.action]||'Изменение'}</strong><small>{new Date(item.created_at).toLocaleString('ru-RU')} · {item.author||'Система'}</small></div>{item.entity_id&&item.before_json&&<button className="text-button" onClick={()=>onRestore(item)}>Восстановить</button>}</header>{details.changes.length?<div className="v2-history-changes">{details.changes.map((change,index)=><div key={`${change.label}-${index}`}><b>{change.label}</b><span>{change.before}</span><i>стало</i><strong>{change.after}</strong></div>)}</div>:<p className="quiet-copy">Запись создана или служебное состояние обновлено.</p>}</article>}):<p className="quiet-copy">История изменений появится после первой правки.</p>}</section></>;
}
function App() {
  const [mode, setMode] = useState('loading'),
    [state, setState] = useState(null),
    [publicInfo, setPublicInfo] = useState(null),
    [view, setViewState] = useState('today'),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(null),
    [offline, setOffline] = useState(null),
    [selected, setSelected] = useState(null),
    [catalogCache,setCatalogCache]=useState([]),
    [availableProjects,setAvailableProjects]=useState([]),
    [workspaceMode,setWorkspaceMode]=useState(initialAdminWorkspace);
  const flash = (text, kind = 'success') => setNotice({
    text,
    kind
  });
  const refresh = useCallback(async projectId => {
    const next = await loadState(projectId);
    if(Array.isArray(next.projects))setAvailableProjects(next.projects);
    setState(next);
    return next;
  }, []);
  const activeProject = useRef(null),workspaceModeRef=useRef(workspaceMode);
  const saveWorkspaceMode=next=>{workspaceModeRef.current=next;setWorkspaceMode(next);try{sessionStorage.setItem(adminWorkspaceKey,next)}catch{}};
  const historyIndex=useRef(history.state?.tieIndex??0),ignorePop=useRef(false),scrollRestore=useRef(null),restoringScroll=useRef(false);
  const clearScrollRestore=()=>{scrollRestore.current=null;restoringScroll.current=false};
  const rememberScroll=()=>{if(restoringScroll.current)return;history.replaceState({...history.state,tieIndex:historyIndex.current,workspaceMode:workspaceModeRef.current,scrollX:window.scrollX,scrollY:window.scrollY},'',location.href)};
  const setView=(next,{skipGuard=false,replace=false}={})=>{
    const targetPath=viewUrl(next,activeProject.current);
    if(next===view&&location.pathname===targetPath)return true;
    if(!skipGuard&&!confirmNavigation())return false;
    clearScrollRestore();rememberScroll();
    setViewState(next);
    const path=targetPath;
    if(location.pathname!==path){
      if(replace)history.replaceState({...history.state,tieIndex:historyIndex.current,workspaceMode:workspaceModeRef.current,scrollX:0,scrollY:0},'',path);
      else {historyIndex.current+=1;history.pushState({tieIndex:historyIndex.current,workspaceMode:workspaceModeRef.current,scrollX:0,scrollY:0},'',path);}
    }
    window.scrollTo({top:0,left:0,behavior:'auto'});
    return true;
  };
  const navigate=async path=>{const route=parseRoute(new URL(path,location.origin).pathname);if(!route||!confirmNavigation())return;try{clearScrollRestore();rememberScroll();const next=await loadState(route.projectId);activeProject.current=route.projectId;if(Array.isArray(next.projects))setAvailableProjects(next.projects);setState(next);setSelected(next.project||null);setViewState(route.view);historyIndex.current+=1;history.pushState({tieIndex:historyIndex.current,workspaceMode:workspaceModeRef.current,scrollX:0,scrollY:0},'',path);window.scrollTo({top:0,left:0,behavior:'auto'});setOffline(await getOfflineStatus(route.projectId));}catch(error){flash(error.message,'error')}};
  useEffect(()=>{const previousScrollRestoration=history.scrollRestoration;history.scrollRestoration='manual';if(history.state?.tieIndex===undefined)history.replaceState({...(history.state||{}),tieIndex:historyIndex.current,workspaceMode:workspaceModeRef.current,scrollX:window.scrollX,scrollY:window.scrollY},'',location.href);const pop=async event=>{const route=parseRoute(location.pathname);if(!route)return;const targetIndex=event.state?.tieIndex;if(ignorePop.current){ignorePop.current=false;return;}if(!confirmNavigation()){clearScrollRestore();if(Number.isInteger(targetIndex)){const delta=historyIndex.current-targetIndex;if(delta){ignorePop.current=true;history.go(delta);}}else history.pushState({tieIndex:historyIndex.current,workspaceMode:workspaceModeRef.current,scrollX:window.scrollX,scrollY:window.scrollY},'',viewUrl(view,activeProject.current));return;}scrollRestore.current={x:Number(event.state?.scrollX)||0,y:Number(event.state?.scrollY)||0};restoringScroll.current=true;try{const next=await loadState(route.projectId);activeProject.current=route.projectId;historyIndex.current=Number.isInteger(targetIndex)?targetIndex:historyIndex.current;if(['organizer','couple','contractor'].includes(event.state?.workspaceMode))saveWorkspaceMode(event.state.workspaceMode);if(Array.isArray(next.projects))setAvailableProjects(next.projects);setSelected(next.project||null);setState(next);setViewState(route.view);setMode('app');}catch(error){clearScrollRestore();if(error.status===401)setMode('public');else flash(error.message,'error')}};window.addEventListener('popstate',pop);return()=>{window.removeEventListener('popstate',pop);history.scrollRestoration=previousScrollRestoration}},[view]);
  useEffect(()=>{if(!scrollRestore.current)return;let frame=0;const restore=()=>{const target=scrollRestore.current;if(!target)return;window.scrollTo({top:target.y,left:target.x,behavior:'auto'});if(Math.abs(window.scrollY-target.y)<=1&&Math.abs(window.scrollX-target.x)<=1)clearScrollRestore();};const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(restore)};const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);observer?.observe(document.documentElement);schedule();return()=>{cancelAnimationFrame(frame);observer?.disconnect()}},[view,state?.project?.id,state?.entities?.length]);
  useEffect(()=>{const parts=view.split(':'),target=parts[2];if(!target)return;if(['estimate','payouts','catalog','files'].includes(parts[1])){const row=state?.entities?.find(r=>r.id===target);if(!row)return;if(row.kind==='obligation')setModal({type:'obligation',item:row});if(row.kind==='selection')setModal({type:'vendor',item:row,project:true});}},[view,state?.project?.id]);
  useEffect(()=>{let frame=0;const save=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(rememberScroll)};window.addEventListener('scroll',save,{passive:true});return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',save)}},[view]);
  const acceptState = useCallback(async next => {
    if(Array.isArray(next.projects))setAvailableProjects(next.projects);
    let requested=parseRoute(location.pathname);
    if(requested?.projectId&&!next.project){try{if(Array.isArray(next.projects)&&!next.projects.some(p=>p.id===requested.projectId)){const error=new Error('Доступ к свадьбе отозван');error.status=403;throw error;}next=await loadState(requested.projectId)}catch(error){if(![403,404].includes(error.status))throw error;requested=null;history.replaceState(null,'',awaitingClientAccess(next)?'/app/waiting':'/app/applications');flash('Доступ к свадьбе отозван','error');}}
    if(Array.isArray(next.projects))setAvailableProjects(next.projects);
    let project=next.project;
    const staff=has(next,'projects');
    if(!project && !staff && arr(next.projects).length===1) project=next.projects[0];
    if(!project && next.offline && arr(next.projects).length===1) project=next.projects[0];
    if(project) { next=next.project?next:await loadState(project.id); activeProject.current=project.id; setSelected(next.project); const contractorLanding=workspaceModeRef.current==='contractor'||!staff&&arr(next.grants).some(g=>g.role_key==='contractor')&&!arr(next.grants).some(g=>g.role_key==='couple');setView(next.offline?'project:payouts':requested?.projectId===project.id?requested.view:contractorLanding?'project:tasks':'project:overview'); setOffline(await getOfflineStatus(project.id)); }
    else { activeProject.current=null; setSelected(null);setView(staff?(requested?.view==='settings'?'settings':workspaceModeRef.current==='organizer'?(requested?.projectId?'today':requested?.view||'today'):'projects'):awaitingClientAccess(next)?'waiting':'applications'); }
    setState(next);setMode(next.user?'app':'public');return next;
  },[]);
  useEffect(() => {
    let alive=true;
    (async()=>{try{await initClient();let next=await loadState();const invite=new URLSearchParams(location.search).get('invite');if(invite&&navigator.onLine){try{await command({op:'invite.accept',token:invite});const url=new URL(location.href);url.searchParams.delete('invite');history.replaceState(null,'',url);next=await loadState();}catch(error){flash(error.message,'error');}}if(alive){await acceptState(next);if(applicationEntry||Object.keys(incomingSource).length)setModal({type:'application'});}}catch{try{const info=await api(`/api/public?agency=${encodeURIComponent(agencySlug())}`);if(alive)setPublicInfo(info);}catch{}if(alive){setMode('public');if(applicationEntry||Object.keys(incomingSource).length)setModal({type:'auth',mode:'login',next:'application'});else if(loginEntry)setModal({type:'auth',mode:'login'});}}})();
    const off=subscribe(async()=>{try{const next=await loadState(activeProject.current);if(alive){if(Array.isArray(next.projects))setAvailableProjects(next.projects);if(!activeProject.current&&!has(next,'projects')&&next.projects?.length===1)await acceptState(next);else setState(next);setOffline(await getOfflineStatus(activeProject.current));}}catch(error){if(error.status===401&&alive){setState(null);setMode('public');}else if(error.status===403&&alive){activeProject.current=null;await acceptState(await loadState());}}});
    const timer=setInterval(async()=>{if(!navigator.onLine||document.visibilityState!=='visible')return;try{const next=await loadState(activeProject.current);if(alive){if(Array.isArray(next.projects))setAvailableProjects(next.projects);if(!activeProject.current&&!has(next,'projects')&&next.projects?.length===1)await acceptState(next);else setState(next);}}catch{}},15000);
    return()=>{alive=false;off();clearInterval(timer)};
  },[acceptState]);
  const run = async (body, projectId) => {
    try {
      const result = await command({
        id: crypto.randomUUID(),
        ...body
      });
      const target=projectId !== undefined ? projectId : body.projectId !== undefined ? body.projectId : activeProject.current;
      await refresh(target);
      setOffline(await getOfflineStatus(target));
      flash(result?.queued ? 'Изменение сохранено в очередь' : 'Сохранено');
      return result;
    } catch (err) {
      flash(err.message || 'Не удалось сохранить', 'error');
      throw err;
    }
  };
  const openProject = async (project,targetView='project:overview') => {
    if(!confirmNavigation())return false;
    try {
      if(!state?.project)setCatalogCache(arr(state?.global).filter(item=>['vendor','vendorCategory'].includes(item.kind)&&!item.deleted));
      const fresh=await refresh(project.id);
      activeProject.current=project.id;
      setSelected(fresh.project);
      setView(targetView,{skipGuard:true});
      setOffline(await getOfflineStatus(project.id));
      return true;
    } catch (err) {
      flash(err.message, 'error');
      return false;
    }
  };
  const openAgency = async nextView => {
    if(!confirmNavigation())return false;
    try{
      activeProject.current=null;
      await refresh(null);
      setSelected(null);
      setView(nextView,{skipGuard:true});
      return true;
    }catch(error){flash(error.message,'error');return false}
  };
  const switchWorkspace=async next=>{
    if(next===workspaceModeRef.current)return;
    const target=next==='organizer'?'today':activeProject.current?(next==='contractor'?'project:tasks':'project:overview'):'projects';
    const opened=target.startsWith('project:')?setView(target):await openAgency(target);
    if(opened){saveWorkspaceMode(next);history.replaceState({...history.state,workspaceMode:next},'',location.href)}
  };
  const authDone = async () => {
    const nextModal=modal?.next;setModal(null);
    const loginUrl=new URL(location.href);
    if(loginUrl.searchParams.delete('login'))history.replaceState(null,'',loginUrl);
    const invitation=new URLSearchParams(location.search).get('invite');
    if(invitation){await command({op:'invite.accept',token:invitation});const url=new URL(location.href);url.searchParams.delete('invite');history.replaceState(null,'',url);}
    await acceptState(await loadState());
    if(nextModal==='application'||savedApplication().sourceCaseId||savedApplication().sourcePackageId)setModal({type:'application'});
  };
  const manageUser=async(body,message)=>{
    const result=await command({id:crypto.randomUUID(),...body});
    await refresh(null);
    flash(message);
    return result;
  };
  const signOut=async()=>{
    await logout();
    activeProject.current=null;
    saveWorkspaceMode('organizer');
    setAvailableProjects([]);
    setPublicInfo(await api(`/api/public?agency=${encodeURIComponent(agencySlug())}`).catch(()=>publicInfo));
    setState(null);
    setMode('public');
    setView('projects');
  };
  if (mode === 'loading') return <div className="loading"><Mark /><span>Открываем tie</span></div>;
  if (mode === 'public') return <><PublicHome info={publicInfo} onAuth={type => setModal({
      type: 'auth',
      mode: type === 'register' && publicInfo?.setup ? 'setup' : type
    })} onApplication={() => setModal({
      type: 'auth',
      mode: publicInfo?.setup ? 'setup' : 'register',
      next: 'application'
    })} />{modal?.type === 'auth' && <AuthDialog mode={modal.mode} onClose={() => {setModal(null);const url=new URL(location.href);if(url.searchParams.delete('login'))history.replaceState(null,'',url);}} onAuth={authDone} />} {modal?.type === 'application' && <ApplicationDialog onClose={() => setModal(null)} onSent={async()=>{await refresh(null);setView('waiting')}} />}<Notice notice={notice} onDismiss={() => setNotice(null)} /></>;
  if(awaitingClientAccess(state)){
    const application=arr(state.applications).filter(item=>item.data?.userId===state.user.id).sort((a,b)=>String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||'')))[0];
    if(modal?.type==='questionnaire')return <QuestionnairePage state={state} application={application} onBack={()=>setModal(null)} onLogout={signOut} onSubmit={async({answers,contact,date})=>{
      if(application)await api('/api/command',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),op:'application.questionnaire',entityId:application.id,version:application.version,answers})});
      else {const source=savedApplication();await api('/api/command',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),op:'application.create',data:{name:answers.names,date,contact,message:'Анкета пары заполнена.',questionnaire:answers,...Object.fromEntries(['sourceCaseId','sourcePackageId'].filter(key=>source[key]).map(key=>[key,source[key]]))}})});sessionStorage.removeItem(applicationDraftKey);}
      await refresh(null);setModal(null);flash('Анкета отправлена');
    }}/>;
    return <><ClientWaitingPage state={state} application={application} onQuestionnaire={()=>setModal({type:'questionnaire'})} onRespond={()=>setModal({type:'applicationResponse',item:application})} onCheckAccess={async()=>acceptState(await loadState())} onLogout={signOut}/><Notice notice={notice} onDismiss={()=>setNotice(null)}/>{modal?.type==='applicationResponse'&&<ApplicationResponseForm application={modal.item} onClose={()=>setModal(null)} onSave={async data=>{await command({id:crypto.randomUUID(),op:'application.respond',entityId:modal.item.id,version:modal.item.version,data});await refresh(null);flash('Уточнение отправлено');}}/>}</>;
  }
  const projectId = state?.project?.id;
  const workspace = view.startsWith('project:');
  const adminCanSwitch=state.user.protected||arr(state.grants).some(g=>g.project_id===null&&g.role_key==='admin');
  const effectiveWorkspace=adminCanSwitch?workspaceMode:!has(state,'projects')&&arr(state.grants).some(g=>g.role_key==='contractor')&&!arr(state.grants).some(g=>g.role_key==='couple')?'contractor':'couple';
  const saveProject = async values => {
    if (modal?.project) await run({
      op: 'entity.edit',
      projectId: (modal.project).id,
      entityId: (modal.project).id,
      version: modal.project.version,
      data: values
    }, (modal.project).id);else await run({
      op: 'project.create',
      templateId: values.templateId || undefined,
      data: values
    });
  };
  const tableAction = async (type, item, payload) => {
    if (type === 'add') return run({
      op: 'entity.create',
      projectId,
      kind: 'row',
      parentId: item.id,
      schemaVersion: item.version,
      data: {}
    }, projectId);
    if(type==='edit'&&item.kind==='row'){
      const table=entities.find(e=>e.id===item.parent_id),m=table?.data.semanticMap;
      if(m?.rsvpStatus&&[m.rsvpStatus,m.seatingTable,m.seatIndex].filter(Boolean).some(key=>Object.hasOwn(payload,key))){
        const data={...payload},seatChanged=[m.seatingTable,m.seatIndex].filter(Boolean).some(key=>Object.hasOwn(data,key));
        if(Object.hasOwn(data,m.rsvpStatus))data[m.rsvpStatus]=Object.entries(m.rsvpValues||{}).find(([,value])=>value===data[m.rsvpStatus])?.[0]||data[m.rsvpStatus];
        let target;if(seatChanged){data[m.seatingTable]=data[m.seatingTable]===undefined?item.data[m.seatingTable]:data[m.seatingTable];data[m.seatIndex]=data[m.seatIndex]===undefined?item.data[m.seatIndex]:data[m.seatIndex];if(!data[m.seatingTable])data[m.seatIndex]=null;target=entities.find(e=>e.id===data[m.seatingTable]);}
        const confirmed=data[m.rsvpStatus]==='confirmed'||!Object.hasOwn(data,m.rsvpStatus)&&[m.rsvpValues?.confirmed,'confirmed'].includes(item.data[m.rsvpStatus]);
        const confirmNonConfirmed=!!target&&!confirmed&&window.confirm('Гость ещё не подтвердил присутствие. Назначить ему место?');
        if(target&&!confirmed&&!confirmNonConfirmed)return;
        return run({op:'guest.row.edit',projectId,guestTableId:table.id,guestRowId:item.id,rowVersion:item.version,schemaVersion:table.version,data,tableVersion:target?.version,confirmNonConfirmed},projectId);
      }
    }
    if (type === 'edit') return run({
      op: 'entity.edit',
      projectId,
      entityId: item.id,
      version: item.version,
      schemaVersion: entities.find(e => e.id === item.parent_id)?.version,
      data: payload
    }, projectId);
    if (type === 'delete') return setModal({
      type: 'confirmDelete',
      item
    });
    if (type === 'structure') return setModal({
      type: 'table',
      table: item
    });
    if (type === 'reorder') return run({
      op: 'entity.edit', projectId, entityId: item.id, version: item.version,
      data: { ...dataOf(item), rowOrder: payload }
    }, projectId);
  };
  const entities = arr(state?.entities);
  const reusableCatalog=[...new Map([...catalogCache,...arr(state?.catalog)].filter(item=>!item.deleted).map(item=>[item.id,item])).values()];
  const reusableVendors=reusableCatalog.filter(item=>item.kind==='vendor');
  const reusableVendorCategories=reusableCatalog.filter(item=>item.kind==='vendorCategory');
  const restore = item => run({
    op: 'entity.restore',
    projectId,
    entityId: item.entity_id,
    version: item.current_version || entities.find(e=>e.id===item.entity_id)?.version || JSON.parse(item.after_json || '{}').version,
    schemaVersion: entities.find(e=>e.id===JSON.parse(item.after_json || '{}').parent_id)?.version,
    auditId: item.id
  }, projectId);
  const moduleProps={state,projectId,can:(action,section,row,field)=>permitted(state,action,section,row,field),run:(op,body)=>run({op,...body},body?.projectId===undefined?activeProject.current:body.projectId),refresh:()=>refresh(activeProject.current),navigate};
  const renderMain = () => {
    if(view==='content')return <AgencyPublishingWorkspace {...moduleProps}/>;
    if(view==='project:site')return <MicrositeWorkspace {...moduleProps}/>;
    if(view==='tasks'||view.startsWith('project:tasks'))return <TaskWorkspace {...moduleProps} projectId={view==='tasks'?null:projectId} sourceId={view.split(':')[2]}/>;
    if(view.startsWith('project:approvals'))return <ApprovalWorkspace {...moduleProps} sourceId={view.split(':')[2]}/>;
    if(view.startsWith('project:guests'))return <GuestWorkspace {...moduleProps} sourceId={view.split(':')[2]}/>;
    if(view.startsWith('project:seating'))return <SeatingWorkspace {...moduleProps} sourceId={view.split(':')[2]}/>;
    if(view==='today'||view==='project:overview'&&!state.offline)return <Dashboard {...moduleProps} projectId={view==='today'?null:projectId}/>;
    if(view==='calendar'||view.startsWith('project:calendar'))return <CalendarWorkspace {...moduleProps} projectId={view==='calendar'?null:projectId}/>;
    if(view==='notifications')return <NotificationCenter {...moduleProps}/>;
    if(view==='profile')return <><NotificationPreferences {...moduleProps}/><CalendarIntegrationSettings state={state}/></>;
    if(view==='project:history'&&!has(state,'history',projectId))return <><PageHeader eyebrow="Закрытый раздел" title="История изменений"/><p className="quiet-copy">История доступна только агентству и организаторам.</p></>;
    if(view==='project:more')return <><PageHeader eyebrow="Наша свадьба" title="Ещё в проекте"/><div className="v2-more-grid project-tools-grid">{(effectiveWorkspace==='contractor'?[['tables','Рабочие таблицы','Задания и материалы проекта'],['calendar','Календарь','Сроки и события проекта'],['offline','Офлайн','Подготовить данные для работы без сети']]:[['site','Сайт свадьбы','Приглашение, программа и ответы гостей'],['tables','Все таблицы','Рабочие списки и структура проекта'],...(has(state,'history',projectId)?[['history','История изменений','Кто, что и когда поменял']]:[]),['members','Участники','Команда и доступ к подготовке'],['offline','Офлайн','Подготовить данные для работы без сети'],['calendar','Календарь','Встречи, сроки и события проекта'],['settings','Данные свадьбы','Дата, бюджет и правила готовности']]).map(([key,label,description])=><button key={key} onClick={()=>setView('project:'+key)}><Icon name={key==='site'?'content':key==='tables'?'templates':key}/><strong>{label}</strong><small>{description}</small></button>)}</div></>;
    if(view==='project:settings')return <ReadinessSettings {...moduleProps} onEditProject={state.canManageWeddingDetails?()=>setModal({type:'project',project:state.project}):null}/>;
    if(view==='project:members')return <><PageHeader eyebrow="Участники проекта" title="Вместе над свадьбой"/><div className="panel project-people"><div className="data-list">{state.assignableMembers?.map(u=><article className="data-row static" key={u.id}><span className="avatar">{u.name.split(' ').slice(0,2).map(n=>n[0]).join('')}</span><div><strong>{u.name}</strong><small>Участник проекта</small></div></article>)}</div><button className="button quiet" onClick={()=>setModal({type:'invite'})}><Icon name="plus"/>Пригласить участника</button></div></>;
    if(view==='templates')return <><PageHeader eyebrow="Структура и подготовка" title="Шаблоны свадеб" action={<button className="button" onClick={()=>setModal({type:'template'})}>Новый шаблон</button>}/><div className="panel data-list">{byKind(state,'template').map(item=><button key={item.id} className="data-row" onClick={()=>setModal({type:'template',item})}>{item.data.name}<span>Изменить →</span></button>)}</div></>;

    if (workspace) return <Workspace runV2={moduleProps.run} state={state} view={view} setView={setView} onBudgetCell={(row,field,value)=>run({op:'coupleBudget.cell',projectId,row,field,value},projectId)} onBudgetStructure={(kind,data)=>run({op:`coupleBudget.${kind}.add`,projectId,...data},projectId)} onProjectEdit={state.canManageWeddingDetails?() => setModal({
      type: 'project',
      project: state.project
    }):null} onMovement={obligation => setModal({type:'movement',agency:false,item:obligation?.kind==='obligation'?{data:{type:obligation.data.fee?'fee':'payment',obligationId:obligation.id,amount:obligation.due??obligation.data.due??Math.max(0,(obligation.data.agreed||0)-(state.financials?.paid?.[obligation.id]||0)),description:obligation.data.title,source:'custody'}}:undefined})} onAddObligation={() => setModal({
      type: 'obligation'
    })} onEditObligation={item => setModal({
      type: 'obligation',
      item
    })} onTable={tableAction} onVendor={item => setModal({
      type: 'vendor',
      item,
      project: true
    })} onEditMovement={item=>setModal({type:'movement',agency:false,item})} onDeleteMovement={item=>setModal({type:'confirmMovementDelete',item})} onCreateTable={()=>setModal({type:'table',create:true})} onSection={(item,action)=>action==='delete'?setModal({type:'confirmSectionDelete',item}):setModal({type:'section',item})} onRestore={restore} onCategory={item=>setModal({type:'category',item,kind:'category',projectId})} onDeleteObligation={item=>setModal({type:'confirmDelete',item})} offline={offline} offlineActions={{
      onPrepare: async () => {
        await prepareProject(projectId);
        setOffline(await getOfflineStatus(projectId));
        flash('Проект подготовлен для работы без сети');
      },
      onSync: async () => {
        await syncQueue();
        setOffline(await getOfflineStatus(projectId));
        await refresh(projectId);
        const status=await getOfflineStatus(projectId);flash(status.conflicts.length?'Часть правок требует решения конфликта':'Очередь синхронизирована',status.conflicts.length?'error':'success');
      },
      onDiscard: async id => {
        await discardCommand(id);
        setOffline(await getOfflineStatus(projectId));
      },
      onRetry: async id => { await refresh(projectId);setModal({type:'conflict',item:offline.conflicts.find(c=>c.id===id)}); }
    }} onFile={async (file,documentStatus='personal') => {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api(`/api/files?project=${projectId}`, {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          mime: file.type,
          documentStatus,
          content: base64
        })
      });
      await refresh(projectId);
      flash('Файл загружен');
    }} onInvite={() => setModal({
      type: 'invite'
    })} />;
    if (view === 'projects') return <Projects state={state} onProject={project=>openProject(project,effectiveWorkspace==='contractor'?'project:tasks':'project:overview')} onCreate={() => setModal({
      type: 'project'
    })} onEdit={p => setModal({
      type: 'project',
      project: p
    })} />;
    if (view === 'applications') return <Applications state={state} onCreate={()=>setModal({type:"application"})} onReview={has(state,'applications') ? item => setModal({type:'review',item}) : null} onRespond={item=>setModal({type:'applicationResponse',item})}/>;
    if (view === 'catalog') return <Catalog state={state} onCategory={item=>setModal({type:"category",item,kind:"vendorCategory",projectId:null})} onVendor={item => setModal({
      type: 'vendor',
      item
    })} />;
    if (view === 'agency') return <Finance state={state} agency onOpenProject={async projectId=>{const target=(state.projects||[]).find(project=>project.id===projectId);if(target){await openProject(target);setView('project:estimate',{skipGuard:true});}}} onCategory={item=>setModal({type:"category",item,kind:"category",projectId:null})} onMovement={() => setModal({
      type: 'movement',
      agency: true
    })} onEditMovement={async item=>{if(item.project_id){await openProject({id:item.project_id});setView('project:estimate');}setModal({type:'movement',agency:!item.project_id,item})}} onDeleteMovement={item=>setModal({type:'confirmMovementDelete',item})}/>;
    const accessPanel=state.canManageUsers&&<Roles state={state} onCreateUser={()=>setModal({type:'userCreate'})} onPassword={item=>setModal({type:'userPassword',item})} onRemove={item=>setModal({type:'userRemove',item})} onRestore={item=>manageUser({op:'user.restore',userId:item.id,version:item.version},'Пользователь восстановлен').catch(error=>flash(error.message,'error'))} onRole={item => setModal({
      type: 'role',
      item
    })} onGrant={item => setModal({
      type: 'grant',
      item: item || state.users?.find(u=>!u.protected)
    })} />;
    if (view === 'access'&&state.canManageUsers) return accessPanel;
    if (view === 'settings' && (has(state,'projects')||has(state,'settings')||state.canManageUsers)) return <SettingsWorkspace state={state} workspaceMode={workspaceMode} onWorkspace={adminCanSwitch?switchWorkspace:null} site={has(state,'settings')?<Settings state={state} onSave={values => run({
      op: 'settings.save',
      version: state.agency?.version,
      ...values
    })}/>:null} publication={has(state,'publishAgencySite')?<AgencyPublishingWorkspace {...moduleProps}/>:null} access={accessPanel} integrations={<><CalendarIntegrationSettings state={state}/><NotificationPreferences {...moduleProps}/></>} directories={has(state,'catalog')||has(state,'templates')||has(state,'agencyFinance')?<SettingsDirectories state={state} onTemplate={item=>setModal({type:'template',item})} onVendor={item=>setModal({type:'vendor',item})} onVendorCategory={item=>setModal({type:'category',item,kind:'vendorCategory',projectId:null})} onFinanceCategory={item=>setModal({type:'category',item,kind:'category',projectId:null})}/>:null}/>;
    return null;
  };
  const userModals=<>{modal?.type==='userCreate'&&<UserCreateForm roles={state.roles} projects={state.projects} onClose={()=>setModal(null)} onSave={data=>manageUser({op:'user.create',...data},'Пользователь создан')}/>}{modal?.type==='userPassword'&&<UserPasswordForm user={modal.item} onClose={()=>setModal(null)} onSave={password=>manageUser({op:'user.password',userId:modal.item.id,version:modal.item.version,password},'Пароль изменён')}/>}{modal?.type==='userRemove'&&<ConfirmDialog title="Удалить пользователя" confirm="Удалить пользователя" danger onClose={()=>setModal(null)} onConfirm={async()=>{await manageUser({op:'user.remove',userId:modal.item.id,version:modal.item.version},'Пользователь удалён');setModal(null)}}><p>Учётная запись {modal.item.name} будет отключена, открытые сеансы завершатся. История работы сохранится, а пользователя можно будет восстановить.</p></ConfirmDialog>}</>;
  return <><AppShell state={state} view={view} setView={nextView => view.startsWith('project:') && !nextView.startsWith('project:') ? openAgency(nextView) : setView(nextView)} selectedProject={selected} onProject={openProject} workspaceMode={workspaceMode} onWorkspace={switchWorkspace} availableProjects={availableProjects} onLogout={signOut}>{renderMain()}</AppShell>{userModals}<Notice notice={notice} onDismiss={() => setNotice(null)} />{modal?.type === 'application' && <ApplicationDialog onClose={()=>setModal(null)} onSent={async()=>{await refresh(null);setView('waiting')}}/>}{modal?.type === 'project' && <ProjectForm project={modal.project} templates={byKind(state,'template')} showBudgetLimit={!modal.project||has(state,'projects')} onClose={() => setModal(null)} onSave={saveProject} onReschedule={()=>setModal({type:'reschedule'})} />} {modal?.type==='reschedule'&&<RescheduleDialog {...moduleProps} currentDate={state.project.data.date} currentTimeZone={state.project.data.timeZone} onDone={()=>refresh(projectId)} onClose={()=>setModal(null)}/>} {modal?.type === 'obligation' && <ObligationForm obligation={modal.item} categories={byKind(state,"category")} users={state.members||state.custodians||[]} showAgencyCommission={state.canViewAgencyCommission} onClose={() => setModal(null)} onSave={data => run(modal.item ? {
      op: 'entity.edit',
      projectId,
      entityId: modal.item.id,
      version: modal.item.version,
      data
    } : {
      op: 'entity.create',
      projectId,
      kind: 'obligation',
      data
    }, projectId)} />} {modal?.type === 'movement' && <MovementForm projectId={modal.agency ? null : projectId} agency={modal.agency} movement={modal.item} obligations={byKind(state,'obligation')} users={arr(state.custodians||state.members||state.users)} categories={byKind(state,'category')} files={byKind(state,'file')} onClose={() => setModal(null)} onSave={({projectId: dataProjectId,data}) => run({op:'movement.save',projectId:dataProjectId,entityId:modal.item?.id,version:modal.item?.version,obligationVersion:data.obligationId?byKind(state,'obligation').find(o=>o.id===data.obligationId)?.version:undefined,data},dataProjectId)} />} {modal?.type === 'review' && <ReviewForm application={modal.item} onClose={() => setModal(null)} onSave={f => run({
      op: 'application.review',
      entityId: modal.item.id,
      version: modal.item.version,
      ...f
    })} />} {modal?.type === 'applicationResponse' && <ApplicationResponseForm application={modal.item} onClose={()=>setModal(null)} onSave={data=>run({op:'application.respond',entityId:modal.item.id,version:modal.item.version,data})}/>} {modal?.type === 'vendor' && <VendorForm vendor={modal.item} projectMode={modal.project} categories={modal.project?reusableVendorCategories:byKind(state,'vendorCategory')} catalog={modal.project?reusableVendors:[]} showAgencyCommission={!!modal.project&&state.canViewAgencyCommission} readOnly={!!modal.project&&!has(state,'catalog')} onSelect={selected=>run({op:'entity.edit',projectId,entityId:modal.item.id,version:modal.item.version,data:{selected}},projectId)} onCreateCategory={has(state,'catalog')?async name=>{const created=await run({op:'entity.create',projectId:null,kind:'vendorCategory',data:{name,archived:false}},modal.project?projectId:null);setCatalogCache(current=>[...current.filter(item=>item.id!==created.id),created]);return created}:null} onDelete={modal.item?()=>setModal({type:"confirmDelete",item:modal.item}):null} onClose={() => setModal(null)} onSave={data => run(modal.item ? {
      op: 'entity.edit',
      projectId: modal.project ? projectId : null,
      entityId: modal.item.id,
      version: modal.item.version,
      data
    } : {
      op: 'entity.create',
      projectId: modal.project ? projectId : null,
      kind: modal.project ? 'selection' : 'vendor',
      data
    }, modal.project ? projectId : null)} />} {modal?.type === 'role' && <RoleForm role={modal.item} onClose={() => setModal(null)} onSave={f => run({
      op: 'role.save',
      roleId: modal.item?.id,
      version: modal.item?.version,
      ...f
    })} onDelete={modal.item&&!modal.item.key&&!modal.item.protected?()=>setModal({type:'roleDelete',item:modal.item}):null} />} {modal?.type==='roleDelete'&&<ConfirmDialog title="Удалить роль?" confirm="Удалить роль" danger onClose={()=>setModal(null)} onConfirm={async()=>{await run({op:'role.delete',roleId:modal.item.id,version:modal.item.version});setModal(null)}}><p>Роль «{modal.item.name}» будет удалена без возможности восстановления. Удаление доступно, только если роль никому не назначена и не используется в приглашениях.</p></ConfirmDialog>} {modal?.type === 'grant' && <GrantEditor user={modal.item} state={state} onClose={() => setModal(null)} onSave={f => run({
      op: 'grants.save',
      userId: f.userId || modal.item?.id,
      version: state.users?.find(u=>u.id===(f.userId || modal.item?.id))?.version,
      ...f
    })} />} {modal?.type === 'invite' && <InvitationEditor state={state} projectId={projectId} onClose={() => setModal(null)} onRevoke={invitationId=>run({op:'invite.revoke',invitationId},projectId)} onSave={f => run({
      op: 'invite.create',
      projectId,
      ...f
    }, projectId)} />} {modal?.type === 'section' && <SectionEditor section={modal.item} onClose={()=>setModal(null)} onSave={data=>run(modal.item ? {op:'entity.edit',projectId,entityId:modal.item.id,version:modal.item.version,data:{...dataOf(modal.item),...data}} : {op:'entity.create',projectId,kind:'section',data:{...data,order:entities.filter(e=>e.kind==='section').length}},projectId)}/>} {modal?.type === 'confirmSectionDelete' && <ConfirmDialog title="Удалить раздел?" danger confirm="Удалить" onClose={()=>setModal(null)} onConfirm={async()=>{await run({op:'entity.delete',projectId,entityId:modal.item.id,version:modal.item.version,confirm:true},projectId);setModal(null)}}><p>Будут скрыты таблицы: {entities.filter(e=>e.kind==='table'&&e.data.sectionId===modal.item.id).map(e=>e.data.name).join(', ')||'в разделе пока нет таблиц'}. Верните раздел через историю, чтобы снова открыть их.</p></ConfirmDialog>} {modal?.type === 'table' && <TableEditor table={modal.table} rowCount={entities.filter(e=>e.parent_id===modal.table?.id).length} sections={entities.filter(e => e.kind === 'section' && !e.deleted)} onClose={() => setModal(null)} onSave={data => run(modal.create ? { op: 'entity.create', projectId, kind: 'table', data: {...data, columns:data.columns.length ? data.columns : [{id:'title',name:'Название',type:'text'}]} } : {op: 'entity.edit', projectId, entityId: modal.table.id, version: modal.table.version, data}, projectId)} />} {modal?.type === 'template' && <TemplateEditor onClose={() => setModal(null)} template={modal.item} defaults={byKind(state,'template')[0]?.data} onSave={data=>run(modal.item?{op:'entity.edit',entityId:modal.item.id,version:modal.item.version,data}:{op:'entity.create',kind:'template',data},null)} />} {modal?.type==='category'&&<CategoryEditor category={modal.item} onClose={()=>setModal(null)} onDelete={modal.kind==='vendorCategory'&&modal.item?()=>setModal({type:'confirmVendorCategoryDelete',item:modal.item}):null} onSave={data=>run(modal.item?{op:'entity.edit',projectId:modal.projectId,entityId:modal.item.id,version:modal.item.version,data}:{op:'entity.create',projectId:modal.projectId,kind:modal.kind,data},modal.projectId)}/>} {modal?.type==='confirmVendorCategoryDelete'&&<ConfirmDialog title="Удалить категорию подрядчиков?" danger confirm="Удалить категорию" onClose={()=>setModal(null)} onConfirm={async()=>{await run({op:'entity.delete',projectId:null,entityId:modal.item.id,version:modal.item.version},null);setModal(null)}}><p>Категория «{modal.item.data.name}» исчезнет из справочника. Если к ней привязаны подрядчики, сначала перенесите их в другую категорию.</p></ConfirmDialog>} {modal?.type==='conflict'&&<ConflictEditor conflict={modal.item} state={state} onClose={()=>setModal(null)} onSave={async replacements=>{await retryCommand(modal.item.id,replacements);setOffline(await getOfflineStatus(projectId));flash('Правка подготовлена. Нажмите «Синхронизировать».')}}/>} {modal?.type==='confirmMovementDelete'&&<ConfirmDialog title="Удалить движение?" confirm="Удалить" danger onClose={()=>setModal(null)} onConfirm={async()=>{await run({op:'movement.delete',projectId:modal.item.project_id,entityId:modal.item.id,version:modal.item.version},workspace?modal.item.project_id:null);setModal(null)}}><p>Сумма будет исключена из остатков и оплат. История сохранится.</p></ConfirmDialog>} {modal?.type === 'confirmDelete'  && <ConfirmDialog title="Удалить запись?" danger confirm="Удалить" onClose={() => setModal(null)} onConfirm={async () => {
      await run({
        op: 'entity.delete',
        projectId,
        entityId: modal.item.id,
        version: modal.item.version,
        schemaVersion: entities.find(e=>e.id===modal.item.parent_id)?.version,
        confirm: true
      }, projectId);
      setModal(null);
    }}><p>Запись будет скрыта, её можно вернуть через историю. {modal.item.kind==='table'?`В таблице ${entities.filter(e=>e.parent_id===modal.item.id).length} строк.`:''} Связанные оплаты защищены: сначала исправьте или удалите их.</p><ul>{entities.filter(e=>e.id!==modal.item.id&&(e.parent_id===modal.item.id||Object.values(e.data||{}).includes(modal.item.id))).map(e=><li key={e.id}>{e.data.title||e.data.name||({row:'Связанная строка',movement:'Связанная оплата',table:'Таблица'})[e.kind]||'Связанная запись'}</li>)}</ul></ConfirmDialog>}</>;
}




createRoot(document.getElementById('root')).render(<App />);

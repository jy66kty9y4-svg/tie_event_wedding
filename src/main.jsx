import {TimingSetup} from './v2/TimingSetup.jsx';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { api, command, discardCommand, getOfflineStatus, initClient, loadState, logout, prepareProject, retryCommand, subscribe, syncQueue } from './client.js';
import { dateLabel, money, permissionLabels, permissions, statuses, today } from './shared.js';
import { AppShell } from './ui/AppShell.jsx';
import { ConfirmDialog, FormField, Modal, SafeForm } from './ui/Modal.jsx';
import { Mark, Icon } from './ui/Mark.jsx';
import { Notice } from './ui/Notice.jsx';
import { TableWorkspace } from './ui/TableWorkspace.jsx';
import {SectionEditor,TableEditor,InvitationEditor,Payouts,ConflictEditor} from './ui/ProjectTools.jsx';
import {GrantEditor,TemplateEditor,CategoryEditor} from './ui/ManagementForms.jsx';
import {Dashboard,CalendarWorkspace,NotificationCenter,NotificationPreferences,ReadinessSettings,VerificationPanel} from './v2/calendar/Workspace.jsx';
import {GuestWorkspace,SeatingWorkspace} from './v2/guest/Workspace.jsx';
import {TaskWorkspace,ApprovalWorkspace,RescheduleDialog} from './v2/workflow/Workspace.jsx';
import {MicrositeWorkspace,AgencyPublishingWorkspace} from './v2/publishing/Workspace.jsx';
import {parseRoute,viewUrl} from './v2/routes.js';
import './styles.css';
const applicationDraftKey='tie:application-draft';
function savedApplication(){try{return JSON.parse(sessionStorage.getItem(applicationDraftKey)||'{}')}catch{return {}}}
const incomingSource=Object.fromEntries(['sourceCaseId','sourcePackageId'].map(key=>[key,new URLSearchParams(location.search).get(key)]).filter(([,value])=>value));
if(Object.keys(incomingSource).length){try{sessionStorage.setItem(applicationDraftKey,JSON.stringify({...savedApplication(),...incomingSource}))}catch{}}
const arr = value => Array.isArray(value) ? value : [];
const dataOf = item => item?.data || item || {};
const byKind = (state, kind) => arr(state?.entities || state?.global).filter(item => item.kind === kind && !item.deleted);
const agencySlug = () => new URLSearchParams(location.search).get('agency') || 'tie';
const has = (state, action, projectId = null) => !!state?.user?.protected || arr(state?.grants).some(g=>(g.project_id===null || g.project_id===projectId) && (g.permissions||[]).includes(action));
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
function PublicHome({
  info,
  onAuth,
  onApplication
}) {
  const settings = info?.settings || info || {};
  const portfolio = arr(settings.portfolio);
  const services = arr(settings.services);
  return <div className="public-page"><header className="public-nav"><button className="brand brand-button"><Mark compact /><span>{info?.name || 'tie'}</span></button><div className="nav-links"><a href="#services">Подход</a><a href="#portfolio">Портфолио</a><button className="text-button" onClick={() => onAuth('login')}>Войти</button><button className="button small" onClick={() => onAuth('register')}>Создать пространство</button></div></header>
    <main><section className="hero"><div className="hero-copy"><p className="eyebrow">Свадебное агентство</p><h1>Подготовка, в которой <em>всё</em> связано.</h1><p className="lead">{settings.description || 'Одно общее пространство для пары и команды: решения, деньги, люди и день свадьбы — в ясном порядке.'}</p><div className="hero-actions"><button className="button" onClick={onApplication}>Оставить заявку <Icon name="arrow" /></button><button className="text-button" onClick={() => onAuth('login')}>У меня уже есть приглашение</button></div></div><div className="hero-rings" aria-hidden="true"><span /><span /><i>два человека<br />одна история</i></div></section>
      <section id="services" className="public-section"><p className="eyebrow">Как мы работаем</p><h2>У каждой свадьбы — свой ритм и свои важные детали.</h2><div className="service-grid">{(services.length ? services : ['Концепция и выбор команды', 'Подготовка и смета', 'Координация дня свадьбы']).map((service, index) => <article key={service}><span>0{index + 1}</span><h3>{service}</h3><p>Договорённости остаются понятными всем, кто участвует в подготовке.</p></article>)}</div></section>
      <section id="portfolio" className="portfolio-section"><div><p className="eyebrow">Истории</p><h2>Свадьбы, собранные с вниманием.</h2></div>{portfolio.length ? <div className="portfolio-grid">{portfolio.map(item => <article key={item.title} className="portfolio-card" style={item.image ? {
            backgroundImage: `linear-gradient(0deg, rgba(33,26,39,.55), transparent), url(${item.image})`
          } : {}}><h3>{item.title}</h3><p>{item.description}</p></article>)}</div> : <p className="quiet-copy">Здесь появятся истории свадеб агентства.</p>}</section>
      <section className="public-cta"><div><p className="eyebrow">Начать разговор</p><h2>{settings.tagline || 'Расскажите о вашем дне'}</h2><p>{settings.contact || 'Оставьте заявку — мы свяжемся, чтобы обсудить формат и первые шаги.'}</p></div><button className="button light" onClick={onApplication}>Оставить заявку</button></section>
    </main><footer>© {new Date().getFullYear()} tie</footer></div>;
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
  return <Modal title={mode === 'login' ? 'Войти в tie' : setup ? 'Настроить агентство' : 'Создать аккаунт'} onClose={onClose}><SafeForm onSubmit={submit} className="form-stack">{mode !== 'login' && <><FormField label="Ваше имя"><input autoFocus required value={f.name} onChange={e => set('name', e.target.value)} /></FormField>{setup && <><FormField label="Название агентства"><input required value={f.agencyName} onChange={e => set('agencyName', e.target.value)} /></FormField><FormField label="Адрес агентства" hint="Латинские буквы, цифры и дефис."><input required pattern="(?:[a-z0-9]|-){2,50}" value={f.slug} onChange={e => set('slug', e.target.value.toLowerCase())} /></FormField></>}</>}<FormField label="Почта"><input autoFocus={mode === 'login'} type="email" required value={f.email} onChange={e => set('email', e.target.value)} /></FormField><FormField label="Пароль"><input type="password" minLength="10" required value={f.password} onChange={e => set('password', e.target.value)} /></FormField>{error && <p className="form-error">{error}</p>}<FormActions onCancel={onClose} label={mode === 'login' ? 'Войти' : setup ? 'Настроить агентство' : 'Создать аккаунт'} busy={busy} /></SafeForm></Modal>;
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
      await onSave({
        ...f,
        limit: f.limit === '' ? null : Math.round(Number(f.limit) * 100)
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return <Modal title={project ? 'Данные свадьбы' : 'Новая свадьба'} onClose={onClose}><SafeForm className="form-stack" onSubmit={submit}><FormField label="Название"><input autoFocus required placeholder="Алина и Максим" value={f.name} onChange={e => set('name', e.target.value)} /></FormField><div className="form-columns"><FormField label="Дата"><input required type="date" disabled={!!project} value={f.date} onChange={e => set('date', e.target.value)} />{project&&<button type="button" className="text-button" onClick={onReschedule}>Перенести дату или часовой пояс</button>}</FormField><FormField label="Лимит бюджета, ₽"><input type="number" min="0" step="0.01" value={f.limit} onChange={e => set('limit', e.target.value)} /></FormField></div><FormField label="Место"><input value={f.location} onChange={e => set('location', e.target.value)} /></FormField><FormField label="Заметка для команды"><textarea value={f.notes} onChange={e => set('notes', e.target.value)} /></FormField>{!project&&templates.length>0&&<FormField label="Шаблон"><select value={f.templateId||''} onChange={e=>set('templateId',e.target.value)}><option value="">Основной</option>{templates.map(t=><option value={t.id} key={t.id}>{t.data.name}</option>)}</select></FormField>}{project&&<><FormField label="Состояние проекта"><select value={f.status} onChange={e=>set('status',e.target.value)}>{['planning','confirmed','completed','archived'].map(k=><option value={k} key={k}>{statuses[k]||k}</option>)}</select></FormField><fieldset className="permission-grid"><legend>Доступно без сети после подготовки</legend>{Object.entries({payouts:'Предстоящие выплаты',budget:'Полная смета и журнал',vendors:'Подрядчики',files:'Список файлов'}).map(([key,label])=><label key={key}><input type="checkbox" checked={f.offline.includes(key)} onChange={e=>set('offline',e.target.checked?[...f.offline,key]:f.offline.filter(x=>x!==key))}/>{label}</label>)}</fieldset><p className="quiet-copy">Каждая рабочая таблица включается отдельно в её структуре. Файлы требуют сети для скачивания.</p></>}<FormActions onCancel={onClose} label={project ? 'Сохранить изменения' : 'Создать свадьбу'} busy={busy} /></SafeForm></Modal>;
}
function Projects({
  state,
  onProject,
  onCreate,
  onEdit
}) {
  const [query, setQuery] = useState('');
  const projects = arr(state.projects).filter(project => JSON.stringify(dataOf(project)).toLowerCase().includes(query.toLowerCase()));
  return <><PageHeader eyebrow="Свадьбы" title="Все проекты" action={has(state,'projects')&&<button className="button" onClick={onCreate}><Icon name="plus" />Новая свадьба</button>} /><div className="filters"><label className="search"><Icon name="search" /><input placeholder="Найти пару или площадку" value={query} onChange={e => setQuery(e.target.value)} /></label><span>{projects.length} {projects.length === 1 ? 'проект' : 'проектов'}</span></div><div className="project-grid">{projects.map(project => {
        const d = dataOf(project);
        return <article className="project-card" key={project.id}><div className="project-card-top"><span className={`status-dot ${d.status || 'planning'}`} /><button className="icon-button" onClick={() => onEdit(project)} aria-label="Изменить свадьбу">•••</button></div><button className="project-open" onClick={() => onProject(project)}><h2>{d.name || project.name}</h2><p>{dateLabel(d.date)}{d.location && ` · ${d.location}`}</p><span className="status-label">{statuses[d.status] || 'Подготовка'} <Icon name="arrow" /></span></button></article>;
      })}</div>{!projects.length && <Empty title="Пока нет свадеб" text="Создайте первый проект или одобрьте входящую заявку." action="Новая свадьба" onAction={onCreate} />}</>;
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
  return <><PageHeader eyebrow="Свадьба" title={d.name || 'Проект'} action={<button className="button quiet" onClick={onProjectEdit}>Изменить данные</button>}><p className="subtitle">{dateLabel(d.date)} {d.location && ` · ${d.location}`}</p></PageHeader><div className="metric-grid"><Metric label="Согласовано" value={money(fin.agreed || 0)} note="стоимость услуг" /><Metric label="Оплачено" value={money(fin.totalPaid || 0)} note="фактические выплаты" /><Metric label="К оплате" value={money(fin.due || 0)} note="по обязательствам" /><Metric label="У организаторов" value={money(fin.custody || 0)} note="средства пары" /><Metric label="До лимита" value={remaining == null ? 'Не задан' : money(remaining)} note={limit == null ? 'задайте бюджет проекта' : `лимит ${money(limit)}`} /></div><div className="split-grid"><section className="panel"><div className="panel-header"><div><p className="eyebrow">Ближайшие выплаты</p><h2>Кому и когда платить</h2></div><button className="text-button" onClick={() => openTab('estimate')}>Вся смета <Icon name="arrow" /></button></div>{upcoming.length ? <div className="due-list">{upcoming.map(item => {
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
function CategoryList({items,onEdit}) { return onEdit?<details className="panel category-list"><summary>Категории</summary><div className="button-group">{items.map(c=><button className="button quiet small" key={c.id} onClick={()=>onEdit(c)}>{c.data.name}{c.data.archived?' · Архив':''}</button>)}<button className="text-button" onClick={()=>onEdit()}>+ Категория</button></div></details>:null; }
function Finance({
  state,
  agency = false,
  onMovement,
  onEditObligation,
  onAddObligation,
  onEditMovement,
  onDeleteMovement, onCategory, onDeleteObligation
}) {
  const fin = state.financials || {};
  const obligations = byKind(state, 'obligation');
  const movements = byKind(state, 'movement');
  const [kind, setKind] = useState('');
  const [period, setPeriod] = useState('');
  const [category,setCategory]=useState(''),[fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState('');
  const categories=byKind(state,'category');
  const shown = movements.filter(m => (!kind || dataOf(m).type === kind) && (!period || String(dataOf(m).date || '').startsWith(period)) && (!category || dataOf(m).categoryId===category) && (!fromDate||dataOf(m).date>=fromDate) && (!toDate||dataOf(m).date<=toDate));
  return <><PageHeader eyebrow={agency ? 'Агентство' : 'Смета'} title={agency ? 'Собственный бюджет' : 'Смета и выплаты'} action={<div className="button-group">{!agency && <button className="button quiet" onClick={onAddObligation}><Icon name="plus" />Статья</button>}<button className="button" onClick={onMovement}><Icon name="plus" />Движение</button></div>} />{agency ? <div className="metric-grid"><Metric label="Собственные средства" value={money(fin.own || 0)} note="отдельно от средств пар" /><Metric label="Доходы" value={money(fin.income || 0)} note="включая гонорары" /><Metric label="Расходы" value={money(fin.expense || 0)} note="операции агентства" /></div> : <div className="metric-grid"><Metric label="Согласовано" value={money(fin.agreed || 0)} note="стоимость услуг" /><Metric label="Планируется" value={money(fin.planned || 0)} note="оценки без договора" /><Metric label="Не определено" value={String(fin.unknown || 0)} note="цена ещё не согласована" /><Metric label="Оплачено" value={money(fin.totalPaid || 0)} note="фактические выплаты" /><Metric label="Осталось" value={money(fin.due || 0)} note="по согласованным статьям" /></div>} {!agency && <section className="panel"><div className="panel-header"><div><p className="eyebrow">Реестр выплат</p><h2>Статьи сметы</h2></div></div><div className="data-list">{obligations.map(item => {
          const d = dataOf(item),
            paid = d.paid ?? fin.paid?.[item.id] ?? 0;
          return <article key={item.id} className="data-row static"><button className="text-button" onClick={()=>onEditObligation(item)}><div><strong>{d.title}</strong><small>{d.dueDate ? `Срок: ${dateLabel(d.dueDate)}` : d.condition || 'Срок не указан'}</small></div><span>{d.priceKind==='included' ? 'Включено в пакет' : d.agreed == null ? 'Цена не определена' : money(d.agreed)}</span><span className="paid-cell">Оплачено {money(paid)}<small>Осталось {money(d.due ?? Math.max(0, (d.agreed || 0) - paid))}</small></span><Icon name="arrow" /></button><button className="text-button danger-text" onClick={()=>onDeleteObligation?.(item)}>Удалить</button></article>;
        })}{!obligations.length && <Empty title="Смета пуста" text="Добавьте согласованную услугу или ориентировочную стоимость." action="Добавить статью" onAction={onAddObligation} />}</div></section>}<CategoryList items={categories} onEdit={onCategory}/>{Object.keys(agency?(fin.incomeByCategory||{}):(fin.byCategory||{})).length>0&&<section className="panel"><h2>{agency?'Доходы по категориям':'Стоимость по категориям'}</h2>{Object.entries(agency?fin.incomeByCategory:fin.byCategory).map(([id,value])=><div className="data-row static" key={id}><span>{categories.find(c=>c.id===id)?.data.name||'Без категории'}</span><strong>{money(value)}</strong></div>)}</section>}{agency&&Object.keys(fin.expenseByCategory||{}).length>0&&<section className="panel"><h2>Расходы по категориям</h2>{Object.entries(fin.expenseByCategory).map(([id,value])=><div className="data-row static" key={id}><span>{categories.find(c=>c.id===id)?.data.name||'Без категории'}</span><strong>{money(value)}</strong></div>)}</section>}<div className="filters ledger-filters"><label>Тип <select value={kind} onChange={e => setKind(e.target.value)}><option value="">Все</option>{(agency ? [['income', 'Доход'], ['expense', 'Расход']] : [['deposit', 'Поступление'], ['payment', 'Выплата'], ['refund', 'Возврат'], ['transfer', 'Передача'], ['fee', 'Гонорар']]).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Месяц <input type="month" value={period} onChange={e => setPeriod(e.target.value)} /></label><label>Категория<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Все</option>{categories.map(c=><option value={c.id} key={c.id}>{c.data.name}</option>)}</select></label><label>С даты<input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label><label>По дату<input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label></div><Ledger movements={shown} agency={agency} onEdit={onEditMovement} onDelete={onDeleteMovement} /></>;
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
    fee: !!d.fee
  });
  return <Modal title={obligation ? 'Статья сметы' : 'Новая статья сметы'} onClose={onClose}><SafeForm className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave({
        ...f,
        agreed: f.priceKind === 'amount' && f.agreed !== '' ? Math.round(Number(f.agreed) * 100) : null,
        planned: f.planned === '' ? null : Math.round(Number(f.planned) * 100)
      });
      onClose();
    }}><FormField label="За что платим"><input autoFocus required value={f.title} onChange={e => set('title', e.target.value)} /></FormField><FormField label="Статус цены"><select value={f.priceKind} onChange={e => set('priceKind', e.target.value)}><option value="amount">Согласованная сумма</option><option value="unknown">Цена неизвестна</option><option value="included">Включено в другую услугу</option></select></FormField><div className="form-columns">{f.priceKind === 'amount' && <FormField label="Согласовано, ₽"><input required type="number" step=".01" min="0" value={f.agreed} onChange={e => set('agreed', e.target.value)} /></FormField>}<FormField label="Оценка, ₽"><input type="number" step=".01" min="0" value={f.planned} onChange={e => set('planned', e.target.value)} /></FormField></div><FormField label="Дата выплаты"><input type="date" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} /></FormField><FormField label="Условие оплаты"><input placeholder="После подтверждения площадки" value={f.condition} onChange={e => set('condition', e.target.value)} /></FormField><FormField label="Категория"><select value={f.categoryId} onChange={e=>set('categoryId',e.target.value)}><option value="">Без категории</option>{categories.filter(c=>!c.data.archived||c.id===f.categoryId).map(c=><option key={c.id} value={c.id}>{c.data.name}</option>)}</select></FormField><FormField label="Ответственный"><select value={f.responsible} onChange={e=>set('responsible',e.target.value)}><option value="">Не назначен</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></FormField><label className="check-field"><input type="checkbox" checked={f.fee} onChange={e => set('fee', e.target.checked)} /> Гонорар агентства</label><FormActions onCancel={onClose} /></SafeForm></Modal>;
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
  return <><PageHeader eyebrow="Заявки" title={onReview?"Входящие обращения":"Мои заявки"} action={!onReview&&!apps.length&&<button className="button" onClick={onCreate}>Оставить заявку</button>}/>{!onReview&&arr(state.notifications).length>0&&<section className="panel"><h2>Уведомления</h2>{state.notifications.map(n=><p key={n.id}>{n.data.message||n.data.title||n.data.text}</p>)}</section>}<section className="panel">{apps.length ? <div className="data-list">{apps.map(item => {
          const d = dataOf(item);
          const needsResponse=['clarification','rejected'].includes(d.status);
          return <article className="application-row" key={item.id}><div><span className={`status-badge ${d.status || 'review'}`}>{statuses[d.status] || 'На рассмотрении'}</span><h2>{d.name}</h2><p>{dateLabel(d.date)} · {d.contact}</p>{d.message && <p>{d.message}</p>}{d.reason && <p className="reason">Решение: {d.reason}</p>}</div>{onReview && ['review','clarification'].includes(d.status || 'review') && <button className="button quiet" onClick={() => onReview(item)}>Рассмотреть</button>}{!onReview && needsResponse && <button className="button" onClick={()=>onRespond(item)}>Уточнить заявку</button>}{!onReview && d.status==='review' && <span className="quiet-copy">Заявка принята и ожидает решения.</span>}{!onReview && d.status==='approved' && <span className="quiet-copy">Проект открыт в вашем кабинете.</span>}</article>;
        })}</div> : <Empty title="Новых заявок нет" text="Обращения с публичной страницы появятся здесь." />}</section></>;
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
function Catalog({
  state, onCategory,
  projectMode,
  onVendor
}) {
  const [query,setQuery]=useState(''),[archived,setArchived]=useState(false);
  const vendors = byKind(state, projectMode ? 'selection' : 'vendor').filter(v=>(archived||!v.data.archived)&&JSON.stringify(v.data).toLowerCase().includes(query.toLowerCase()));
  return <><PageHeader eyebrow={projectMode ? 'Свадьба' : 'Агентство'} title={projectMode ? 'Подрядчики и варианты' : 'Общий каталог'} action={<button className="button" onClick={() => onVendor()}><Icon name="plus" />Подрядчик</button>} /><div className="filters"><label className="search"><input placeholder="Поиск подрядчика" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="check-field"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Показать архив</label></div>{!projectMode&&<CategoryList items={byKind(state,'vendorCategory')} onEdit={onCategory}/>}<div className="card-list">{vendors.map(v => {
        const d = dataOf(v);
        return <article key={v.id} className="vendor-card"><div className="vendor-monogram">{(d.title || d.name || '?').slice(0, 1)}</div><div><h2>{d.title || d.name}</h2><p>{d.selected ? 'Выбран · ' : ''}{d.services || d.category || 'Услуги не указаны'}</p><small>{d.contact || 'Контакты не указаны'}</small>{!projectMode&&<small>Обновлено {dateLabel(d.updatedOn)} · Свадеб: {(state.vendorHistory||[]).filter(h=>h.data.vendorId===v.id).length}</small>}{d.portfolio&&<a href={d.portfolio} target="_blank" rel="noreferrer">Портфолио</a>}</div><div className="vendor-price">{d.price != null ? money(d.price) : 'По запросу'}<button className="text-button" onClick={() => onVendor(v)}>Изменить</button></div></article>;
      })}</div>{!vendors.length && <Empty title="Каталог пока пуст" text="Добавьте подрядчика с актуальными условиями и контактами." action="Добавить подрядчика" onAction={() => onVendor()} />}</>;
}
function VendorForm({vendor,projectMode,categories=[],catalog=[],onDelete,onClose,onSave}) {
 const d=dataOf(vendor);const [f,set]=useForm({name:d.name||d.title||'',contact:d.contact||'',services:d.services||'',price:d.price==null?'':d.price/100,terms:d.terms||'',notes:d.notes||'',portfolio:d.portfolio||'',updatedOn:d.updatedOn||today(),categoryId:d.categoryId||'',vendorId:d.vendorId||'',selected:!!d.selected,dueDate:d.dueDate||'',workingTime:d.workingTime||'',archived:!!d.archived});const [error,setError]=useState('');
 const choose=id=>{const v=catalog.find(v=>v.id===id);set('vendorId',id);if(v){for(const key of ['name','contact','services','terms','portfolio'])set(key,v.data[key]||'');set('price',v.data.price==null?'':v.data.price/100);}};
 return <Modal title={projectMode?'Условия подрядчика на свадьбу':'Карточка подрядчика'} onClose={onClose}><SafeForm className="form-stack" onSubmit={async e=>{e.preventDefault();try{await onSave({...f,...(projectMode?{title:f.name}:{}),price:f.price===''?null:Math.round(Number(f.price)*100)});onClose()}catch(e){setError(e.message)}}}>
 {projectMode&&catalog.length>0&&<FormField label="Выбрать из каталога"><select value={f.vendorId} onChange={e=>choose(e.target.value)}><option value="">Свой вариант</option>{catalog.filter(v=>!v.data.archived).map(v=><option key={v.id} value={v.id}>{v.data.name}</option>)}</select></FormField>}
 <FormField label="Имя или название"><input required value={f.name} onChange={e=>set('name',e.target.value)}/></FormField><FormField label="Контакты"><input value={f.contact} onChange={e=>set('contact',e.target.value)}/></FormField><FormField label="Услуги и пакет"><textarea value={f.services} onChange={e=>set('services',e.target.value)}/></FormField>
 {!projectMode&&<FormField label="Категория"><select value={f.categoryId} onChange={e=>set('categoryId',e.target.value)}><option value="">Без категории</option>{categories.map(c=><option key={c.id} value={c.id}>{c.data.name}</option>)}</select></FormField>}<FormField label={projectMode?'Согласованная цена, ₽':'Актуальная цена, ₽'}><input type="number" min="0" step="0.01" value={f.price} onChange={e=>set('price',e.target.value)}/></FormField><FormField label="Условия"><textarea value={f.terms} onChange={e=>set('terms',e.target.value)}/></FormField><FormField label="Портфолио"><input type="url" value={f.portfolio} onChange={e=>set('portfolio',e.target.value)}/></FormField>
 {projectMode?<><label className="check-field"><input type="checkbox" checked={f.selected} onChange={e=>set('selected',e.target.checked)}/>Выбран для свадьбы — включить в смету</label><FormField label="Дата выплаты"><input type="date" value={f.dueDate} onChange={e=>set('dueDate',e.target.value)}/></FormField><FormField label="Время работы"><input value={f.workingTime} onChange={e=>set('workingTime',e.target.value)}/></FormField></>:<FormField label="Дата обновления"><input type="date" value={f.updatedOn} onChange={e=>set('updatedOn',e.target.value)}/></FormField>}
 <FormField label={projectMode?'Заметка для пары и команды':'Внутренняя заметка агентства'}><textarea value={f.notes} onChange={e=>set('notes',e.target.value)}/></FormField>{!projectMode&&<label className="check-field"><input type="checkbox" checked={f.archived} onChange={e=>set('archived',e.target.checked)}/>В архиве</label>}{error&&<p className="form-error">{error}</p>}{onDelete&&<button type="button" className="text-button danger-text" onClick={onDelete}>Удалить запись</button>}<FormActions onCancel={onClose}/></SafeForm></Modal>;
}

function Roles({
  state,
  onRole,
  onGrant
}) {
  const roles = arr(state.roles);
  const users = arr(state.users);
  return <><PageHeader eyebrow="Доступ" title="Роли и назначения" action={<div className="button-group"><button className="button quiet" onClick={() => onGrant()}>Назначить доступ</button><button className="button" onClick={() => onRole()}><Icon name="plus" />Роль</button></div>} /><div className="split-grid"><section className="panel"><div className="panel-header"><h2>Роли</h2></div><div className="data-list">{roles.map(role => {
            const d = dataOf(role);
            return <button className="data-row" key={role.id} onClick={() => onRole(role)}><div><strong>{d.name}</strong><small>{arr(d.permissions).map(p => permissionLabels[p] || p).join(' · ') || 'Нет прав'}</small></div><Icon name="arrow" /></button>;
          })}</div></section><section className="panel"><div className="panel-header"><h2>Участники</h2></div><div className="data-list">{users.map(user => {
            const d = dataOf(user);
            return <button className="data-row" key={user.id} onClick={() => onGrant(user)}><div><strong>{d.name || d.email}</strong><small>{d.email}</small></div><span>{d.disabled ? 'Отключён' : 'Настроить доступ'}</span><Icon name="arrow" /></button>;
          })}</div></section></div></>;
}
function RoleForm({
  role,
  onClose,
  onSave
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
    }}><FormField label="Название"><input autoFocus required value={f.name} onChange={e => set('name', e.target.value)} /></FormField><fieldset className="permission-grid"><legend>Разрешения</legend>{permissions.map(p => <label key={p}><input type="checkbox" checked={f.permissions.includes(p)} onChange={() => toggle(p)} />{permissionLabels[p]}</label>)}</fieldset><FormActions onCancel={onClose} /></SafeForm></Modal>;
}


function Settings({
  state,
  onSave,
  onTemplate
}) {
  const d = dataOf(state.agency);
  const [f, set] = useForm({
    name: d.name || '',
    tagline: d.settings?.tagline || '',
    description: d.settings?.description || '',
    contact: d.settings?.contact || '',
    services: arr(d.settings?.services).join('\n'), portfolio:arr(d.settings?.portfolio)
  });
  return <><PageHeader eyebrow="Агентство" title="Настройки" /><section className="settings-layout"><SafeForm className="panel form-stack" onSubmit={async e => {
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
      }}><FormField label="Название агентства"><input required value={f.name} onChange={e => set('name', e.target.value)} /></FormField><FormField label="Фраза на публичной странице"><input value={f.tagline} onChange={e => set('tagline', e.target.value)} /></FormField><FormField label="Описание"><textarea value={f.description} onChange={e => set('description', e.target.value)} /></FormField><FormField label="Контакт"><input value={f.contact} onChange={e => set('contact', e.target.value)} /></FormField><FormField label="Услуги, по одной в строке"><textarea value={f.services} onChange={e => set('services', e.target.value)} /></FormField><fieldset className="form-stack"><legend>Портфолио публичного сайта</legend>{f.portfolio.map((item,i)=><div key={i} className="form-stack"><FormField label="Название истории"><input required value={item.title} onChange={e=>set('portfolio',f.portfolio.map((x,n)=>n===i?{...x,title:e.target.value}:x))}/></FormField><FormField label="Изображение (ссылка)"><input required type="url" value={item.image} onChange={e=>set('portfolio',f.portfolio.map((x,n)=>n===i?{...x,image:e.target.value}:x))}/></FormField><FormField label="Описание истории"><textarea value={item.description||''} onChange={e=>set('portfolio',f.portfolio.map((x,n)=>n===i?{...x,description:e.target.value}:x))}/></FormField><button type="button" className="text-button danger-text" onClick={()=>set('portfolio',f.portfolio.filter((_,n)=>n!==i))}>Удалить историю</button></div>)}<button type="button" className="text-button" onClick={()=>set('portfolio',[...f.portfolio,{title:'',image:'',description:''}])}>+ История</button></fieldset><div><button className="button">Сохранить настройки</button></div></SafeForm><section className="panel"><p className="eyebrow">Шаблоны</p><h2>Стартовая структура свадеб</h2><p>Изменения шаблона применяются только при создании новых проектов.</p><div className="data-list">{byKind(state,'template').map(t=><button className="data-row" key={t.id} onClick={()=>onTemplate(t)}><strong>{t.data.name}</strong><span>{t.data.tables.length} таблиц</span></button>)}</div><button className="button quiet" onClick={()=>onTemplate()}>Создать шаблон</button></section></section></>;
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
  onRestore, onCategory, onDeleteObligation, runV2
}) {
  const [, tab = 'overview', targetTableId] = view.split(':');
  const entities = arr(state.entities);
  const tables = entities.filter(e => e.kind === 'table' && !e.deleted);
  const tableKey = tab === 'guests' ? 'guests' : tab.startsWith('timing') ? 'timing' : tab;
  const table = tab === 'table' ? tables.find(e => e.id === targetTableId) : tables.find(e => dataOf(e).key === tableKey || dataOf(e).name?.toLowerCase().includes(tab === 'timing' ? 'тайминг' : 'гост'));
  const rows = table ? entities.filter(e => e.parent_id === table.id && !e.deleted) : [];
  let content;
  if (tab === 'payouts' || (state.offline && !state.financials && ['overview','estimate'].includes(tab))) content=<Payouts state={state} onPay={onMovement}/>;else if(tab==='offline')content=<PageHeader eyebrow="Работа без сети" title="Данные на этом устройстве"/>;else if (tab === 'overview') content = <Overview state={state} onProjectEdit={onProjectEdit} openTab={key => setView(`project:${key}`)} onMovement={onMovement} />;else if (tab === 'estimate') content = <Finance state={state} onCategory={onCategory} onDeleteObligation={onDeleteObligation} onMovement={onMovement} onAddObligation={onAddObligation} onEditObligation={onEditObligation} onEditMovement={onEditMovement} onDeleteMovement={onDeleteMovement} />;else if (tab === 'catalog') content = <Catalog state={state} projectMode onVendor={onVendor} />;else if (tab === 'files') content = <Files state={state} onFile={onFile} />;else if (tab === 'history') content = <History state={state} onRestore={onRestore} />;else if (tab === 'tables') content = <><PageHeader eyebrow="Структура проекта" title="Все рабочие таблицы" action={<button className="button" onClick={onCreateTable}><Icon name="plus"/>Таблица</button>}/><TableLibrary tables={tables} sections={entities.filter(e=>e.kind==='section'&&!e.deleted)} setView={setView} onSection={onSection} onTable={(item,action)=>action==='delete'?onTable('delete',item):onTable('structure',item)}/></>;else content = <><PageHeader eyebrow="Рабочая таблица" title={dataOf(table).name || (tab === 'guests' ? 'Гости и рассадка' : 'Тайминг дня')} action={<button className="button quiet" onClick={onInvite}><Icon name="plus" />Пригласить участника</button>} />{tab.startsWith('timing')&&runV2&&!state.offline&&<details className="v2-timing-details"><summary>Настройка календаря и ответственных</summary><TimingSetup state={state} projectId={state.project.id} table={table} run={runV2}/></details>}<TableWorkspace members={state.assignableMembers||state.members||[]} key={table?.id} relationRows={entities.filter(e=>['row','seatingTable'].includes(e.kind))} table={table} rows={rows} files={entities.filter(e=>e.kind==='file'&&!e.deleted)} audience={tab==='timing-pair'?'Пара':tab==='timing-team'?'Команда':null} canEdit={has(state,'edit',state.project.id)} canCreate={permitted(state,'create',table?.id,null,null)} canStructure={permitted(state,['edit','structure'],table?.id,table?.id,null)} canEditField={(row,col)=>permitted(state,'edit',table?.id,row.id,col.id)} canDeleteRow={row=>permitted(state,'delete',table?.id,row.id,null)} onEditRow={(row, data) => onTable('edit', row, data)} onAddRow={() => onTable('add', table)} onEditTable={() => onTable('structure', table)} onDeleteRow={row => onTable('delete', row)} onReorder={rowOrder=>onTable('reorder',table,rowOrder)} /></>;
  return <>{content}{['files','catalog'].includes(tab)&&runV2&&<VerificationPanel state={state} projectId={state.project.id} run={runV2} type={tab==='files'?'file':'selection'}/>}<Offline project={state.project} status={offline} {...offlineActions} /></>;
}
function Files({
  state,
  onFile
}) {
  const files = arr(state.files || state.entities).filter(x => x.kind === 'file');
  return <><PageHeader eyebrow="Материалы" title="Файлы" action={<label className="button"><input className="sr-only" type="file" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} /><Icon name="plus" />Загрузить файл</label>} /><section className="panel">{files.length ? <div className="data-list">{files.map(file => <a className="data-row" key={file.id} href={`/api/files/${file.id}`}><div><strong>{dataOf(file).name || 'Файл'}</strong><small>{dataOf(file).size ? `${Math.round(dataOf(file).size / 1024)} КБ` : 'Скачать файл'}</small></div><Icon name="arrow" /></a>)}</div> : <Empty title="Файлов пока нет" text="Загрузите договор, визуальные материалы или подтверждение оплаты." />}</section></>;
}
function History({
  state,
  onRestore
}) {
  const items = arr(state.history);
  return <><PageHeader eyebrow="История" title="Изменения и восстановление" /><section className="panel">{items.length ? <div className="data-list">{items.map(item => <div className="data-row static" key={item.id}><div><strong>{item.action || dataOf(item).action || 'Изменение данных'}</strong><small>{item.updated_at || dataOf(item).updated_at || item.created_at || 'Дата не указана'} {item.author && ` · ${item.author}`}</small></div>{item.entity_id && <button className="text-button" onClick={() => onRestore(item)}>Восстановить</button>}</div>)}</div> : <p className="quiet-copy">История изменений появится после первой правки.</p>}</section></>;
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
    [catalogCache,setCatalogCache]=useState([]);
  const flash = (text, kind = 'success') => setNotice({
    text,
    kind
  });
  const refresh = useCallback(async projectId => {
    const next = await loadState(projectId);
    setState(next);
    return next;
  }, []);
  const activeProject = useRef(null);
  const setView=next=>{setViewState(next);const path=viewUrl(next,activeProject.current);if(location.pathname!==path)history.pushState(null,'',path+location.search);};
  const navigate=async path=>{const route=parseRoute(new URL(path,location.origin).pathname);if(!route)return;try{const next=await loadState(route.projectId);activeProject.current=route.projectId;setState(next);setSelected(next.project||null);setViewState(route.view);history.pushState(null,'',path);setOffline(await getOfflineStatus(route.projectId));}catch(error){flash(error.message,'error')}};
  useEffect(()=>{const pop=async()=>{const route=parseRoute(location.pathname);if(!route)return;try{const next=await loadState(route.projectId);activeProject.current=route.projectId;setSelected(next.project||null);setState(next);setViewState(route.view);setMode('app');}catch(error){if(error.status===401)setMode('public');else flash(error.message,'error')}};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[]);
  useEffect(()=>{const parts=view.split(':'),target=parts[2];if(!target)return;if(['estimate','payouts','catalog','files'].includes(parts[1])){const row=state?.entities?.find(r=>r.id===target);if(!row)return;if(row.kind==='obligation')setModal({type:'obligation',item:row});if(row.kind==='selection')setModal({type:'vendor',item:row,project:true});}},[view,state?.project?.id]);
  const acceptState = useCallback(async next => {
    let requested=parseRoute(location.pathname);
    if(requested?.projectId&&!next.project){try{if(Array.isArray(next.projects)&&!next.projects.some(p=>p.id===requested.projectId)){const error=new Error('Доступ к свадьбе отозван');error.status=403;throw error;}next=await loadState(requested.projectId)}catch(error){if(![403,404].includes(error.status))throw error;requested=null;history.replaceState(null,'','/app/applications');flash('Доступ к свадьбе отозван','error');}}
    let project=next.project;
    const staff=has(next,'projects');
    if(!project && !staff && arr(next.projects).length===1) project=next.projects[0];
    if(!project && next.offline && arr(next.projects).length===1) project=next.projects[0];
    if(project) { next=next.project?next:await loadState(project.id); activeProject.current=project.id; setSelected(next.project); setView(next.offline?'project:payouts':requested?.projectId===project.id?requested.view:'project:overview'); setOffline(await getOfflineStatus(project.id)); }
    else { activeProject.current=null; setSelected(null);setView(staff?(requested?.projectId? 'today':requested?.view||'today'):'applications'); }
    setState(next);setMode(next.user?'app':'public');return next;
  },[]);
  useEffect(() => {
    let alive=true;
    (async()=>{try{await initClient();let next=await loadState();const invite=new URLSearchParams(location.search).get('invite');if(invite&&navigator.onLine){try{await command({op:'invite.accept',token:invite});const url=new URL(location.href);url.searchParams.delete('invite');history.replaceState(null,'',url);next=await loadState();}catch(error){flash(error.message,'error');}}if(alive){await acceptState(next);if(Object.keys(incomingSource).length)setModal({type:'application'});}}catch{try{const info=await api(`/api/public?agency=${encodeURIComponent(agencySlug())}`);if(alive)setPublicInfo(info);}catch{}if(alive){setMode('public');if(Object.keys(incomingSource).length)setModal({type:'auth',mode:'login',next:'application'});}}})();
    const off=subscribe(async()=>{try{const next=await loadState(activeProject.current);if(alive){setState(next);setOffline(await getOfflineStatus(activeProject.current));}}catch(error){if(error.status===401&&alive){setState(null);setMode('public');}else if(error.status===403&&alive){activeProject.current=null;await acceptState(await loadState());}}});
    const timer=setInterval(async()=>{if(!navigator.onLine||document.visibilityState!=='visible')return;try{const next=await loadState(activeProject.current);if(alive){if(!activeProject.current&&!has(next,'projects')&&next.projects?.length===1)await acceptState(next);else setState(next);}}catch{}},15000);
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
  const openProject = async project => {
    try {
      if(!state?.project)setCatalogCache(byKind(state,"vendor"));
      const fresh=await refresh(project.id);
      activeProject.current=project.id;
      setSelected(fresh.project);
      setView('project:overview');
      setOffline(await getOfflineStatus(project.id));
    } catch (err) {
      flash(err.message, 'error');
    }
  };
  const openAgency = async nextView => {
    activeProject.current=null;
    await refresh(null);
    setSelected(null);
    setView(nextView);
  };
  const authDone = async () => {
    const nextModal=modal?.next;setModal(null);
    const invitation=new URLSearchParams(location.search).get('invite');
    if(invitation){await command({op:'invite.accept',token:invitation});const url=new URL(location.href);url.searchParams.delete('invite');history.replaceState(null,'',url);}
    await acceptState(await loadState());
    if(nextModal==='application'||savedApplication().sourceCaseId||savedApplication().sourcePackageId)setModal({type:'application'});
  };
  if (mode === 'loading') return <div className="loading"><Mark /><span>Открываем tie</span></div>;
  if (mode === 'public') return <><PublicHome info={publicInfo} onAuth={type => setModal({
      type: 'auth',
      mode: type === 'register' && publicInfo?.setup ? 'setup' : type
    })} onApplication={() => setModal({
      type: 'auth',
      mode: publicInfo?.setup ? 'setup' : 'register',
      next: 'application'
    })} />{modal?.type === 'auth' && <AuthDialog mode={modal.mode} onClose={() => setModal(null)} onAuth={authDone} />} {modal?.type === 'application' && <ApplicationDialog onClose={() => setModal(null)} onSent={async()=>{await refresh(null);setView('applications')}} />}<Notice notice={notice} onDismiss={() => setNotice(null)} /></>;
  const projectId = state?.project?.id;
  const workspace = view.startsWith('project:');
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
  const restore = item => run({
    op: 'entity.restore',
    projectId,
    entityId: item.entity_id,
    version: item.current_version || entities.find(e=>e.id===item.entity_id)?.version || JSON.parse(item.after_json || '{}').version,
    schemaVersion: entities.find(e=>e.id===JSON.parse(item.after_json || '{}').parent_id)?.version,
    auditId: item.id
  }, projectId);
  const moduleProps={state,projectId,run:(op,body)=>run({op,...body},body?.projectId===undefined?activeProject.current:body.projectId),refresh:()=>refresh(activeProject.current),navigate};
  const renderMain = () => {
    if(view==='content')return <AgencyPublishingWorkspace {...moduleProps}/>;
    if(view==='project:site')return <MicrositeWorkspace {...moduleProps}/>;
    if(view==='tasks'||view.startsWith('project:tasks'))return <TaskWorkspace {...moduleProps} projectId={view==='tasks'?null:projectId} sourceId={view.split(':')[2]}/>;
    if(view.startsWith('project:approvals'))return <ApprovalWorkspace {...moduleProps} sourceId={view.split(':')[2]}/>;
    if(view==='project:guests')return <GuestWorkspace {...moduleProps}/>;
    if(view==='project:seating')return <SeatingWorkspace {...moduleProps}/>;
    if(view==='today'||view==='project:overview'&&!state.offline)return <Dashboard {...moduleProps} projectId={view==='today'?null:projectId}/>;
    if(view==='calendar'||view.startsWith('project:calendar'))return <CalendarWorkspace {...moduleProps} projectId={view==='calendar'?null:projectId}/>;
    if(view==='notifications')return <NotificationCenter {...moduleProps}/>;
    if(view==='profile')return <NotificationPreferences {...moduleProps}/>;
    if(view==='project:more')return <><PageHeader eyebrow="Наша свадьба" title="Ещё в проекте"/><div className="v2-more-grid">{[['site','Сайт свадьбы'],['tables','Все таблицы'],['files','Файлы'],['history','История'],['members','Участники'],['offline','Офлайн'],['calendar','Календарь'],['settings','Данные свадьбы']].map(([key,label])=><button key={key} onClick={()=>setView('project:'+key)}>{label} →</button>)}</div></>;
    if(view==='project:settings')return <ReadinessSettings {...moduleProps} onEditProject={()=>setModal({type:'project',project:state.project})}/>;
    if(view==='project:members')return <><PageHeader eyebrow="Участники проекта" title="Вместе над свадьбой"/><div className="panel">{state.assignableMembers?.map(u=><p key={u.id}>{u.name}</p>)}<button className="button" onClick={()=>setModal({type:'invite'})}>Пригласить участника</button></div></>;
    if(view==='templates')return <><PageHeader eyebrow="Структура и подготовка" title="Шаблоны свадеб" action={<button className="button" onClick={()=>setModal({type:'template'})}>Новый шаблон</button>}/><div className="panel data-list">{byKind(state,'template').map(item=><button key={item.id} className="data-row" onClick={()=>setModal({type:'template',item})}>{item.data.name}<span>Изменить →</span></button>)}</div></>;

    if (workspace) return <Workspace runV2={moduleProps.run} state={state} view={view} setView={setView} onProjectEdit={() => setModal({
      type: 'project',
      project: state.project
    })} onMovement={obligation => setModal({type:'movement',agency:false,item:obligation?.kind==='obligation'?{data:{type:obligation.data.fee?'fee':'payment',obligationId:obligation.id,amount:obligation.due??obligation.data.due??Math.max(0,(obligation.data.agreed||0)-(state.financials?.paid?.[obligation.id]||0)),description:obligation.data.title,source:'custody'}}:undefined})} onAddObligation={() => setModal({
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
    }} onFile={async file => {
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
          content: base64
        })
      });
      await refresh(projectId);
      flash('Файл загружен');
    }} onInvite={() => setModal({
      type: 'invite'
    })} />;
    if (view === 'projects') return <Projects state={state} onProject={openProject} onCreate={() => setModal({
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
    if (view === 'agency') return <Finance state={state} agency onCategory={item=>setModal({type:"category",item,kind:"category",projectId:null})} onMovement={() => setModal({
      type: 'movement',
      agency: true
    })} onEditMovement={async item=>{if(item.project_id){await openProject({id:item.project_id});setView('project:estimate');}setModal({type:'movement',agency:!item.project_id,item})}} onDeleteMovement={item=>setModal({type:'confirmMovementDelete',item})}/>;
    if (view === 'access') return <Roles state={state} onRole={item => setModal({
      type: 'role',
      item
    })} onGrant={item => setModal({
      type: 'grant',
      item: item || state.users?.find(u=>!u.protected)
    })} />;
    if (view === 'settings') return <Settings state={state} onSave={values => run({
      op: 'settings.save',
      version: state.agency?.version,
      ...values
    })} onTemplate={item => setModal({type:'template',item})} />;
    return null;
  };
  return <><AppShell state={state} view={view} setView={nextView => view.startsWith('project:') && !nextView.startsWith('project:') ? openAgency(nextView) : setView(nextView)} selectedProject={selected} onProject={openProject} onMenu={() => {}} onLogout={async () => {
      await logout();
      activeProject.current=null;
      setPublicInfo(await api(`/api/public?agency=${encodeURIComponent(agencySlug())}`).catch(()=>publicInfo));
      setState(null);
      setMode('public');
      setView('projects');
    }}>{renderMain()}</AppShell><Notice notice={notice} onDismiss={() => setNotice(null)} />{modal?.type === 'application' && <ApplicationDialog onClose={()=>setModal(null)} onSent={async()=>{await refresh(null);setView('applications')}}/>}{modal?.type === 'project' && <ProjectForm project={modal.project} templates={byKind(state,'template')} onClose={() => setModal(null)} onSave={saveProject} onReschedule={()=>setModal({type:'reschedule'})} />} {modal?.type==='reschedule'&&<RescheduleDialog {...moduleProps} currentDate={state.project.data.date} currentTimeZone={state.project.data.timeZone} onDone={()=>refresh(projectId)} onClose={()=>setModal(null)}/>} {modal?.type === 'obligation' && <ObligationForm obligation={modal.item} categories={byKind(state,"category")} users={state.members||state.custodians||[]} onClose={() => setModal(null)} onSave={data => run(modal.item ? {
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
    })} />} {modal?.type === 'applicationResponse' && <ApplicationResponseForm application={modal.item} onClose={()=>setModal(null)} onSave={data=>run({op:'application.respond',entityId:modal.item.id,version:modal.item.version,data})}/>} {modal?.type === 'vendor' && <VendorForm vendor={modal.item} projectMode={modal.project} categories={byKind(state,modal.project?"category":"vendorCategory")} catalog={catalogCache} onDelete={modal.item?()=>setModal({type:"confirmDelete",item:modal.item}):null} onClose={() => setModal(null)} onSave={data => run(modal.item ? {
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
    })} />} {modal?.type === 'grant' && <GrantEditor user={modal.item} state={state} onClose={() => setModal(null)} onSave={f => run({
      op: 'grants.save',
      userId: f.userId || modal.item?.id,
      version: state.users?.find(u=>u.id===(f.userId || modal.item?.id))?.version,
      ...f
    })} />} {modal?.type === 'invite' && <InvitationEditor state={state} projectId={projectId} onClose={() => setModal(null)} onRevoke={invitationId=>run({op:'invite.revoke',invitationId},projectId)} onSave={f => run({
      op: 'invite.create',
      projectId,
      ...f
    }, projectId)} />} {modal?.type === 'section' && <SectionEditor section={modal.item} onClose={()=>setModal(null)} onSave={data=>run(modal.item ? {op:'entity.edit',projectId,entityId:modal.item.id,version:modal.item.version,data:{...dataOf(modal.item),...data}} : {op:'entity.create',projectId,kind:'section',data:{...data,order:entities.filter(e=>e.kind==='section').length}},projectId)}/>} {modal?.type === 'confirmSectionDelete' && <ConfirmDialog title="Удалить раздел?" danger confirm="Удалить" onClose={()=>setModal(null)} onConfirm={async()=>{await run({op:'entity.delete',projectId,entityId:modal.item.id,version:modal.item.version,confirm:true},projectId);setModal(null)}}><p>Будут скрыты таблицы: {entities.filter(e=>e.kind==='table'&&e.data.sectionId===modal.item.id).map(e=>e.data.name).join(', ')||'в разделе пока нет таблиц'}. Верните раздел через историю, чтобы снова открыть их.</p></ConfirmDialog>} {modal?.type === 'table' && <TableEditor table={modal.table} rowCount={entities.filter(e=>e.parent_id===modal.table?.id).length} sections={entities.filter(e => e.kind === 'section' && !e.deleted)} onClose={() => setModal(null)} onSave={data => run(modal.create ? { op: 'entity.create', projectId, kind: 'table', data: {...data, columns:data.columns.length ? data.columns : [{id:'title',name:'Название',type:'text'}]} } : {op: 'entity.edit', projectId, entityId: modal.table.id, version: modal.table.version, data}, projectId)} />} {modal?.type === 'template' && <TemplateEditor onClose={() => setModal(null)} template={modal.item} defaults={byKind(state,'template')[0]?.data} onSave={data=>run(modal.item?{op:'entity.edit',entityId:modal.item.id,version:modal.item.version,data}:{op:'entity.create',kind:'template',data},null)} />} {modal?.type==='category'&&<CategoryEditor category={modal.item} onClose={()=>setModal(null)} onSave={data=>run(modal.item?{op:'entity.edit',projectId:modal.projectId,entityId:modal.item.id,version:modal.item.version,data}:{op:'entity.create',projectId:modal.projectId,kind:modal.kind,data},modal.projectId)}/>} {modal?.type==='conflict'&&<ConflictEditor conflict={modal.item} state={state} onClose={()=>setModal(null)} onSave={async replacements=>{await retryCommand(modal.item.id,replacements);setOffline(await getOfflineStatus(projectId));flash('Правка подготовлена. Нажмите «Синхронизировать».')}}/>} {modal?.type==='confirmMovementDelete'&&<ConfirmDialog title="Удалить движение?" confirm="Удалить" danger onClose={()=>setModal(null)} onConfirm={async()=>{await run({op:'movement.delete',projectId:modal.item.project_id,entityId:modal.item.id,version:modal.item.version},workspace?modal.item.project_id:null);setModal(null)}}><p>Сумма будет исключена из остатков и оплат. История сохранится.</p></ConfirmDialog>} {modal?.type === 'confirmDelete'  && <ConfirmDialog title="Удалить запись?" danger confirm="Удалить" onClose={() => setModal(null)} onConfirm={async () => {
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

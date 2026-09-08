import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, command, discardCommand, getOfflineStatus, initClient, loadState, logout, prepareProject, retryCommand, subscribe, syncQueue } from './client.js';
import { dateLabel, money, permissionLabels, permissions, statuses, today } from './shared.js';
import { AppShell } from './ui/AppShell.jsx';
import { ConfirmDialog, FormField, Modal } from './ui/Modal.jsx';
import { Mark, Icon } from './ui/Mark.jsx';
import { Notice } from './ui/Notice.jsx';
import { TableWorkspace } from './ui/TableWorkspace.jsx';
import './styles.css';
const arr = value => Array.isArray(value) ? value : [];
const dataOf = item => item?.data || item || {};
const byKind = (state, kind) => arr(state?.entities).filter(item => item.kind === kind && !item.deleted);
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
  return <div className="public-page"><header className="public-nav"><button className="brand brand-button"><Mark compact /><span>tie</span></button><div className="nav-links"><a href="#services">Подход</a><a href="#portfolio">Портфолио</a><button className="text-button" onClick={() => onAuth('login')}>Войти</button><button className="button small" onClick={() => onAuth('register')}>Создать пространство</button></div></header>
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
        slug: setup ? f.slug : 'tie'
      } : setup ? f : {
        name: f.name,
        email: f.email,
        password: f.password,
        slug: 'tie'
      };
      const result = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      onAuth(result);
    } catch (err) {
      setError(err.message || 'Не удалось продолжить');
    } finally {
      setBusy(false);
    }
  };
  return <Modal title={mode === 'login' ? 'Войти в tie' : setup ? 'Настроить агентство' : 'Создать аккаунт'} onClose={onClose}><form onSubmit={submit} className="form-stack">{mode !== 'login' && <><FormField label="Ваше имя"><input autoFocus required value={f.name} onChange={e => set('name', e.target.value)} /></FormField>{setup && <><FormField label="Название агентства"><input required value={f.agencyName} onChange={e => set('agencyName', e.target.value)} /></FormField><FormField label="Адрес агентства" hint="Латинские буквы, цифры и дефис."><input required pattern="[a-z0-9-]{2,50}" value={f.slug} onChange={e => set('slug', e.target.value.toLowerCase())} /></FormField></>}</>}<FormField label="Почта"><input autoFocus={mode === 'login'} type="email" required value={f.email} onChange={e => set('email', e.target.value)} /></FormField><FormField label="Пароль"><input type="password" minLength="10" required value={f.password} onChange={e => set('password', e.target.value)} /></FormField>{error && <p className="form-error">{error}</p>}<FormActions onCancel={onClose} label={mode === 'login' ? 'Войти' : setup ? 'Настроить агентство' : 'Создать аккаунт'} busy={busy} /></form></Modal>;
}
function ApplicationDialog({
  onClose
}) {
  const [f, set] = useForm({
    name: '',
    date: '',
    contact: '',
    message: ''
  });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault();
    try {
      await api('/api/command', {
        method: 'POST',
        body: JSON.stringify({
          id: crypto.randomUUID(),
          op: 'application.create',
          data: f
        })
      });
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
  };
  return <Modal title="Заявка на свадьбу" onClose={onClose}>{sent ? <div className="dialog-body"><p>Заявка отправлена. Мы напишем по указанному контакту.</p><FormActions onCancel={onClose} label="Готово" /></div> : <form className="form-stack" onSubmit={submit}><p className="form-intro">Расскажите самое важное — детали можно уточнить позже.</p><FormField label="Как к вам обращаться"><input required autoFocus value={f.name} onChange={e => set('name', e.target.value)} /></FormField><FormField label="Дата свадьбы"><input required type="date" value={f.date} onChange={e => set('date', e.target.value)} /></FormField><FormField label="Почта или телефон"><input required value={f.contact} onChange={e => set('contact', e.target.value)} /></FormField><FormField label="Что для вас важно"><textarea value={f.message} onChange={e => set('message', e.target.value)} /></FormField>{error && <p className="form-error">{error}</p>}<FormActions onCancel={onClose} label="Отправить заявку" /></form>}</Modal>;
}
function ProjectForm({
  project,
  onClose,
  onSave
}) {
  const [f, set] = useForm({
    ...initialProject,
    status: 'planning',
    offline: [],
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
  return <Modal title={project ? 'Данные свадьбы' : 'Новая свадьба'} onClose={onClose}><form className="form-stack" onSubmit={submit}><FormField label="Название"><input autoFocus required placeholder="Алина и Максим" value={f.name} onChange={e => set('name', e.target.value)} /></FormField><div className="form-columns"><FormField label="Дата"><input required type="date" value={f.date} onChange={e => set('date', e.target.value)} /></FormField><FormField label="Лимит бюджета, ₽"><input type="number" min="0" step="0.01" value={f.limit} onChange={e => set('limit', e.target.value)} /></FormField></div><FormField label="Место"><input value={f.location} onChange={e => set('location', e.target.value)} /></FormField><FormField label="Заметка для команды"><textarea value={f.notes} onChange={e => set('notes', e.target.value)} /></FormField><FormActions onCancel={onClose} label={project ? 'Сохранить изменения' : 'Создать свадьбу'} busy={busy} /></form></Modal>;
}
function Projects({
  state,
  onProject,
  onCreate,
  onEdit
}) {
  const [query, setQuery] = useState('');
  const projects = arr(state.projects).filter(project => JSON.stringify(dataOf(project)).toLowerCase().includes(query.toLowerCase()));
  return <><PageHeader eyebrow="Свадьбы" title="Все проекты" action={<button className="button" onClick={onCreate}><Icon name="plus" />Новая свадьба</button>} /><div className="filters"><label className="search"><Icon name="search" /><input placeholder="Найти пару или площадку" value={query} onChange={e => setQuery(e.target.value)} /></label><span>{projects.length} {projects.length === 1 ? 'проект' : 'проектов'}</span></div><div className="project-grid">{projects.map(project => {
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
  const upcoming = byKind(state, 'obligation').filter(item => dataOf(item).dueDate && Math.max(0,(dataOf(item).agreed || 0) - (fin.paid?.[item.id] || 0)) > 0).sort((a, b) => String(dataOf(a).dueDate).localeCompare(String(dataOf(b).dueDate))).slice(0, 5);
  return <><PageHeader eyebrow="Свадьба" title={d.name || 'Проект'} action={<button className="button quiet" onClick={onProjectEdit}>Изменить данные</button>}><p className="subtitle">{dateLabel(d.date)} {d.location && ` · ${d.location}`}</p></PageHeader><div className="metric-grid"><Metric label="Согласовано" value={money(fin.agreed || 0)} note="стоимость услуг" /><Metric label="Оплачено" value={money(fin.totalPaid || 0)} note="фактические выплаты" /><Metric label="К оплате" value={money(fin.due || 0)} note="по обязательствам" /><Metric label="У организаторов" value={money(fin.custody || 0)} note="средства пары" /><Metric label="До лимита" value={remaining == null ? 'Не задан' : money(remaining)} note={limit == null ? 'задайте бюджет проекта' : `лимит ${money(limit)}`} /></div><div className="split-grid"><section className="panel"><div className="panel-header"><div><p className="eyebrow">Ближайшие выплаты</p><h2>Кому и когда платить</h2></div><button className="text-button" onClick={() => openTab('estimate')}>Вся смета <Icon name="arrow" /></button></div>{upcoming.length ? <div className="due-list">{upcoming.map(item => {
            const x = dataOf(item);
            return <div key={item.id}><span className="date-chip">{dateLabel(x.dueDate)}</span><strong>{x.title}</strong><span>{money(Math.max(0,(x.agreed || x.planned || 0)-(fin.paid?.[item.id] || 0)))}</span></div>;
          })}</div> : <Empty title="Нет запланированных выплат" text="Добавьте статью сметы с датой или условием оплаты." action="Добавить статью" onAction={() => openTab('estimate')} />}</section><section className="panel note-panel"><p className="eyebrow">Подготовка</p><h2>{d.status ? statuses[d.status] : 'Подготовка'}</h2><p>{d.notes || 'Добавьте заметку, чтобы команда видела ключевой контекст проекта.'}</p><button className="text-button" onClick={() => openTab('timing')}>Открыть тайминг <Icon name="arrow" /></button></section></div><section className="panel custody-panel"><div><p className="eyebrow">Деньги пары</p><h2>Реестр средств у организаторов</h2><p>Это отдельный остаток: он не является доходом агентства.</p></div><strong>{money(fin.custody || 0)}</strong><button className="button quiet" onClick={onMovement}>Записать движение</button></section></>;
}
function Metric({
  label,
  value,
  note
}) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
function Finance({
  state,
  agency = false,
  onMovement,
  onEditObligation,
  onAddObligation,
  onEditMovement,
  onDeleteMovement
}) {
  const fin = state.financials || {};
  const obligations = byKind(state, 'obligation');
  const movements = arr(fin.movements || state.movements);
  const [kind, setKind] = useState('');
  const [period, setPeriod] = useState('');
  const shown = movements.filter(m => (!kind || dataOf(m).type === kind) && (!period || String(dataOf(m).date || '').startsWith(period)));
  return <><PageHeader eyebrow={agency ? 'Агентство' : 'Смета'} title={agency ? 'Собственный бюджет' : 'Смета и выплаты'} action={<div className="button-group">{!agency && <button className="button quiet" onClick={onAddObligation}><Icon name="plus" />Статья</button>}<button className="button" onClick={onMovement}><Icon name="plus" />Движение</button></div>} />{agency ? <div className="metric-grid"><Metric label="Собственные средства" value={money(fin.own || 0)} note="отдельно от средств пар" /><Metric label="Доходы" value={money(fin.income || 0)} note="включая гонорары" /><Metric label="Расходы" value={money(fin.expense || 0)} note="операции агентства" /></div> : <div className="metric-grid"><Metric label="Согласовано" value={money(fin.agreed || 0)} note="стоимость услуг" /><Metric label="Планируется" value={money(fin.planned || 0)} note="оценки без договора" /><Metric label="Не определено" value={money(fin.unknown || 0)} note="цена ещё не согласована" /><Metric label="Оплачено" value={money(fin.totalPaid || 0)} note="фактические выплаты" /><Metric label="Осталось" value={money(fin.due || 0)} note="по согласованным статьям" /></div>} {!agency && <section className="panel"><div className="panel-header"><div><p className="eyebrow">Реестр выплат</p><h2>Статьи сметы</h2></div></div><div className="data-list">{obligations.map(item => {
          const d = dataOf(item),
            paid = fin.paid?.[item.id] || 0;
          return <button key={item.id} className="data-row" onClick={() => onEditObligation(item)}><div><strong>{d.title}</strong><small>{d.dueDate ? `Срок: ${dateLabel(d.dueDate)}` : d.condition || 'Срок не указан'}</small></div><span>{d.agreed == null ? 'Цена не определена' : money(d.agreed)}</span><span className="paid-cell">Оплачено {money(paid)}<small>Осталось {money(Math.max(0, (d.agreed || 0) - paid))}</small></span><Icon name="arrow" /></button>;
        })}{!obligations.length && <Empty title="Смета пуста" text="Добавьте согласованную услугу или ориентировочную стоимость." action="Добавить статью" onAction={onAddObligation} />}</div></section>}<div className="filters ledger-filters"><label>Тип <select value={kind} onChange={e => setKind(e.target.value)}><option value="">Все</option>{(agency ? [['income', 'Доход'], ['expense', 'Расход']] : [['deposit', 'Поступление'], ['payment', 'Выплата'], ['refund', 'Возврат'], ['transfer', 'Передача'], ['fee', 'Гонорар']]).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Месяц <input type="month" value={period} onChange={e => setPeriod(e.target.value)} /></label></div><Ledger movements={shown} agency={agency} onEdit={onEditMovement} onDelete={onDeleteMovement} /></>;
}
function Ledger({
  movements = [],
  agency,
  onEdit,
  onDelete
}) {
  return <section className="panel"><div className="panel-header"><div><p className="eyebrow">Журнал</p><h2>{agency ? 'Операции агентства' : 'Движение средств пары'}</h2></div></div>{movements.length ? <div className="data-list">{movements.slice(0, 30).map(move => {
        const d = dataOf(move);
        return <div key={move.id} className="data-row static"><div><strong>{d.description || d.type}</strong><small>{dateLabel(d.date)} · {d.source === 'custody' ? 'Средства пары' : 'Собственные средства'}</small></div><span>{money(d.amount || 0)}</span><span>{onEdit && <button className="text-button" onClick={() => onEdit(move)}>Изменить</button>}{onDelete && <button className="text-button danger-text" onClick={() => onDelete(move)}>Удалить</button>}</span></div>;
      })}</div> : <p className="quiet-copy">Операций пока нет.</p>}</section>;
}
function ObligationForm({
  obligation,
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
    responsible: d.responsible || '',
    fee: !!d.fee
  });
  return <Modal title={obligation ? 'Статья сметы' : 'Новая статья сметы'} onClose={onClose}><form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave({
        ...f,
        agreed: f.priceKind === 'amount' && f.agreed !== '' ? Math.round(Number(f.agreed) * 100) : null,
        planned: f.planned === '' ? null : Math.round(Number(f.planned) * 100)
      });
      onClose();
    }}><FormField label="За что платим"><input autoFocus required value={f.title} onChange={e => set('title', e.target.value)} /></FormField><FormField label="Статус цены"><select value={f.priceKind} onChange={e => set('priceKind', e.target.value)}><option value="amount">Согласованная сумма</option><option value="unknown">Цена неизвестна</option><option value="included">Включено в другую услугу</option></select></FormField><div className="form-columns">{f.priceKind === 'amount' && <FormField label="Согласовано, ₽"><input required type="number" step=".01" min="0" value={f.agreed} onChange={e => set('agreed', e.target.value)} /></FormField>}<FormField label="Оценка, ₽"><input type="number" step=".01" min="0" value={f.planned} onChange={e => set('planned', e.target.value)} /></FormField></div><FormField label="Дата выплаты"><input type="date" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} /></FormField><FormField label="Условие оплаты"><input placeholder="После подтверждения площадки" value={f.condition} onChange={e => set('condition', e.target.value)} /></FormField><FormField label="Ответственный (ID участника)"><input value={f.responsible} onChange={e => set('responsible', e.target.value)} /></FormField><label className="check-field"><input type="checkbox" checked={f.fee} onChange={e => set('fee', e.target.checked)} /> Гонорар агентства</label><FormActions onCancel={onClose} /></form></Modal>;
}
function MovementForm({
  projectId,
  agency,
  movement,
  obligations = [],
  users = [],
  categories = [],
  onClose,
  onSave
}) {
  const d = dataOf(movement);
  const [f, set] = useForm({
    type: d.type || agency ? 'income' : 'deposit',
    amount: d.amount == null ? '' : Number(d.amount) / 100,
    date: d.date || today(),
    description: d.description || '',
    source: d.source || agency ? 'direct' : 'custody',
    obligationId: d.obligationId || '',
    categoryId: d.categoryId || '',
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
          amount: Math.round(Number(f.amount) * 100)
        }
      });
      onClose();
    } catch (caught) {
      setError(caught.message || 'Не удалось сохранить движение');
    }
  };
  return <Modal title={agency ? 'Операция агентства' : movement ? 'Изменить движение' : 'Новое движение средств'} onClose={onClose}><form className="form-stack" onSubmit={submit}><FormField label="Тип"><select value={f.type} onChange={e => set('type', e.target.value)}>{types.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></FormField><div className="form-columns"><FormField label="Сумма, ₽"><input autoFocus required type="number" min="0.01" step=".01" value={f.amount} onChange={e => set('amount', e.target.value)} /></FormField><FormField label="Дата"><input required type="date" value={f.date} onChange={e => set('date', e.target.value)} /></FormField></div><FormField label="Описание"><input required value={f.description} onChange={e => set('description', e.target.value)} placeholder="Кому или за что" /></FormField>{needsObligation && <FormField label="Статья сметы"><select required value={f.obligationId} onChange={e => set('obligationId', e.target.value)}><option value="">Выберите статью</option>{obligations.map(o => <option key={o.id} value={o.id}>{dataOf(o).title}</option>)}</select></FormField>}{agency && <FormField label="Категория"><select value={f.categoryId} onChange={e => set('categoryId', e.target.value)}><option value="">Без категории</option>{categories.map(c => <option key={c.id} value={c.id}>{dataOf(c).name}</option>)}</select></FormField>}{!agency && <FormField label="Контур денег"><select value={f.source} onChange={e => set('source', e.target.value)}><option value="custody">Средства пары у организаторов</option><option value="direct">Оплата напрямую</option></select></FormField>}{needsFrom && <FormField label="Выдавший организатор"><select required value={f.from} onChange={e => set('from', e.target.value)}><option value="">Выберите участника</option>{users.map(u => <option key={u.id} value={u.id}>{dataOf(u).name || dataOf(u).email}</option>)}</select></FormField>}{needsTo && <FormField label="Получивший организатор"><select required value={f.to} onChange={e => set('to', e.target.value)}><option value="">Выберите участника</option>{users.map(u => <option key={u.id} value={u.id}>{dataOf(u).name || dataOf(u).email}</option>)}</select></FormField>}{error && <p className="form-error">{error}</p>}<FormActions onCancel={onClose} label="Сохранить движение" /></form></Modal>;
}
function Applications({
  state,
  onReview
}) {
  const apps = arr(state.applications);
  return <><PageHeader eyebrow="Заявки" title="Входящие обращения" /><section className="panel">{apps.length ? <div className="data-list">{apps.map(item => {
          const d = dataOf(item);
          return <article className="application-row" key={item.id}><div><span className={`status-badge ${d.status || 'review'}`}>{statuses[d.status] || 'На рассмотрении'}</span><h2>{d.name}</h2><p>{dateLabel(d.date)} · {d.contact}</p>{d.message && <p>{d.message}</p>}{d.reason && <p className="reason">Решение: {d.reason}</p>}</div>{['review', 'clarification'].includes(d.status || 'review') && <button className="button quiet" onClick={() => onReview(item)}>Рассмотреть</button>}</article>;
        })}</div> : <Empty title="Новых заявок нет" text="Обращения с публичной страницы появятся здесь." />}</section></>;
}
function ReviewForm({
  application,
  onClose,
  onSave
}) {
  const [f, set] = useForm({
    status: 'approved',
    reason: ''
  });
  return <Modal title="Рассмотреть заявку" onClose={onClose}><form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave(f);
      onClose();
    }}><FormField label="Решение"><select value={f.status} onChange={e => set('status', e.target.value)}><option value="approved">Одобрить и создать свадьбу</option><option value="clarification">Запросить уточнение</option><option value="rejected">Отклонить</option></select></FormField><FormField label="Причина или сообщение" hint="Причина обязательна для уточнения и отклонения."><textarea required={f.status !== 'approved'} value={f.reason} onChange={e => set('reason', e.target.value)} /></FormField><FormActions onCancel={onClose} label="Сохранить решение" /></form></Modal>;
}
function Catalog({
  state,
  projectMode,
  onVendor
}) {
  const vendors = byKind(state, 'vendor');
  return <><PageHeader eyebrow={projectMode ? 'Свадьба' : 'Агентство'} title={projectMode ? 'Подрядчики и варианты' : 'Общий каталог'} action={<button className="button" onClick={() => onVendor()}><Icon name="plus" />Подрядчик</button>} /><div className="card-list">{vendors.map(v => {
        const d = dataOf(v);
        return <article key={v.id} className="vendor-card"><div className="vendor-monogram">{(d.name || '?').slice(0, 1)}</div><div><h2>{d.name}</h2><p>{d.services || d.category || 'Услуги не указаны'}</p><small>{d.contact || 'Контакты не указаны'}</small></div><div className="vendor-price">{d.price ? money(d.price) : 'По запросу'}<button className="text-button" onClick={() => onVendor(v)}>Изменить</button></div></article>;
      })}</div>{!vendors.length && <Empty title="Каталог пока пуст" text="Добавьте подрядчика с актуальными условиями и контактами." action="Добавить подрядчика" onAction={() => onVendor()} />}</>;
}
function VendorForm({
  vendor,
  projectId,
  onClose,
  onSave
}) {
  const d = dataOf(vendor);
  const [f, set] = useForm({
    name: d.name || '',
    contact: d.contact || '',
    services: d.services || '',
    price: d.price ? Number(d.price) / 100 : '',
    terms: d.terms || '',
    notes: d.notes || ''
  });
  return <Modal title={vendor ? 'Карточка подрядчика' : 'Новый подрядчик'} onClose={onClose}><form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave({
        ...f,
        price: f.price === '' ? null : Math.round(Number(f.price) * 100)
      });
      onClose();
    }}><FormField label="Имя или название"><input autoFocus required value={f.name} onChange={e => set('name', e.target.value)} /></FormField><FormField label="Контакты"><input value={f.contact} onChange={e => set('contact', e.target.value)} /></FormField><FormField label="Услуги"><input value={f.services} onChange={e => set('services', e.target.value)} /></FormField><FormField label="Актуальная цена, ₽"><input type="number" step=".01" value={f.price} onChange={e => set('price', e.target.value)} /></FormField><FormField label="Условия"><textarea value={f.terms} onChange={e => set('terms', e.target.value)} /></FormField><FormField label="Внутренняя заметка"><textarea value={f.notes} onChange={e => set('notes', e.target.value)} /></FormField><FormActions onCancel={onClose} /></form></Modal>;
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
  return <Modal wide title={role ? 'Роль' : 'Новая роль'} onClose={onClose}><form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave(f);
      onClose();
    }}><FormField label="Название"><input autoFocus required value={f.name} onChange={e => set('name', e.target.value)} /></FormField><fieldset className="permission-grid"><legend>Разрешения</legend>{permissions.map(p => <label key={p}><input type="checkbox" checked={f.permissions.includes(p)} onChange={() => toggle(p)} />{permissionLabels[p]}</label>)}</fieldset><FormActions onCancel={onClose} /></form></Modal>;
}
function GrantForm({
  user,
  state,
  onClose,
  onSave
}) {
  const d = dataOf(user);
  const [f, set] = useForm({
    roleId: '',
    projectId: '',
    disabled: !!d.disabled,
    sections: ''
  });
  return <Modal title={`Доступ: ${d.name || d.email || 'участник'}`} onClose={onClose}><form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave({
        ...f,
        grants: f.roleId ? [{
          roleId: f.roleId,
          projectId: f.projectId || null,
          restrictions: {
            sections: f.sections.split(',').map(x => x.trim()).filter(Boolean)
          }
        }] : []
      });
      onClose();
    }}><FormField label="Роль"><select required value={f.roleId} onChange={e => set('roleId', e.target.value)}><option value="">Выберите роль</option>{arr(state.roles).map(r => <option key={r.id} value={r.id}>{dataOf(r).name}</option>)}</select></FormField><FormField label="Свадьба"><select value={f.projectId} onChange={e => set('projectId', e.target.value)}><option value="">Всё агентство</option>{arr(state.projects).map(p => <option key={p.id} value={p.id}>{dataOf(p).name}</option>)}</select></FormField><FormField label="Только разделы" hint="Через запятую. Оставьте пустым, чтобы использовать права роли полностью."><input value={f.sections} onChange={e => set('sections', e.target.value)} placeholder="timing, guests" /></FormField><label className="check-field"><input type="checkbox" checked={f.disabled} onChange={e => set('disabled', e.target.checked)} /> Отключить доступ пользователя</label><FormActions onCancel={onClose} label="Сохранить назначение" /></form></Modal>;
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
    services: arr(d.settings?.services).join('\n')
  });
  return <><PageHeader eyebrow="Агентство" title="Настройки" /><section className="settings-layout"><form className="panel form-stack" onSubmit={async e => {
        e.preventDefault();
        await onSave({
          name: f.name,
          settings: {
            tagline: f.tagline,
            description: f.description,
            contact: f.contact,
            services: f.services.split('\n').filter(Boolean),
            portfolio: d.settings?.portfolio || []
          }
        });
      }}><FormField label="Название агентства"><input required value={f.name} onChange={e => set('name', e.target.value)} /></FormField><FormField label="Фраза на публичной странице"><input value={f.tagline} onChange={e => set('tagline', e.target.value)} /></FormField><FormField label="Описание"><textarea value={f.description} onChange={e => set('description', e.target.value)} /></FormField><FormField label="Контакт"><input value={f.contact} onChange={e => set('contact', e.target.value)} /></FormField><FormField label="Услуги, по одной в строке"><textarea value={f.services} onChange={e => set('services', e.target.value)} /></FormField><div><button className="button">Сохранить настройки</button></div></form><section className="panel"><p className="eyebrow">Шаблоны</p><h2>Стартовая структура свадеб</h2><p>Изменения шаблона применяются только при создании новых проектов.</p><button className="button quiet" onClick={onTemplate}>Создать шаблон</button></section></section></>;
}
function Offline({
  project,
  status,
  onPrepare,
  onSync,
  onDiscard,
  onRetry
}) {
  return <section className="offline-card"><div><span className="offline-symbol"><Icon name="offline" /></span><div><p className="eyebrow">Офлайн</p><h2>{status?.preparedAt ? 'Проект подготовлен' : 'Подготовьте работу без сети'}</h2><p>{status?.preparedAt ? `Снимок сохранён ${new Date(status.preparedAt).toLocaleString('ru-RU')}.` : 'Сохранятся только отмеченные таблицы и допустимые изменения строк.'}</p></div></div><div className="button-group"><button className="button quiet" onClick={onPrepare}>Подготовить проект</button><button className="button" onClick={onSync}>Синхронизировать {status?.pending ? `(${status.pending})` : ''}</button></div>{arr(status?.conflicts).length > 0 && <div className="conflicts"><h3>Нужно решить конфликты</h3>{status.conflicts.map(c => <div key={c.id}><p>{c.error || 'Версия данных изменилась на сервере.'}</p><button className="text-button" onClick={() => onRetry(c.id, {})}>Повторить с актуальными данными</button><button className="text-button danger-text" onClick={() => onDiscard(c.id)}>Удалить из очереди</button></div>)}</div>}</section>;
}
function TableLibrary({
  tables,
  sections = [],
  setView,
  onSection,
  onTable
}) {
  return <><div className="table-tools"><button className="button quiet" onClick={() => onSection()}>+ Раздел</button></div>{sections.sort((a,b)=>(dataOf(a).order||0)-(dataOf(b).order||0)).map((section,index)=><section className="panel" key={section.id}><div className="panel-header"><div><p className="eyebrow">Раздел {index+1}</p><h2>{dataOf(section).name}</h2></div><div className="button-group"><button className="text-button" onClick={()=>onSection(section)}>Изменить</button><button className="text-button danger-text" onClick={()=>onSection(section,'delete')}>Архив</button></div></div><div className="card-list">{tables.filter(t=>dataOf(t).sectionId===section.id&&!dataOf(t).archived).sort((a,b)=>(dataOf(a).order||0)-(dataOf(b).order||0)).map(table=><article key={table.id} className="vendor-card"><button className="vendor-monogram" onClick={()=>setView(`project:table:${table.id}`)}>▦</button><div><h2>{dataOf(table).name}</h2><p>{arr(dataOf(table).columns).length} колонок · {dataOf(table).offline?'офлайн':'онлайн'}</p></div><div><button className="text-button" onClick={()=>onTable(table)}>Изменить</button><button className="text-button danger-text" onClick={()=>onTable(table,'delete')}>Архив</button></div></article>)}</div></section>)}</>;
}
function SectionForm({ section, onClose, onSave }) { const d=dataOf(section); const [name,setName]=useState(d.name||''); return <Modal title={section?'Раздел проекта':'Новый раздел'} onClose={onClose}><form className="form-stack" onSubmit={async e=>{e.preventDefault();await onSave({name,order:d.order||0,archived:false});onClose();}}><FormField label="Название"><input required autoFocus value={name} onChange={e=>setName(e.target.value)}/></FormField><FormActions onCancel={onClose}/></form></Modal>; }
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
  onRestore
}) {
  const [, tab = 'overview', targetTableId] = view.split(':');
  const entities = arr(state.entities);
  const tables = entities.filter(e => e.kind === 'table' && !e.deleted);
  const tableKey = tab === 'guests' ? 'guests' : tab.startsWith('timing') ? 'timing' : tab;
  const table = tab === 'table' ? tables.find(e => e.id === targetTableId) : tables.find(e => dataOf(e).key === tableKey || dataOf(e).name?.toLowerCase().includes(tab === 'timing' ? 'тайминг' : 'гост'));
  const rows = table ? entities.filter(e => e.parent_id === table.id && !e.deleted) : [];
  let content;
  if (tab === 'overview') content = <Overview state={state} onProjectEdit={onProjectEdit} openTab={key => setView(`project:${key}`)} onMovement={onMovement} />;else if (tab === 'estimate') content = <Finance state={state} onMovement={onMovement} onAddObligation={onAddObligation} onEditObligation={onEditObligation} onEditMovement={onEditMovement} onDeleteMovement={onDeleteMovement} />;else if (tab === 'catalog') content = <Catalog state={state} projectMode onVendor={onVendor} />;else if (tab === 'files') content = <Files state={state} onFile={onFile} />;else if (tab === 'history') content = <History state={state} onRestore={onRestore} />;else if (tab === 'tables') content = <><PageHeader eyebrow="Структура проекта" title="Все рабочие таблицы" action={<button className="button" onClick={onCreateTable}><Icon name="plus"/>Таблица</button>}/><TableLibrary tables={tables} sections={entities.filter(e=>e.kind==='section'&&!e.deleted)} setView={setView} onSection={onSection} onTable={(item,action)=>action==='delete'?onTable('delete',item):onTable('structure',item)}/></>;else content = <><PageHeader eyebrow="Рабочая таблица" title={dataOf(table).name || (tab === 'guests' ? 'Гости и рассадка' : 'Тайминг дня')} action={<button className="button quiet" onClick={onInvite}><Icon name="plus" />Пригласить участника</button>} /><TableWorkspace table={table} rows={rows} files={entities.filter(e=>e.kind==='file'&&!e.deleted)} audience={tab==='timing-pair'?'Пара':tab==='timing-team'?'Команда':null} canEdit onEditRow={(row, data) => onTable('edit', row, data)} onAddRow={() => onTable('add', table)} onEditTable={() => onTable('structure', table)} onDeleteRow={row => onTable('delete', row)} onReorder={rowOrder=>onTable('reorder',table,rowOrder)} /></>;
  return <>{content}<Offline project={state.project} status={offline} {...offlineActions} /></>;
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
    [view, setView] = useState('projects'),
    [modal, setModal] = useState(null),
    [notice, setNotice] = useState(null),
    [offline, setOffline] = useState(null),
    [selected, setSelected] = useState(null);
  const flash = (text, kind = 'success') => setNotice({
    text,
    kind
  });
  const refresh = useCallback(async projectId => {
    const next = await loadState(projectId);
    setState(next);
    return next;
  }, []);
  useEffect(() => {
    let off;
    (async () => {
      try {
        await initClient();
        const next = await loadState();
        setState(next);
        setMode(next?.user ? 'app' : 'public');
        off = subscribe(() => refresh(next?.project?.id).catch(() => {}));
      } catch {
        try {
          setPublicInfo(await api('/api/public?agency=tie'));
        } catch {}
        setMode('public');
      }
    })();
    return () => off?.();
  }, [refresh]);
  const run = async (body, projectId) => {
    try {
      const result = await command({
        id: crypto.randomUUID(),
        ...body
      });
      await refresh(projectId ?? body.projectId ?? state?.project?.id);
      flash(result?.queued ? 'Изменение сохранено в очередь' : 'Сохранено');
      return result;
    } catch (err) {
      flash(err.message || 'Не удалось сохранить', 'error');
      throw err;
    }
  };
  const openProject = async project => {
    try {
      await refresh(project.id);
      setSelected(project);
      setView('project:overview');
      setOffline(await getOfflineStatus(project.id));
    } catch (err) {
      flash(err.message, 'error');
    }
  };
  const openAgency = async nextView => {
    await refresh(null);
    setSelected(null);
    setView(nextView);
  };
  const authDone = async () => {
    const nextModal = modal?.next;
    setModal(null);
    const next = await refresh();
    setState(next);
    setMode('app');
    const scoped = arr(next.grants).filter(g => g.project_id || g.projectId).map(g => g.project_id || g.projectId);
    const agencyManagement = arr(next.grants).some(g => !g.project_id && !g.projectId);
    if (scoped.length === 1 && !agencyManagement) {
      const project = arr(next.projects).find(p => p.id === scoped[0]);
      if (project) await openProject(project);
    }
    if (nextModal === 'application') setModal({
      type: 'application'
    });
  };
  if (mode === 'loading') return <div className="loading"><Mark /><span>Открываем tie</span></div>;
  if (mode === 'public') return <><PublicHome info={publicInfo} onAuth={type => setModal({
      type: 'auth',
      mode: type === 'register' && publicInfo?.setup ? 'setup' : type
    })} onApplication={() => setModal({
      type: 'auth',
      mode: publicInfo?.setup ? 'setup' : 'register',
      next: 'application'
    })} />{modal?.type === 'auth' && <AuthDialog mode={modal.mode} onClose={() => setModal(null)} onAuth={authDone} />} {modal?.type === 'application' && <ApplicationDialog onClose={() => setModal(null)} />}<Notice notice={notice} onDismiss={() => setNotice(null)} /></>;
  const projectId = state?.project?.id;
  const workspace = view.startsWith('project:');
  const saveProject = async values => {
    if (selected || state.project) await run({
      op: 'entity.edit',
      projectId: (selected || state.project).id,
      entityId: (selected || state.project).id,
      version: (selected || state.project).version,
      data: values
    }, (selected || state.project).id);else await run({
      op: 'project.create',
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
    version: item.entity_version,
    auditId: item.id
  }, projectId);
  const renderMain = () => {
    if (workspace) return <Workspace state={state} view={view} setView={setView} onProjectEdit={() => setModal({
      type: 'project',
      project: state.project
    })} onMovement={() => setModal({
      type: 'movement',
      agency: false
    })} onAddObligation={() => setModal({
      type: 'obligation'
    })} onEditObligation={item => setModal({
      type: 'obligation',
      item
    })} onTable={tableAction} onVendor={item => setModal({
      type: 'vendor',
      item,
      project: true
    })} onEditMovement={item=>setModal({type:'movement',agency:false,item})} onDeleteMovement={item=>setModal({type:'confirmMovementDelete',item})} onCreateTable={()=>setModal({type:'table',create:true})} onSection={(item,action)=>action==='delete'?setModal({type:'confirmSectionDelete',item}):setModal({type:'section',item})} onRestore={restore} offline={offline} offlineActions={{
      onPrepare: async () => {
        await prepareProject(projectId);
        setOffline(await getOfflineStatus(projectId));
        flash('Проект подготовлен для работы без сети');
      },
      onSync: async () => {
        await syncQueue();
        setOffline(await getOfflineStatus(projectId));
        await refresh(projectId);
        flash('Очередь синхронизирована');
      },
      onDiscard: async id => {
        await discardCommand(id);
        setOffline(await getOfflineStatus(projectId));
      },
      onRetry: async (id, replacements) => {
        await retryCommand(id, replacements);
        setOffline(await getOfflineStatus(projectId));
      }
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
    if (view === 'applications') return <Applications state={state} onReview={item => setModal({
      type: 'review',
      item
    })} />;
    if (view === 'catalog') return <Catalog state={state} onVendor={item => setModal({
      type: 'vendor',
      item
    })} />;
    if (view === 'agency') return <Finance state={state} agency onMovement={() => setModal({
      type: 'movement',
      agency: true
    })} onEditMovement={item=>setModal({type:'movement',agency:true,item})} onDeleteMovement={item=>setModal({type:'confirmMovementDelete',item})}/>;
    if (view === 'access') return <Roles state={state} onRole={item => setModal({
      type: 'role',
      item
    })} onGrant={item => setModal({
      type: 'grant',
      item
    })} />;
    if (view === 'settings') return <Settings state={state} onSave={values => run({
      op: 'settings.save',
      version: state.agency?.version,
      ...values
    })} onTemplate={() => setModal({
      type: 'template'
    })} />;
    return null;
  };
  return <><AppShell state={state} view={view} setView={nextView => view.startsWith('project:') && !nextView.startsWith('project:') ? openAgency(nextView) : setView(nextView)} selectedProject={selected} onProject={openProject} onMenu={() => {}} onLogout={async () => {
      await logout();
      setState(null);
      setMode('public');
      setView('projects');
    }}>{renderMain()}</AppShell><Notice notice={notice} onDismiss={() => setNotice(null)} />{modal?.type === 'project' && <ProjectForm project={modal.project} onClose={() => setModal(null)} onSave={saveProject} />} {modal?.type === 'obligation' && <ObligationForm obligation={modal.item} onClose={() => setModal(null)} onSave={data => run(modal.item ? {
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
    }, projectId)} />} {modal?.type === 'movement' && <MovementForm projectId={modal.agency ? null : projectId} agency={modal.agency} movement={modal.item} obligations={byKind(state,'obligation')} users={arr(state.custodians||state.members||state.users)} categories={byKind(state,'category')} onClose={() => setModal(null)} onSave={({projectId: dataProjectId,data}) => run({op:'movement.save',projectId:dataProjectId,entityId:modal.item?.id,version:modal.item?.version,obligationVersion:data.obligationId?byKind(state,'obligation').find(o=>o.id===data.obligationId)?.version:undefined,data},dataProjectId)} />} {modal?.type === 'review' && <ReviewForm application={modal.item} onClose={() => setModal(null)} onSave={f => run({
      op: 'application.review',
      entityId: modal.item.id,
      version: modal.item.version,
      ...f
    })} />} {modal?.type === 'vendor' && <VendorForm vendor={modal.item} onClose={() => setModal(null)} onSave={data => run(modal.item ? {
      op: 'entity.edit',
      projectId: modal.project ? projectId : null,
      entityId: modal.item.id,
      version: modal.item.version,
      data
    } : {
      op: 'entity.create',
      projectId: modal.project ? projectId : null,
      kind: 'vendor',
      data
    }, modal.project ? projectId : null)} />} {modal?.type === 'role' && <RoleForm role={modal.item} onClose={() => setModal(null)} onSave={f => run({
      op: 'role.save',
      roleId: modal.item?.id,
      version: modal.item?.version,
      ...f
    })} />} {modal?.type === 'grant' && <GrantForm user={modal.item} state={state} onClose={() => setModal(null)} onSave={f => run({
      op: 'grants.save',
      userId: modal.item?.id,
      version: modal.item?.version,
      ...f
    })} />} {modal?.type === 'invite' && <InviteForm state={state} projectId={projectId} onClose={() => setModal(null)} onSave={f => run({
      op: 'invite.create',
      projectId,
      ...f
    }, projectId)} />} {modal?.type === 'section' && <SectionForm section={modal.item} onClose={()=>setModal(null)} onSave={data=>run(modal.item ? {op:'entity.edit',projectId,entityId:modal.item.id,version:modal.item.version,data:{...data,...dataOf(modal.item)}} : {op:'entity.create',projectId,kind:'section',data:{...data,order:entities.filter(e=>e.kind==='section').length}},projectId)}/>} {modal?.type === 'confirmSectionDelete' && <ConfirmDialog title="Архивировать раздел?" danger confirm="Архивировать" onClose={()=>setModal(null)} onConfirm={async()=>{await run({op:'entity.delete',projectId,entityId:modal.item.id,version:modal.item.version,confirm:true},projectId);setModal(null)}}><p>Связанные таблицы будут сохранены в истории и доступны для восстановления.</p></ConfirmDialog>} {modal?.type === 'table' && <TableForm table={modal.table} sections={entities.filter(e => e.kind === 'section' && !e.deleted)} onClose={() => setModal(null)} onSave={data => run(modal.create ? { op: 'entity.create', projectId, kind: 'table', data: {...data, columns:data.columns.length ? data.columns : [{id:'title',name:'Название',type:'text'}]} } : {op: 'entity.edit', projectId, entityId: modal.table.id, version: modal.table.version, data}, projectId)} />} {modal?.type === 'template' && <TemplateForm onClose={() => setModal(null)} onSave={data => run({
      op: 'entity.create',
      kind: 'template',
      data
    })} />} {modal?.type === 'confirmDelete' && <ConfirmDialog title="Удалить запись?" danger confirm="Удалить" onClose={() => setModal(null)} onConfirm={async () => {
      await run({
        op: 'entity.delete',
        projectId,
        entityId: modal.item.id,
        version: modal.item.version,
        confirm: true
      }, projectId);
      setModal(null);
    }}><p>Запись будет скрыта, а её историю можно восстановить из журнала.</p></ConfirmDialog>}</>;
}
function InviteForm({
  state,
  projectId,
  onClose,
  onSave
}) {
  const [f, set] = useForm({
    email: '',
    roleId: '',
    sections: ''
  });
  return <Modal title="Пригласить участника" onClose={onClose}><form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave({
        email: f.email,
        roleId: f.roleId,
        restrictions: {
          sections: f.sections.split(',').map(x => x.trim()).filter(Boolean)
        }
      });
      onClose();
    }}><FormField label="Почта"><input required autoFocus type="email" value={f.email} onChange={e => set('email', e.target.value)} /></FormField><FormField label="Роль"><select value={f.roleId} onChange={e => set('roleId', e.target.value)}><option value="">Участник пары</option>{arr(state.inviteRoles || state.roles).map(r => <option key={r.id} value={r.id}>{dataOf(r).name}</option>)}</select></FormField><FormActions onCancel={onClose} label="Создать приглашение" /></form></Modal>;
}
function TableForm({
  table,
  sections = [],
  onClose,
  onSave
}) {
  const d = dataOf(table);
  const [f, set] = useForm({
    name: d.name || '',
    key: d.key || '',
    offline: !!d.offline,
    sectionId: d.sectionId || sections[0]?.id || '',
    columns: arr(d.columns).map(c => ({
      ...c
    }))
  });
  const changeColumn = (i, key, value) => set('columns', f.columns.map((c, n) => n === i ? {
    ...c,
    [key]: value
  } : c));
  return <Modal wide title="Таблица и колонки" onClose={onClose}><form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave(f);
      onClose();
    }}><div className="form-columns"><FormField label="Название"><input required value={f.name} onChange={e => set('name', e.target.value)} /></FormField><FormField label="Ключ таблицы"><input required value={f.key} onChange={e => set('key', e.target.value)} /></FormField></div><label className="check-field"><input type="checkbox" checked={f.offline} onChange={e => set('offline', e.target.checked)} /> Разрешить редактирование строк офлайн</label><fieldset className="column-editor"><legend>Колонки</legend>{f.columns.map((c, i) => <div key={c.id || i}><input required value={c.name} onChange={e => changeColumn(i, 'name', e.target.value)} placeholder="Название" /><select value={c.type} onChange={e => changeColumn(i, 'type', e.target.value)}>{Object.entries({
              text: 'Текст',
              number: 'Число',
              money: 'Деньги',
              date: 'Дата',
              time: 'Время',
              boolean: 'Флажок',
              select: 'Варианты',
              url: 'Ссылка',
              formula: 'Вычисление',
              relation: 'Связь со строкой',
              file: 'Файл'
            }).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>{c.type === 'select' && <input value={(c.options || []).join(', ')} onChange={e => changeColumn(i, 'options', e.target.value.split(',').map(x => x.trim()).filter(Boolean))} placeholder="Варианты через запятую" />}{c.type === 'formula' && <input value={c.formula || ''} onChange={e => changeColumn(i, 'formula', e.target.value)} placeholder="{price} * {count}" />}<button type="button" className="icon-button" onClick={() => set('columns', f.columns.filter((_, n) => n !== i))} aria-label="Удалить колонку">×</button></div>)}<button type="button" className="text-button" onClick={() => set('columns', [...f.columns, {
          id: crypto.randomUUID(),
          name: 'Новая колонка',
          type: 'text'
        }])}><Icon name="plus" />Колонка</button></fieldset><FormActions onCancel={onClose} /></form></Modal>;
}
function TemplateForm({
  onClose,
  onSave
}) {
  const [f, set] = useForm({
    name: '',
    description: ''
  });
  return <Modal title="Новый шаблон" onClose={onClose}><form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      await onSave(f);
      onClose();
    }}><FormField label="Название"><input autoFocus required value={f.name} onChange={e => set('name', e.target.value)} /></FormField><FormField label="Для каких свадеб"><textarea value={f.description} onChange={e => set('description', e.target.value)} /></FormField><FormActions onCancel={onClose} label="Создать шаблон" /></form></Modal>;
}
createRoot(document.getElementById('root')).render(<App />);

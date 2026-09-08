import { useState } from 'react';
import { Mark, Icon } from './Mark.jsx';

const projectItems = [
  ['overview', 'Обзор'], ['estimate', 'Смета и выплаты'], ['catalog', 'Подрядчики'], ['timing', 'Тайминг'], ['guests', 'Гости и рассадка'], ['tables', 'Все таблицы'], ['files', 'Файлы'], ['history', 'История']
];
const agencyItems = [
  ['projects', 'Свадьбы'], ['applications', 'Заявки'], ['catalog', 'Каталог'], ['agency', 'Бюджет агентства'], ['access', 'Доступ и роли'], ['settings', 'Настройки']
];

export function AppShell({ state, view, setView, selectedProject, onProject, onLogout, onMenu, children }) {
  const [menuOpen,setMenuOpen]=useState(false);
  const user = state?.user || {};
  const isProject = view.startsWith('project:');
  const items = isProject ? projectItems : agencyItems;
  const projects = state?.projects || [];
  const selected = selectedProject || state?.project;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-top"><button className="brand brand-button" onClick={() => setView('projects')}><Mark compact/><span>{state?.agency?.name || 'tie'}</span></button><button className="mobile-menu icon-button" onClick={() => {setMenuOpen(v=>!v);onMenu?.();}}><Icon name="menu"/></button></div>
      <div className="identity"><div className="avatar">{(user.name || user.email || '?').slice(0, 1).toUpperCase()}</div><div><strong>{user.name || user.email || 'Участник'}</strong><small>{state?.agency?.name || 'Свадебное пространство'}</small></div></div>
      {isProject && <button className="project-switch" onClick={() => setView('projects')}><span>Свадьба</span><strong>{selected?.data?.name || selected?.name || 'Проект'}</strong><Icon name="arrow"/></button>}
      <nav className={menuOpen?'mobile-open':''} aria-label="Основная навигация">{items.map(([id, label]) => <button key={id} className={view === id || view === `project:${id}` ? 'active' : ''} onClick={() => {setView(isProject ? `project:${id}` : id);setMenuOpen(false);}}><Icon name={id}/><span>{label}</span></button>)}</nav>
      {!isProject && projects.length > 0 && <div className="sidebar-projects"><small>Быстрый переход</small>{projects.slice(0, 4).map(project => <button key={project.id} onClick={() => onProject(project)}><span className="project-dot"/><span>{project.data?.name || project.name}</span></button>)}</div>}
      <div className="sidebar-bottom"><button onClick={onLogout}><Icon name="logout"/>Выйти</button></div>
    </aside>
    <main className="workspace">{children}</main>
  </div>;
}

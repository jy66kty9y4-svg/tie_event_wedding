export const weddingSections = [
  ['estimate', 'Смета', 'budget'],
  ['venue', 'Площадка', 'vendors'],
  ['timing-pair', 'Тайминг', 'timing'],
  ['catalog', 'Подрядчики', 'vendors'],
  ['files', 'Документы', 'files'],
  ['guests', 'Гости', 'guest'],
  ['seating', 'Рассадка', 'seating'],
  ['tasks', 'План', 'tasks'],
  ['calendar', 'Календарь', 'calendar'],
  ['more', 'Ещё', 'more']
];

export function weddingSectionAllowed(state, section, projectId = state?.project?.id) {
  return !!state?.user?.protected || (state?.grants || []).some(grant =>
    (grant.project_id === null || grant.project_id === projectId) &&
    grant.permissions?.includes('read') &&
    (!grant.restrictions?.sections?.length || grant.restrictions.sections.includes(section))
  );
}

export function weddingSpace(state, preferred = 'organizer') {
  const grants = state?.grants || [];
  if (state?.user?.protected || grants.some(g => g.project_id === null && g.role_key === 'admin')) return preferred;
  if (grants.some(g => g.project_id === null && g.permissions?.includes('projects'))) return 'organizer';
  return grants.some(g => g.role_key === 'contractor') && !grants.some(g => g.role_key === 'couple') ? 'contractor' : 'couple';
}

export function profileProjectId(state, preferredProjectId, preferredSpace='organizer') {
  if(weddingSpace(state,preferredSpace)==='organizer')return null;
  const projects=state?.projects||[];
  return projects.find(project=>project.id===preferredProjectId)?.id||(projects.length===1?projects[0].id:null);
}

export function weddingSectionIcon(section) {
  if(section.startsWith('timing'))return 'timing';
  return ({estimate:'agency',venue:'projects',tables:'table'})[section]||section;
}

export function visibleWeddingSections(state, space, projectId = state?.project?.id) {
  const sections = space === 'contractor'
    ? [['tasks', 'План', 'tasks'], ['files', 'Документы', 'files'], ['calendar', 'Календарь', 'calendar'], ['more', 'Ещё', 'more']]
    : weddingSections;
  return sections.filter(([, , section]) => {
    if (section === 'more') return true;
    if (section === 'guest' || section === 'timing') return (state?.entities || []).some(item => item.kind === 'table' && !item.deleted && item.data?.key === (section === 'guest' ? 'guests' : 'timing'));
    return weddingSectionAllowed(state, section, projectId);
  });
}

export function defaultWeddingView(state, preferred) {
  const space = weddingSpace(state, preferred);
  return 'project:' + (visibleWeddingSections(state, space)[0]?.[0] || 'more');
}

export function normalizeWeddingView(view, state, preferred) {
  const space=weddingSpace(state,preferred);
  if(view.split(':').slice(0,2).join(':')==='project:timing-team'&&space!=='organizer')return space==='couple'?'project:timing-pair':defaultWeddingView(state,preferred);
  if(view.split(':').slice(0,2).join(':')==='project:site'&&state?.project?.data?.personalInvitationsEnabled!==true)return 'project:more';
  return view === 'project:overview' ? defaultWeddingView(state, preferred) : view;
}

export function activeWeddingSection(view, space) {
  const key = view.split(':')[1];
  if (key === 'payouts') return 'estimate';
  if (key === 'timing-team' && space !== 'contractor') return 'timing-pair';
  return ['approvals', 'site', 'tables', 'table', 'history', 'members', 'offline', 'settings'].includes(key) ? 'more' : key;
}

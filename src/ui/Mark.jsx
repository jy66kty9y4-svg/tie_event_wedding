export function Mark({ compact = false }) {
  return <span className={`mark ${compact ? 'compact' : ''}`} aria-label="tie"><i/><b/></span>;
}

export function Icon({ name }) {
  const icons = {today:'⌂',tasks:'☑',approvals:'✓',calendar:'▦',notifications:'♧',profile:'◎',seating:'⊞',site:'◇',more:'⋯',content:'▤',templates:'▧',members:'◎', overview:'⌂', projects:'◇', estimate:'₽', timing:'◷', guests:'♧', files:'⌁', history:'↺', applications:'✦', catalog:'⌘', agency:'◐', access:'◎', settings:'⚙', logout:'↗', plus:'+', offline:'◌', search:'⌕', arrow:'→', menu:'☰' };
  return <span aria-hidden="true" className="icon">{icons[name] || '·'}</span>;
}

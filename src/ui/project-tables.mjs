/** Prefer an explicit table key; legacy names are only a fallback. */
export function findProjectTable(tables, tab, targetTableId) {
  if (tab === 'table') return tables.find(table => table.id === targetTableId);
  const key = tab.startsWith('timing') ? 'timing' : tab;
  const exact = tables.find(table => (table.data || table).key === key);
  if (exact) return exact;
  const pattern = key === 'timing' ? /тайминг/i : key === 'guests' ? /гост/i : null;
  return pattern ? tables.find(table => {
    const data = table.data || table;
    return !data.key && pattern.test(data.name || '');
  }) : undefined;
}

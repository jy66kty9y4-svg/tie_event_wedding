import { useMemo, useState } from 'react';
import { cents, compute, fieldTypes, money } from '../shared.js';
import { Icon } from './Mark.jsx';

function inputFor(column, value, onChange) {
  if (column.type === 'boolean') return <input type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)}/>;
  if (column.type === 'select') return <select value={value || ''} onChange={event => onChange(event.target.value)}><option value="">—</option>{(column.options || []).map(option => <option key={option} value={option}>{option}</option>)}</select>;
  const type = column.type === 'money' || column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : column.type === 'time' ? 'time' : column.type === 'url' ? 'url' : 'text';
  return <input type={type} value={value ?? ''} step={column.type === 'money' ? '0.01' : undefined} onChange={event => onChange(event.target.value)}/>;
}

export function TableWorkspace({ table, rows = [], canEdit, onEditRow, onAddRow, onEditTable, onDeleteRow }) {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const columns = table?.data?.columns || table?.columns || [];
  const data = table?.data || table || {};
  const shown = useMemo(() => rows.filter(row => JSON.stringify(row.data || {}).toLowerCase().includes(filter.toLowerCase())), [rows, filter]);
  if (!table) return <section className="empty-panel"><h2>Эта таблица ещё не создана</h2><p>Добавьте таблицу или восстановите её из шаблона проекта.</p>{canEdit && <button className="button" onClick={onEditTable}>Настроить структуру</button>}</section>;
  const begin = row => { setDraft({ ...(row.data || {}) }); setEditing(row.id); };
  const normalize = (column, value) => {
    if (value === '') return null;
    if (column.type === 'money') return cents(value);
    if (column.type === 'number') return Number(value);
    return value;
  };
  const save = row => {
    try { const next = Object.fromEntries(columns.filter(c => c.type !== 'formula').map(c => [c.id, normalize(c, draft[c.id]) ])); onEditRow(row, next); setEditing(null); }
    catch (error) { window.alert(error.message); }
  };
  return <section className="table-workspace"><div className="table-tools"><label className="search"><Icon name="search"/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Найти в таблице"/></label><div>{canEdit && <button className="button quiet" onClick={onEditTable}>Колонки и вид</button>}{canEdit && <button className="button" onClick={onAddRow}><Icon name="plus"/>Строка</button>}</div></div>
    <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column.id}>{column.name}<small>{fieldTypes[column.type] || column.type}</small></th>)}{canEdit && <th aria-label="Действия"/>}</tr></thead><tbody>{shown.map(row => <tr key={row.id}>{columns.map(column => { const val = row.data?.[column.id]; const computed = column.type === 'formula' ? compute(column.formula || '', row.data || {}) : val; const editValue = column.type === 'money' && draft[column.id] != null ? String(draft[column.id] / 100) : draft[column.id]; return <td key={column.id} data-label={column.name}>{editing === row.id && column.type !== 'formula' ? inputFor(column, editValue, v => setDraft(current => ({ ...current, [column.id]: v }))) : column.type === 'money' && val !== '' && val != null ? money(Number(val)) : column.type === 'formula' ? String(computed ?? '—') : column.type === 'boolean' ? (val ? 'Да' : '—') : val ?? '—'}</td>; })}{canEdit && <td className="row-actions">{editing === row.id ? <button className="text-button" onClick={() => save(row)}>Сохранить</button> : <button className="text-button" onClick={() => begin(row)}>Изменить</button>}<button className="text-button danger-text" onClick={() => onDeleteRow(row)}>Удалить</button></td>}</tr>)}</tbody></table></div>
    {!shown.length && <div className="table-empty">Нет строк по этому запросу{canEdit && <button className="text-button" onClick={onAddRow}>Добавить первую</button>}</div>}
    {data.offline && <p className="offline-hint"><Icon name="offline"/>Эта таблица доступна после подготовки офлайн-проекта.</p>}
  </section>;
}

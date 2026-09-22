import { useMemo } from 'react';
import './timing.css';

const allowsAudience = (row, audience) => !audience || !row?.data?.audience || row.data.audience === 'Общее' || row.data.audience === audience;

const ordered = (rows, order) => {
  const position = new Map((Array.isArray(order) ? order : []).map((id, index) => [id, index]));
  return [...rows].sort((left, right) => (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(right.id) ?? Number.MAX_SAFE_INTEGER));
};

const textValue = (value, column, members) => {
  if (column?.type === 'users' && Array.isArray(value)) return value.filter(Boolean).map(id => members.find(member => member.id === id)?.name || id).join(', ');
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') return value.name || value.label || value.title || '';
  return value == null ? '' : String(value);
};

const fieldValue = (row, columns, ids, pattern, members = []) => {
  const column = columns.find(item => ids.includes(item.id)) || columns.find(item => pattern.test(item.name || ''));
  return column ? textValue(row.data?.[column.id], column, members) : '';
};

const minutes = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
};

const timeRange = (start, end) => [start, end].filter(Boolean).join(' — ') || 'Время уточняется';

const dayLabel = (value) => {
  const offset = Number(value);
  if (!Number.isFinite(offset) || String(value).trim() === '' || offset === 0) return '';
  return offset < 0 ? `За ${Math.abs(offset)} дн.` : `Через ${offset} дн.`;
};

const dayRank = (date, offset) => {
  const normalizedDate = String(date || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (normalizedDate) return { kind: 0, value: normalizedDate };
  const numericOffset = Number(offset);
  return Number.isFinite(numericOffset) && String(offset).trim() !== '' ? { kind: 1, value: numericOffset } : { kind: 2, value: 0 };
};

/**
 * A read-only visual layer over a timing table. Editing stays in the parent's
 * existing table editor so custom columns and permissions remain unchanged.
 */
export function TimingView({ table, rows = [], audience, members = [], canCreate, onAddRow, onEditRow, canEditRow = () => false, onExport }) {
  const data = table?.data || table || {};
  const columns = data.columns || [];
  const entries = useMemo(() => ordered(rows, data.rowOrder)
    .filter(row => allowsAudience(row, audience))
    .map((row, index) => {
      const start = fieldValue(row, columns, ['startTime', 'start', 'time'], /начал|время/i);
      const end = fieldValue(row, columns, ['endTime', 'end'], /оконч|конец/i);
      const dayOffset = fieldValue(row, columns, ['dayOffset', 'day'], /день/i);
      const date = fieldValue(row, columns, ['date', 'eventDate'], /дата/i);
      return {
        row,
        index,
        start,
        end,
        day: dayLabel(dayOffset),
        dayRank: dayRank(date, dayOffset),
        title: fieldValue(row, columns, ['title', 'name', 'event'], /название|событ|этап|пункт/i),
        place: fieldValue(row, columns, ['place', 'location', 'venue'], /мест|локац|площад/i),
        responsible: fieldValue(row, columns, ['responsible', 'assignedUserIds', 'assignee'], /ответствен|участник|исполнитель/i, members),
      };
    })
    .sort((left, right) => left.dayRank.kind - right.dayRank.kind || (left.dayRank.value < right.dayRank.value ? -1 : left.dayRank.value > right.dayRank.value ? 1 : 0) || minutes(left.start) - minutes(right.start) || left.index - right.index), [rows, data.rowOrder, columns, audience, members]);

  if (!table) return <section className="timing-view timing-view--empty"><h2>Программа ещё не создана</h2><p>Создайте рабочую таблицу, чтобы собрать события дня в одну линию времени.</p></section>;

  return <section className="timing-view" aria-label="Программа дня">
    <header className="timing-view__header">
      <div>
        
        <h2>Программа дня</h2>
        <p className="timing-view__intro">{audience ? `Общие пункты и программа для: ${audience}.` : 'Пункты из рабочей таблицы в порядке дня.'}</p>
      </div>
      <div className="timing-view__tools">
        <span className="timing-view__count">{entries.length} {entries.length === 1 ? 'пункт' : entries.length > 1 && entries.length < 5 ? 'пункта' : 'пунктов'}</span>
        {onExport && <button type="button" className="button quiet" onClick={onExport}>Скачать Excel</button>}
        {canCreate && <button type="button" className="button timing-view__add" onClick={() => onAddRow?.()}>Добавить пункт</button>}
      </div>
    </header>

    {entries.length ? <ol className="timing-view__timeline">
      {entries.map(entry => {
        const editable = Boolean(canEditRow(entry.row));
        const content = <>
          <p className="timing-view__time">{timeRange(entry.start, entry.end)}</p>
          <span className="timing-view__dot" aria-hidden="true"/>
          <div className="timing-view__card">
            <div className="timing-view__card-top">
              {entry.day && <span className="timing-view__day">{entry.day}</span>}
              <h3>{entry.title || 'Без названия'}</h3>
            </div>
            {(entry.place || entry.responsible) && <dl className="timing-view__meta">
              {entry.place && <div><dt>Место</dt><dd>{entry.place}</dd></div>}
              {entry.responsible && <div><dt>Ответственный</dt><dd>{entry.responsible}</dd></div>}
            </dl>}
            {editable && <span className="timing-view__edit">Открыть в таблице</span>}
          </div>
        </>;
        return <li key={entry.row.id} className={`timing-view__entry${editable ? ' is-editable' : ''}`}>
          {editable ? <button type="button" className="timing-view__row" onClick={() => onEditRow?.(entry.row)}>{content}</button> : <article className="timing-view__row">{content}</article>}
        </li>;
      })}
    </ol> : <div className="timing-view__blank"><h3>В программе пока нет пунктов</h3><p>Добавьте первый пункт, и он появится на временной линии.</p>{canCreate && <button type="button" className="button" onClick={() => onAddRow?.()}>Добавить пункт</button>}</div>}
  </section>;
}

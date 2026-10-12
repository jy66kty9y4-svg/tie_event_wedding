import {cents} from './shared.js';

export const GUEST_ACTIONS_COLUMN='@guest-actions';

export const parseListOptions = value => [...new Set(String(value ?? '').split(',').map(item => item.trim()).filter(Boolean))];
export const sheetNumber = value => value == null || value === '' ? '' : new Intl.NumberFormat('ru-RU', {maximumFractionDigits:10}).format(value).replace(/[\u00a0\u202f]/g,' ');
export function sheetValue(column, value) {
  if (value === '' || value == null) return null;
  if (column.type === 'money') return cents(value);
  if (column.type === 'number') {
    const number = Number(String(value).replace(/\s/g,'').replace(',','.'));
    if (!Number.isFinite(number)) throw new Error('Введите число');
    return number;
  }
  return value;
}
export function normalizeSheetLayout(layout = {}, columnIds = [], rowIds = []) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw new Error('Проверьте размеры таблицы');
  const result = {};
  for (const [axis, ids, min, max] of [['columnWidths',columnIds,80,800],['rowHeights',rowIds,32,500]]) {
    const values = layout[axis] || {};
    if (typeof values !== 'object' || Array.isArray(values)) throw new Error('Проверьте размеры таблицы');
    const allowed = new Set(ids.map(String));
    result[axis] = Object.fromEntries(Object.entries(values).map(([id,value]) => {
      if (!allowed.has(id) || !Number.isInteger(value) || value < min || value > max) throw new Error('Недопустимый размер строки или колонки');
      return [id,value];
    }));
  }
  return result;
}

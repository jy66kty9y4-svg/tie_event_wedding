// Date/period interactions adapted from Finance app/finance-dashboard.tsx.
// New money conversion preserves integer kopecks and rejects implicit rounding.
export function cents(value) {
  const text = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) throw new Error('Введите сумму с точностью до копейки');
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export const money = v => v === null || v === undefined ? 'Не определено' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(v / 100);
export const dateLabel = v => v ? new Date(`${v}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Дата не выбрана';
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
export const permissions = ['read','create','edit','delete','structure','finance','files','history','invite','projects','applications','catalog','agencyFinance','templates','access','settings','publishWeddingSite','manageGuestInvites','publishAgencySite','viewTeamAvailability'];
export const permissionLabels = { read:'Просмотр',create:'Создание',edit:'Редактирование',delete:'Удаление',structure:'Структура таблиц',finance:'Финансы свадьбы',files:'Файлы',history:'История и восстановление',invite:'Приглашения',projects:'Создание проектов',applications:'Рассмотрение заявок',catalog:'Общий каталог',agencyFinance:'Бюджет агентства',templates:'Шаблоны',access:'Права доступа',settings:'Настройки агентства',publishWeddingSite:'Публикация сайта свадьбы',manageGuestInvites:'Гостевые приглашения',publishAgencySite:'Публикация сайта агентства',viewTeamAvailability:'Занятость команды' };
export const projectPermissions = ['read','create','edit','delete','structure','finance','files','history','publishWeddingSite','manageGuestInvites'];
export const fieldTypes = { text:'Текст',number:'Число',money:'Деньги',date:'Дата',time:'Время',boolean:'Флажок',select:'Варианты',url:'Ссылка',file:'Файл',relation:'Связь',users:'Участники проекта',formula:'Вычисление' };
export const movementLabels = { deposit:'Получено от пары',payment:'Выплата подрядчику',refund:'Возврат паре',transfer:'Передача организатору',fee:'Оплата гонорара',income:'Доход агентства',expense:'Расход агентства' };
export const statuses = { review:'На рассмотрении',clarification:'Нужно уточнение',approved:'Одобрена',rejected:'Отклонена',planning:'Подготовка',confirmed:'Всё согласовано',completed:'Завершена',archived:'Архив' };
// Restricted expression language: arithmetic over stable column IDs, no code execution.
export function compute(formula, values) {
  const tokens = String(formula).match(/\{[a-zA-Z0-9_-]+\}|\d+(?:\.\d+)?|[()+*/-]/g) || [];
  if (tokens.join('') !== String(formula).replace(/\s/g,'')) throw new Error('Разрешены числа, {ID колонки}, + − * / и скобки');
  let i = 0;
  function atom() {
    let t = tokens[i++];
    if (t === '(') { const v = expr(); if (tokens[i++] !== ')') throw new Error('Скобки'); return v; }
    if (t === '-') { const v = atom(); return v === null ? null : -v; }
    if (t?.startsWith('{')) { const v = values[t.slice(1,-1)]; return v === '' || v == null ? null : typeof v === 'number' ? v : null; }
    if (!t || !/^\d/.test(t)) throw new Error('Выражение'); return Number(t);
  }
  function term() { let v = atom(); while (['*','/'].includes(tokens[i])) { const op = tokens[i++], r = atom(); v = v === null || r === null || op === '/' && r === 0 ? null : op === '*' ? v*r : v/r; } return v; }
  function expr() { let v = term(); while (['+','-'].includes(tokens[i])) { const op = tokens[i++], r = term(); v = v === null || r === null ? null : op === '+' ? v+r : v-r; } return v; }
  const v = expr(); if (i !== tokens.length || v !== null && !Number.isFinite(v)) throw new Error('Выражение'); return v;
}

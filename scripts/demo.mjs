import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { openDatabase, uid, insert } from '../server/db.mjs';
import { passwordHash, grant } from '../server/auth.mjs';
import { bootstrap, execute, snapshot } from '../server/service.mjs';

process.umask(0o077);
const dbPath = resolve(process.env.TIE_DEMO_DB || 'data/demo.sqlite');
const credentialsPath = resolve(process.env.TIE_DEMO_CREDENTIALS || 'data/demo-credentials.txt');
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
const db = openDatabase(dbPath);

if (db.prepare('SELECT id FROM agencies LIMIT 1').get()) {
  console.log(`Demo database already exists: ${dbPath}`);
  console.log(`Credentials: ${credentialsPath}`);
  db.close();
  process.exit(0);
}

const password = () => `Tie-${randomBytes(12).toString('base64url')}!`;
const credentials = {
  admin: { email: 'alina@tie.test', password: password(), name: 'Алина Ветрова' },
  couple: { email: 'mira@tie.test', password: password(), name: 'Мира Соколова' },
  coordinator: { email: 'lev@tie.test', password: password(), name: 'Лев Арсеньев' },
};
const setup = bootstrap(db, { slug: 'tie', agencyName: 'tie — свадебное агентство', name: credentials.admin.name, email: credentials.admin.email, password: credentials.admin.password });
const admin = db.prepare('SELECT * FROM users WHERE id=?').get(setup.user.id);
const roles = Object.fromEntries(db.prepare('SELECT id,name FROM roles WHERE agency_id=?').all(admin.agency_id).map(row => [row.name, row.id]));

function addUser(entry, roleName) {
  const user = { id: uid(), agency_id: admin.agency_id, email: entry.email, name: entry.name };
  db.prepare('INSERT INTO users(id,agency_id,email,name,password) VALUES(?,?,?,?,?)').run(user.id, user.agency_id, user.email, user.name, passwordHash(entry.password));
  user.roleId = roles[roleName];
  return user;
}
const couple = addUser(credentials.couple, 'Участник пары');
const coordinator = addUser(credentials.coordinator, 'Координатор');
const cmd = (op, body = {}) => execute(db, admin, { id: randomUUID(), op, ...body });
const wedding = cmd('project.create', { data: { name: 'Мира и Ян', date: '2027-06-19', location: 'Усадьба «Белые липы»', limit: 420000000 } });
const intimate = cmd('project.create', { data: { name: 'Лея и Марк', date: '2027-08-07', location: 'Дом у озера', limit: 180000000 } });
grant(db, couple, couple.roleId, wedding.id);
grant(db, coordinator, coordinator.roleId, wedding.id);
grant(db, coordinator, coordinator.roleId, intimate.id);

function fillProject(project, events, guests) {
  const state = snapshot(db, admin, project.id);
  const timing = state.entities.find(row => row.kind === 'table' && row.data.key === 'timing');
  const guestTable = state.entities.find(row => row.kind === 'table' && row.data.key === 'guests');
  for (const data of events) cmd('entity.create', { projectId: project.id, kind: 'row', parentId: timing.id, schemaVersion: timing.version, data });
  for (const data of guests) cmd('entity.create', { projectId: project.id, kind: 'row', parentId: guestTable.id, schemaVersion: guestTable.version, data });
  const categories = snapshot(db, admin, project.id).entities.filter(row => row.kind === 'category');
  const category = name => categories.find(row => row.data.name === name)?.id;
  const venue = cmd('entity.create', { projectId: project.id, kind: 'obligation', data: { title: 'Аренда площадки', priceKind: 'amount', agreed: 65000000, planned: 70000000, categoryId: category('Площадка'), dueDate: '2027-05-19', condition: 'Остаток за месяц', responsible: admin.id, fee: false } });
  cmd('entity.create', { projectId: project.id, kind: 'obligation', data: { title: 'Координация свадебного дня', priceKind: 'amount', agreed: 18000000, planned: 18000000, categoryId: category('Команда'), dueDate: project.data.date, condition: 'В день свадьбы', responsible: coordinator.id, fee: false } });
  cmd('movement.save', { projectId: project.id, data: { type: 'deposit', amount: 90000000, date: '2027-03-10', description: 'Средства на расчёты', source: 'custody', to: admin.id } });
  cmd('movement.save', { projectId: project.id, obligationVersion: venue.version, data: { type: 'payment', amount: 30000000, date: '2027-03-12', description: 'Предоплата площадке', source: 'custody', from: admin.id, obligationId: venue.id } });
}

fillProject(wedding, [
  { time: '08:30', end: '10:00', title: 'Сборы пары', place: 'Отель «Север»', audience: 'Пара', people: 'Мира, Ян, стилист, фотограф', responsible: 'Алина', done: false },
  { time: '15:30', end: '16:00', title: 'Церемония', place: 'Сад', audience: 'Общее', people: 'Все гости', responsible: 'Лев', done: false },
  { time: '22:40', end: '23:00', title: 'Финал вечера', place: 'Терраса', audience: 'Команда', people: 'Пара и команда', responsible: 'Лев', done: false },
], [
  { name: 'София Ладова', side: 'Невеста', status: 'Подтвердил', contact: '+7 900 000-00-01', meal: 'Без орехов', day2: true, hotel: 'Да', transport: 'Трансфер', table: '2', note: '' },
  { name: 'Артур Лесин', side: 'Жених', status: 'Приглашён', contact: '+7 900 000-00-02', meal: '', day2: false, hotel: '', transport: '', table: '4', note: 'Уточнить приезд' },
]);
fillProject(intimate, [
  { time: '12:00', end: '13:00', title: 'Прогулка у озера', place: 'Причал', audience: 'Пара', people: 'Лея, Марк, фотограф', responsible: 'Лев', done: false },
], [{ name: 'Ника Берг', side: 'Общие', status: 'Подтвердил', contact: '+7 900 000-00-03', meal: 'Вегетарианское', day2: false, hotel: 'Да', transport: '', table: '1', note: '' }]);

const vendorCategory = insert(db, admin, 'vendorCategory', { name: 'Фотографы', archived: false });
insert(db, admin, 'vendor', { name: 'Студия «Тихий свет»', categoryId: vendorCategory.id, contact: '@quietlight_demo', portfolio: 'https://example.com/quiet-light', price: 16000000, services: 'Фотосъёмка 10 часов', terms: 'Анонс за 10 дней', notes: 'Вымышленный подрядчик', updatedOn: '2026-09-08', archived: false });
insert(db, couple, 'notification', { userId: couple.id, title: 'Проект открыт', body: 'Добро пожаловать в общее пространство свадьбы.', projectId: wedding.id });

const text = `Локальная демонстрация tie.event\nБаза: ${dbPath}\nВсе имена и контакты вымышлены.\n\nАдминистратор\n${credentials.admin.email}\n${credentials.admin.password}\n\nПара\n${credentials.couple.email}\n${credentials.couple.password}\n\nКоординатор\n${credentials.coordinator.email}\n${credentials.coordinator.password}\n`;
writeFileSync(credentialsPath, text, { mode: 0o600, flag: existsSync(credentialsPath) ? 'wx' : 'wx' });
db.close();
console.log(`Demo database created: ${dbPath}`);
console.log(`Generated credentials (mode 0600): ${credentialsPath}`);

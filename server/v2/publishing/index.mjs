import { randomBytes } from 'node:crypto';
import { assert, change, entity, entities, insert, uid } from '../../db.mjs';
import { can, requireAccess } from '../../auth.mjs';
import { date, getScoped, text } from '../../model.mjs';
import { currentUser, listPage, projectAccess, scoped } from '../common.mjs';

const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_ASSET_PIXELS = 40_000_000;
const MICROSITE_TEMPLATES = new Set(['light', 'plum', 'photo']);
const CONTENT = { case: 'publicCase', package: 'servicePackage', faq: 'faq' };
const PUBLIC_FIELD_LIMIT = 8000;
const MICROSITE_BLOCKS = ['cover', 'rsvp', 'program', 'directions', 'contacts', 'accommodation', 'transport', 'gallery'];

const plain = (value, label, { min = 0, max = PUBLIC_FIELD_LIMIT, optional = true } = {}) => {
  if ((value === undefined || value === null || value === '') && optional) return '';
  return text(value, label, min, max);
};
const slug = value => {
  const result = plain(value, 'Адрес публикации', { min: 1, max: 100, optional: false }).toLowerCase();
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result), 'Адрес публикации: только латинские буквы, цифры и дефисы');
  return result;
};
const publicUrl = (value, label = 'Ссылка') => {
  if (!value) return '';
  assert(typeof value === 'string' && value.length <= 2000 && /^https?:\/\//i.test(value), `${label} должна начинаться с http:// или https://`);
  try { new URL(value); } catch { assert(false, `${label} некорректна`); }
  return value;
};
const phone = value => {
  if (!value) return '';
  assert(typeof value === 'string' && /^[+()\-\s\d]{5,40}$/.test(value), 'Проверьте номер телефона');
  return value;
};
const array = (value, label, max, map) => {
  assert(value === undefined || Array.isArray(value), `${label}: ожидается список`);
  const items = value || [];
  assert(items.length <= max, `${label}: не более ${max}`);
  return items.map(map);
};
const optionalDate = value => value ? date(value, false) : '';
const optionalInstant = value => {
  if (!value) return '';
  assert(typeof value === 'string' && !Number.isNaN(Date.parse(value)), 'Проверьте дату закрытия сайта');
  return new Date(value).toISOString();
};
const siteShareId = () => randomBytes(16).toString('base64url');
const clone = value => structuredClone(value);

function validateSchedule(value) {
  return array(value, 'Программа', 60, item => {
    assert(item && typeof item === 'object' && !Array.isArray(item), 'Проверьте пункт программы');
    const time = item.time || '';
    assert(!time || /^([01]\d|2[0-3]):[0-5]\d$/.test(time), 'Время программы: ЧЧ:ММ');
    return { time, title: plain(item.title, 'Название пункта', { min: 1, max: 240, optional: false }), note: plain(item.note, 'Описание пункта', { max: 1000 }) };
  });
}

function validateContacts(value) {
  return array(value, 'Контакты', 12, item => {
    assert(item && typeof item === 'object' && !Array.isArray(item), 'Проверьте контакт');
    const kind = item.kind || 'text';
    assert(['text', 'phone', 'url'].includes(kind), 'Неизвестный тип контакта');
    const value = kind === 'phone' ? phone(item.value) : kind === 'url' ? publicUrl(item.value) : plain(item.value, 'Контакт', { min: 1, max: 500, optional: false });
    return { label: plain(item.label, 'Подпись контакта', { min: 1, max: 120, optional: false }), kind, value };
  });
}

function validateAssetIds(value) {
  assert(value === undefined || Array.isArray(value), 'Изображения: ожидается список');
  const ids = value || [];
  assert(ids.length <= 40 && new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && /^[a-f0-9-]{20,64}$/i.test(id)), 'Проверьте изображения');
  return ids;
}
function validateGallery(value) {
  const items = array(value, 'Галерея', 40, item => {
    assert(item && typeof item === 'object' && !Array.isArray(item), 'Проверьте изображение галереи');
    const [assetId] = validateAssetIds([item.assetId]);
    return { assetId, alt: plain(item.alt, 'Описание изображения', { max: 240 }), caption: plain(item.caption, 'Подпись изображения', { max: 500 }), order: Number.isInteger(item.order) && item.order >= 0 ? item.order : 0 };
  });
  assert(new Set(items.map(item => item.assetId)).size === items.length, 'Изображения галереи не должны повторяться');
  return items.sort((a,b) => a.order - b.order).map((item, order) => ({ ...item, order }));
}

function validateBlocks(value) {
  const items = value === undefined ? MICROSITE_BLOCKS.map(id => ({ id, visible: true })) : value;
  assert(Array.isArray(items) && items.length === MICROSITE_BLOCKS.length, 'Проверьте блоки сайта');
  assert(new Set(items.map(item => item?.id)).size === MICROSITE_BLOCKS.length && items.every(item => item && MICROSITE_BLOCKS.includes(item.id) && typeof item.visible === 'boolean'), 'Проверьте блоки сайта');
  const byId = Object.fromEntries(items.map(item => [item.id, item]));
  assert(byId.cover.visible && byId.rsvp.visible, 'Обложку и RSVP нельзя скрыть');
  return items.map(item => ({ id: item.id, visible: item.id === 'cover' || item.id === 'rsvp' ? true : item.visible }));
}

function micrositeDraft(value = {}) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Проверьте черновик сайта');
  const template = value.template || 'light';
  assert(MICROSITE_TEMPLATES.has(template), 'Выберите шаблон сайта');
  const gallery = validateGallery(value.gallery);
  return {
    template,
    coupleNames: plain(value.coupleNames, 'Имена пары', { max: 160 }),
    title: plain(value.title, 'Заголовок', { max: 240 }),
    intro: plain(value.intro, 'Приветствие', { max: 2000 }),
    dateLabel: plain(value.dateLabel, 'Дата', { max: 160 }),
    venue: plain(value.venue, 'Место', { max: 500 }),
    dressCode: plain(value.dressCode, 'Дресс-код', { max: 1000 }),
    dressPalette: plain(value.dressPalette, 'Палитра дресс-кода', { max: 1000 }),
    directions: plain(value.directions, 'Как добраться', { max: 4000 }),
    mapUrl: publicUrl(value.mapUrl, 'Ссылка на карту'),
    accommodation: plain(value.accommodation, 'Проживание', { max: 4000 }),
    transport: plain(value.transport, 'Трансфер', { max: 4000 }),
    schedule: validateSchedule(value.schedule),
    contacts: validateContacts(value.contacts),
    mealEnabled: !!value.mealEnabled,
    transportEnabled: !!value.transportEnabled,
    assetIds: gallery.map(item=>item.assetId).concat(validateAssetIds(value.assetIds).filter(id=>!gallery.some(item=>item.assetId===id))),
    gallery,
    blocks: validateBlocks(value.blocks),
  };
}

function publishedMicrositeDraft(value) {
  const d = micrositeDraft(value);
  assert(d.coupleNames && d.dateLabel, 'Для публикации укажите имена пары и дату');
  return d;
}

function contentDraft(kind, value = {}) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Проверьте черновик публикации');
  const common = { title: plain(value.title, 'Заголовок', { max: 240 }), slug: value.slug ? slug(value.slug) : '', order: Number.isInteger(value.order) && value.order >= 0 && value.order <= 100000 ? value.order : 0, assetIds: validateAssetIds(value.assetIds) };
  if (kind === 'case') { const gallery = validateGallery(value.gallery); return { ...common, assetIds: gallery.map(item=>item.assetId).concat(common.assetIds.filter(id=>!gallery.some(item=>item.assetId===id))), gallery, summary: plain(value.summary, 'Краткая история', { max: 2000 }), city: plain(value.city, 'Город', { max: 240 }), venue: plain(value.venue, 'Площадка', { max: 240 }), season: plain(value.season, 'Сезон', { max: 100 }), year: plain(value.year, 'Год', { max: 20 }), guestCount: value.guestCount === '' || value.guestCount === undefined || value.guestCount === null ? null : Number(value.guestCount), challenge: plain(value.challenge, 'Задача пары', { max: 4000 }), solutions: plain(value.solutions, 'Решения агентства', { max: 8000 }), result: plain(value.result, 'Результат', { max: 4000 }), vendors: array(value.vendors, 'Подрядчики', 30, item => plain(item, 'Подрядчик', { min: 1, max: 240, optional: false })), vendorsApproved: !!value.vendorsApproved, budgetNote: plain(value.budgetNote, 'Бюджет', { max: 240 }), photoCredits: plain(value.photoCredits, 'Автор фото', { max: 500 }), serviceIds: array(value.serviceIds, 'Связанные услуги', 12, id => { assert(typeof id === 'string' && /^[a-f0-9-]{20,64}$/i.test(id), 'Проверьте связанную услугу'); return id; }) }; }
  if (kind === 'package') { const priceAmount = value.priceAmount === '' || value.priceAmount === undefined || value.priceAmount === null ? null : Number(value.priceAmount); assert(priceAmount === null || Number.isSafeInteger(priceAmount) && priceAmount >= 0 && priceAmount <= 1e12, 'Проверьте цену'); return { ...common, audience: plain(value.audience, 'Кому подходит', { max: 1000 }), summary: plain(value.summary, 'Описание', { max: 4000 }), included: array(value.included, 'Что входит', 30, item => plain(item, 'Пункт', { min: 1, max: 500, optional: false })), excluded: array(value.excluded, 'Отдельно', 30, item => plain(item, 'Пункт', { min: 1, max: 500, optional: false })), outcome: plain(value.outcome, 'Результат', { max: 2000 }), process: plain(value.process, 'Порядок работы', { max: 4000 }), priceType: ['fixed', 'from', 'on_request'].includes(value.priceType) ? value.priceType : 'on_request', priceAmount, priceLabel: plain(value.priceLabel, 'Цена', { max: 120 }) }; }
  return { question: plain(value.question, 'Вопрос', { max: 240 }), answer: plain(value.answer, 'Ответ', { max: 8000 }), category: plain(value.category, 'Категория', { max: 120 }), order: common.order, assetIds: [] };
}

function publishableContent(kind, draft) {
  const d = contentDraft(kind, draft);
  if (kind === 'faq') assert(d.question && d.answer, 'Для публикации заполните вопрос и ответ');
  else {
    assert(d.title && d.slug, 'Для публикации укажите название и адрес страницы');
    assert(kind !== 'case' || d.summary, 'Для публикации кейса добавьте краткую историю');
    assert(kind !== 'package' || d.summary, 'Для публикации услуги добавьте описание');
  }
  if (kind === 'case' && d.guestCount !== null) assert(Number.isInteger(d.guestCount) && d.guestCount > 0 && d.guestCount <= 10000, 'Проверьте число гостей');
  return d;
}

function requirePublish(db, u, project = null, section = undefined, row = undefined, fields = undefined) { requireAccess(db, u, project ? 'publishWeddingSite' : 'publishAgencySite', project, section, row, fields); }
function assetRows(db, agencyId, ids) {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM published_assets WHERE agency_id=? AND id IN (${ids.map(() => '?').join(',')})`).all(agencyId, ...ids);
  assert(rows.length === ids.length, 'Одно из изображений не найдено', 404);
  return rows;
}
function materializeAssets(db, u, ids, ownerId, revisionId, projectId = null) {
  const rows = assetRows(db, u.agency_id, ids);
  return rows.map(row => {
    assert(row.owner_id === ownerId, 'Изображение принадлежит другой публикации', 409);
    const id = uid();
    db.prepare('INSERT INTO published_assets(id,agency_id,project_id,owner_id,revision_id,mime,width,height,content,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))').run(id, u.agency_id, projectId, ownerId, revisionId, row.mime, row.width, row.height, row.content, 1);
    return id;
  });
}
function revokeAssets(db, agencyId, revisionId) { db.prepare('UPDATE published_assets SET active=0 WHERE agency_id=? AND revision_id=?').run(agencyId, revisionId); }

function micrositeForProject(db, u, projectId) { return entities(db, u.agency_id, projectId, 'microsite').find(row => !row.deleted) || null; }
function publicationFor(db, u, kind, id) { return scoped(db, u, id, null, CONTENT[kind]); }
function currentRevision(db, row, kind) {
  const id = row.data.publishedRevisionId;
  const revision = id && entity(db, id);
  assert(revision && !revision.deleted && revision.kind === kind && revision.parent_id === row.id, 'Опубликованная ревизия не найдена', 409);
  return revision;
}

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS published_assets(
    id TEXT PRIMARY KEY, agency_id TEXT NOT NULL, project_id TEXT, owner_id TEXT, revision_id TEXT,
    mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, content BLOB NOT NULL,
    active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS published_assets_active ON published_assets(agency_id,revision_id,active);
  CREATE TABLE IF NOT EXISTS publication_settings(agency_id TEXT PRIMARY KEY, configured_domain TEXT, updated_at TEXT NOT NULL);`);
}

function micrositeSaveDraft(db, u, c) {
  const project = projectAccess(db, u, c.projectId, 'edit', 'microsite');
  let row = micrositeForProject(db, u, project.id);
  if (row) { if (c.version !== undefined) assert(row.version === c.version, 'Сайт уже изменён. Обновите страницу.', 409, { current: row }); }
  const draft = micrositeDraft(c.data?.draft ?? c.data);
  const next = row ? { ...row.data, draft, rsvpDeadline: optionalDate(c.data?.rsvpDeadline ?? row.data.rsvpDeadline), closesAt: c.data?.closesAt !== undefined ? optionalInstant(c.data.closesAt) : (row.data.closesAt || ''), dirty: row.data.publishedRevisionId ? true : false } : { shareId: siteShareId(), draft, publishedRevisionId: null, status: 'draft', rsvpDeadline: optionalDate(c.data?.rsvpDeadline), closesAt: optionalInstant(c.data?.closesAt), dirty: false };
  return row ? change(db, u, row, next) : insert(db, u, 'microsite', next, project.id);
}
function micrositePublish(db, u, c) {
  projectAccess(db, u, c.projectId, 'edit', 'microsite'); requirePublish(db, u, c.projectId, 'microsite');
  const row = micrositeForProject(db, u, c.projectId); assert(row, 'Сначала сохраните черновик сайта', 409); assert(row.version === c.version, 'Сайт уже изменён. Обновите страницу.', 409, { current: row });
  const snapshot = publishedMicrositeDraft(row.data.draft); const previous = row.data.publishedRevisionId ? currentRevision(db, row, 'micrositeRevision') : null;
  const revisionId = uid(); const publishedAssetIds = materializeAssets(db, u, snapshot.assetIds, row.id, revisionId, c.projectId); const displayFields = { ...snapshot, assetIds: publishedAssetIds, gallery: (snapshot.gallery || []).map(item => ({ ...item, assetId: publishedAssetIds[snapshot.assetIds.indexOf(item.assetId)] })).filter(item => item.assetId) };
  const revision = insert(db, u, 'micrositeRevision', { displayFields, schedule: clone(displayFields.schedule), assetIds: publishedAssetIds, versionNumber: (previous?.data.versionNumber || 0) + 1, publishedAt: new Date().toISOString() }, c.projectId, row.id, revisionId);
  if (previous) revokeAssets(db, u.agency_id, previous.id);
  return change(db, u, row, { ...row.data, publishedRevisionId: revision.id, status: 'published', dirty: false });
}
function micrositeUnpublish(db, u, c) {
  projectAccess(db, u, c.projectId, 'edit', 'microsite'); requirePublish(db, u, c.projectId, 'microsite');
  const row = micrositeForProject(db, u, c.projectId); assert(row && row.version === c.version, 'Сайт уже изменён. Обновите страницу.', 409, { current: row || null });
  if (row.data.publishedRevisionId) revokeAssets(db, u.agency_id, row.data.publishedRevisionId);
  return change(db, u, row, { ...row.data, status: 'unpublished', publishedRevisionId: null, dirty: false });
}
function micrositeImportTiming(db, u, c) {
  projectAccess(db, u, c.projectId, 'edit', 'microsite'); const site = micrositeForProject(db, u, c.projectId); assert(site && site.version === c.version, 'Сайт уже изменён. Обновите страницу.', 409, { current: site || null });
  const table = scoped(db, u, c.data?.tableId, c.projectId, 'table'); requireAccess(db, u, 'read', c.projectId, table.id);
  const ids = c.data?.rowIds; assert(Array.isArray(ids) && ids.length >= 1 && ids.length <= 60 && new Set(ids).size === ids.length, 'Выберите пункты тайминга');
  const rows = ids.map(id => scoped(db, u, id, c.projectId, 'row')); assert(rows.every(row => row.parent_id === table.id), 'Пункт тайминга относится к другой таблице', 409);
  const schedule = rows.map(row => {
    const fieldKeys=['startTime','time','title','place','note'].filter(key=>Object.hasOwn(row.data,key)); requireAccess(db,u,'read',c.projectId,table.id,row.id,fieldKeys);
    const time = row.data.startTime || row.data.time || ''; const title = row.data.title || '';
    assert(typeof title === 'string' && title.trim(), 'В выбранном пункте нет названия'); assert(!time || /^([01]\d|2[0-3]):[0-5]\d$/.test(time), 'В выбранном пункте указано неверное время');
    return { time, title: text(title, 'Название пункта', 1, 240), note: typeof row.data.place === 'string' ? row.data.place.slice(0, 1000) : typeof row.data.note === 'string' ? row.data.note.slice(0, 1000) : '' };
  });
  return change(db, u, site, { ...site.data, draft: { ...site.data.draft, schedule }, dirty: !!site.data.publishedRevisionId });
}
function micrositeRotate(db, u, c) {
  projectAccess(db, u, c.projectId, 'edit', 'microsite'); requirePublish(db, u, c.projectId, 'microsite');
  const row = micrositeForProject(db, u, c.projectId); assert(row && row.version === c.version, 'Сайт уже изменён. Обновите страницу.', 409, { current: row || null });
  const old = row.data.publishedRevisionId ? currentRevision(db, row, 'micrositeRevision') : null;
  if (!old) return change(db, u, row, { ...row.data, shareId: siteShareId() });
  revokeAssets(db, u.agency_id, old.id);
  const sourceAssets = db.prepare('SELECT * FROM published_assets WHERE agency_id=? AND revision_id=?').all(u.agency_id, old.id);
  const newAssetIds = sourceAssets.map(asset => {
    const id = uid(); db.prepare('INSERT INTO published_assets(id,agency_id,project_id,owner_id,revision_id,mime,width,height,content,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))').run(id, u.agency_id, c.projectId, row.id, null, asset.mime, asset.width, asset.height, asset.content, 0); return id;
  });
  const oldFields = clone(old.data.displayFields); const publicFields = { ...oldFields, assetIds: newAssetIds, gallery: (oldFields.gallery || []).map(item => ({ ...item, assetId: newAssetIds[oldFields.assetIds.indexOf(item.assetId)] })).filter(item => item.assetId) };
  const revision = insert(db, u, 'micrositeRevision', { displayFields: publicFields, schedule: clone(publicFields.schedule), assetIds: newAssetIds, versionNumber: old.data.versionNumber + 1, publishedAt: new Date().toISOString(), rotatedFrom: old.id }, c.projectId, row.id);
  if (newAssetIds.length) db.prepare('UPDATE published_assets SET revision_id=?,active=1 WHERE agency_id=? AND owner_id=? AND revision_id IS NULL AND id IN (' + newAssetIds.map(() => '?').join(',') + ')').run(revision.id, u.agency_id, row.id, ...newAssetIds);
  return change(db, u, row, { ...row.data, shareId: siteShareId(), publishedRevisionId: revision.id, status: 'published', dirty: false });
}

function publicContentSaveDraft(db, u, c) {
  const kind = c.data?.kind; assert(CONTENT[kind], 'Неизвестный тип публикации'); requireAccess(db, u, c.entityId ? 'edit' : 'create', null, 'public-site', c.entityId);
  const draft = contentDraft(kind, c.data?.draft ?? c.data);
  let row = c.entityId ? publicationFor(db, u, kind, c.entityId) : null;
  if (row) { assert(row.version === c.version, 'Публикация уже изменена. Обновите страницу.', 409, { current: row }); }
  if (draft.slug) assert(!entities(db, u.agency_id, null, CONTENT[kind]).some(item => !item.deleted && item.id !== row?.id && item.data.slug === draft.slug), 'Этот адрес уже занят', 409);
  const next = row ? { ...row.data, slug: draft.slug || row.data.slug || '', draft, order: draft.order, dirty: !!row.data.publishedRevisionId } : { slug: draft.slug, draft, publishedRevisionId: null, status: 'draft', order: draft.order, dirty: false };
  return row ? change(db, u, row, next) : insert(db, u, CONTENT[kind], next);
}
function publicContentPublish(db, u, c) {
  const kind = c.data?.kind; assert(CONTENT[kind], 'Неизвестный тип публикации'); const row = publicationFor(db, u, kind, c.entityId); requirePublish(db, u, null, 'public-site', row.id); assert(row.version === c.version, 'Публикация уже изменена. Обновите страницу.', 409, { current: row });
  const draft = publishableContent(kind, row.data.draft); if (kind !== 'faq') assert(!entities(db,u.agency_id,null,CONTENT[kind]).some(item=>item.id!==row.id&&!item.deleted&&item.data.slug===draft.slug),'Этот адрес уже занят',409);
  const previous = row.data.publishedRevisionId ? currentRevision(db, row, 'publicRevision') : null;
  const revisionId = uid(); const publishedAssetIds = materializeAssets(db, u, draft.assetIds, row.id, revisionId); const content = { ...clone(draft), assetIds: publishedAssetIds, gallery: (draft.gallery || []).map((item, index) => ({ ...item, assetId: publishedAssetIds[draft.assetIds.indexOf(item.assetId)], order: index })).filter(item => item.assetId) };
  const revision = insert(db, u, 'publicRevision', { contentKind: kind, content, versionNumber: (previous?.data.versionNumber || 0) + 1, publishedAt: new Date().toISOString() }, null, row.id, revisionId);
  if (previous) revokeAssets(db, u.agency_id, previous.id);
  return change(db, u, row, { ...row.data, slug: draft.slug || row.data.slug, publishedRevisionId: revision.id, status: 'published', order: draft.order, dirty: false });
}
function publicContentUnpublish(db, u, c) {
  const kind = c.data?.kind; assert(CONTENT[kind], 'Неизвестный тип публикации'); const row = publicationFor(db, u, kind, c.entityId); requirePublish(db, u, null, 'public-site', row.id); assert(row.version === c.version, 'Публикация уже изменена. Обновите страницу.', 409, { current: row });
  if (row.data.publishedRevisionId) revokeAssets(db, u.agency_id, row.data.publishedRevisionId);
  return change(db, u, row, { ...row.data, status: 'unpublished', publishedRevisionId: null, dirty: false });
}
function publicContentArchive(db, u, c) {
  const kind = c.data?.kind; assert(CONTENT[kind], 'Неизвестный тип публикации'); const row = publicationFor(db, u, kind, c.entityId); requirePublish(db, u, null, 'public-site', row.id); assert(row.version === c.version, 'Публикация уже изменена. Обновите страницу.', 409, { current: row });
  if (row.data.publishedRevisionId) revokeAssets(db, u.agency_id, row.data.publishedRevisionId);
  return change(db, u, row, { ...row.data, status: 'archived', publishedRevisionId: null, dirty: false }, true, 'archive');
}
function publicContentRestore(db, u, c) {
  const kind = c.data?.kind; assert(CONTENT[kind], 'Неизвестный тип публикации'); const row = scoped(db, u, c.entityId, null, CONTENT[kind], { deleted: true }); requirePublish(db, u, null, 'public-site', row.id);
  assert(row.deleted && row.version === c.version, 'Публикация уже изменена. Обновите страницу.', 409, { current: row });
  return change(db, u, row, { ...row.data, status: 'unpublished', publishedRevisionId: null, dirty: false }, false, 'restore');
}
function homeDraft(value = {}) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Проверьте главную страницу');
  return { heroTitle: plain(value.heroTitle, 'Заголовок', { max: 240 }), heroText: plain(value.heroText, 'Подзаголовок', { max: 2000 }), approach: plain(value.approach, 'Подход', { max: 4000 }), steps: array(value.steps, 'Этапы', 8, item => plain(item, 'Этап', { min: 1, max: 500, optional: false })), benefits: array(value.benefits, 'Преимущества', 8, item => plain(item, 'Преимущество', { min: 1, max: 500, optional: false })), contactText: plain(value.contactText, 'Контакты', { max: 2000 }), assetIds: validateAssetIds(value.assetIds) };
}
function homeFor(db, u) { return entities(db, u.agency_id, null, 'publicHome').find(row => !row.deleted) || null; }
function publicHomeSaveDraft(db, u, c) {
  requireAccess(db, u, 'edit', null, 'public-site'); const row = homeFor(db,u); if (row) assert(row.version === c.version, 'Главная страница уже изменена. Обновите страницу.',409,{current:row}); const draft = homeDraft(c.data?.draft ?? c.data);
  return row ? change(db,u,row,{...row.data,draft,dirty:!!row.data.publishedRevisionId}) : insert(db,u,'publicHome',{draft,publishedRevisionId:null,status:'draft',dirty:false});
}
function publicHomePublish(db,u,c) {
  requirePublish(db,u); const row=homeFor(db,u); assert(row&&row.version===c.version,'Главная страница уже изменена. Обновите страницу.',409,{current:row||null}); const draft=homeDraft(row.data.draft); assert(draft.heroTitle&&draft.heroText,'Для публикации заполните заголовок и подзаголовок'); const previous=row.data.publishedRevisionId?currentRevision(db,row,'publicRevision'):null; const revisionId=uid(); const assetIds=materializeAssets(db,u,draft.assetIds,row.id,revisionId); const revision=insert(db,u,'publicRevision',{contentKind:'home',content:{...draft,assetIds},versionNumber:(previous?.data.versionNumber||0)+1,publishedAt:new Date().toISOString()},null,row.id,revisionId); if(previous) revokeAssets(db,u.agency_id,previous.id); return change(db,u,row,{...row.data,publishedRevisionId:revision.id,status:'published',dirty:false});
}
function publicHomeUnpublish(db,u,c) { requirePublish(db,u); const row=homeFor(db,u); assert(row&&row.version===c.version,'Главная страница уже изменена. Обновите страницу.',409,{current:row||null}); if(row.data.publishedRevisionId) revokeAssets(db,u.agency_id,row.data.publishedRevisionId); return change(db,u,row,{...row.data,publishedRevisionId:null,status:'unpublished',dirty:false}); }
function configureDomain(db, u, c) {
  requirePublish(db, u); const domain = String(c.data?.configuredDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  assert(!domain || /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain) && !domain.includes('..'), 'Проверьте домен');
  db.prepare('INSERT INTO publication_settings(agency_id,configured_domain,updated_at) VALUES(?,?,datetime(\'now\')) ON CONFLICT(agency_id) DO UPDATE SET configured_domain=excluded.configured_domain,updated_at=excluded.updated_at').run(u.agency_id, domain || null);
  return { configuredDomain: domain || null };
}

export const operations = {
  'microsite.saveDraft': { authorize(db,u,c) { const row=micrositeForProject(db,u,c.projectId); projectAccess(db,u,c.projectId,row?'edit':'create','microsite',row?.id??null,null); }, run: micrositeSaveDraft },
  'microsite.publish': { authorize(db,u,c) { const row=micrositeForProject(db,u,c.projectId); projectAccess(db,u,c.projectId,'edit','microsite',row?.id??null,null); requirePublish(db,u,c.projectId,'microsite',row?.id??null,null); }, run: micrositePublish },
  'microsite.unpublish': { authorize(db,u,c) { const row=micrositeForProject(db,u,c.projectId); projectAccess(db,u,c.projectId,'edit','microsite',row?.id??null,null); requirePublish(db,u,c.projectId,'microsite',row?.id??null,null); }, run: micrositeUnpublish },
  'microsite.rotateShareId': { authorize(db,u,c) { const row=micrositeForProject(db,u,c.projectId); projectAccess(db,u,c.projectId,'edit','microsite',row?.id??null,null); requirePublish(db,u,c.projectId,'microsite',row?.id??null,null); }, run: micrositeRotate },
  'microsite.importTiming': { authorize(db,u,c) { const row=micrositeForProject(db,u,c.projectId); projectAccess(db,u,c.projectId,'edit','microsite',row?.id??null,null); const table=scoped(db,u,c.data?.tableId,c.projectId,'table'); for(const id of c.data?.rowIds||[]) { const item=scoped(db,u,id,c.projectId,'row'); requireAccess(db,u,'read',c.projectId,table.id,item.id,['startTime','time','title','place','note'].filter(key=>Object.hasOwn(item.data,key))); } }, run: micrositeImportTiming },
  'publicContent.saveDraft': { authorize(db,u,c) { requireAccess(db,u,c.entityId?'edit':'create',null,'public-site',c.entityId??null,null); }, run: publicContentSaveDraft },
  'publicContent.publish': { authorize(db,u,c) { assert(CONTENT[c.data?.kind],'Неизвестный тип публикации'); const row=publicationFor(db,u,c.data.kind,c.entityId); requirePublish(db,u,null,'public-site',row.id,null); }, run: publicContentPublish },
  'publicContent.unpublish': { authorize(db,u,c) { assert(CONTENT[c.data?.kind],'Неизвестный тип публикации'); const row=publicationFor(db,u,c.data.kind,c.entityId); requirePublish(db,u,null,'public-site',row.id,null); }, run: publicContentUnpublish },
  'publicContent.archive': { authorize(db,u,c) { assert(CONTENT[c.data?.kind],'Неизвестный тип публикации'); const row=publicationFor(db,u,c.data.kind,c.entityId); requirePublish(db,u,null,'public-site',row.id,null); }, run: publicContentArchive },
  'publicContent.restore': { authorize(db,u,c) { assert(CONTENT[c.data?.kind],'Неизвестный тип публикации'); const row=scoped(db,u,c.entityId,null,CONTENT[c.data.kind],{deleted:true}); requirePublish(db,u,null,'public-site',row.id,null); }, run: publicContentRestore },
  'publicContent.configureDomain': { authorize(db,u) { requirePublish(db,u,null,'public-site',null,null); }, run: configureDomain },
  'publicSite.saveMainDraft': { authorize(db,u) { const row=homeFor(db,u); requireAccess(db,u,row?'edit':'create',null,'public-site',row?.id??null,null); }, run: publicHomeSaveDraft },
  'publicSite.publishMain': { authorize(db,u) { const row=homeFor(db,u); requirePublish(db,u,null,'public-site',row?.id??null,null); }, run: publicHomePublish },
  'publicSite.unpublishMain': { authorize(db,u) { const row=homeFor(db,u); requirePublish(db,u,null,'public-site',row?.id??null,null); }, run: publicHomeUnpublish },
};

export function getMicrosite(db, u, projectId) {
  const row = micrositeForProject(db, u, projectId); projectAccess(db, u, projectId, 'read', 'microsite', row?.id ?? null, null);
  return row ? { ...row, data: { ...row.data, draft: clone(row.data.draft), shareId: row.data.shareId } } : null;
}
export function previewMicrosite(db, u, projectId) { const site = getMicrosite(db,u,projectId); assert(site, 'Сначала сохраните черновик сайта', 404); return { id: site.id, version: site.version, html: renderWeddingHtml({ revision: { ...site.data.draft, publishedAt: null } }, { preview: true }), draft: clone(site.data.draft) }; }
export function listContent(db, u, kind, query = {}) {
  assert(CONTENT[kind], 'Неизвестный тип публикации');
  const archived = query.archived === true || query.archived === 'true'; const rows=entities(db, u.agency_id, null, CONTENT[kind], archived).filter(row => (archived ? row.deleted : !row.deleted) && can(db,u,'read',null,'public-site',row.id,null));
  return listPage(rows.sort((a,b) => (a.data.order - b.data.order) || a.updated_at.localeCompare(b.updated_at)), query);
}
export function getPublicHome(db,u) { const row=homeFor(db,u); requireAccess(db,u,'read',null,'public-site',row?.id??null,null); return row; }
export function getPublishedHome(db, agencyId) { const row = db.prepare("SELECT * FROM entities WHERE agency_id=? AND project_id IS NULL AND kind='publicHome' AND deleted=0").get(agencyId); if (!row) return null; const owner={...row,data:JSON.parse(row.data),deleted:!!row.deleted}; const revision=activeRevision(db,owner,'publicRevision'); return revision ? { id:owner.id,revision:{id:revision.id,publishedAt:revision.data.publishedAt,...clone(revision.data.content)} } : null; }
function activeRevision(db, owner, revisionKind) {
  if (!owner || owner.deleted || owner.data.status !== 'published' || !owner.data.publishedRevisionId) return null;
  const revision = entity(db, owner.data.publishedRevisionId);
  return revision && !revision.deleted && revision.kind === revisionKind && revision.parent_id === owner.id ? revision : null;
}
export function getPublishedMicrosite(db, shareId, at = Date.now()) {
  assert(typeof shareId === 'string' && /^[A-Za-z0-9_-]{22,}$/.test(shareId), 'Страница не найдена', 404);
  const site = db.prepare("SELECT * FROM entities WHERE kind='microsite' AND deleted=0").all().map(row => ({ ...row, data: JSON.parse(row.data), deleted: !!row.deleted })).find(row => row.data.shareId === shareId);
  const project = site && entity(db, site.project_id); const revision = site && project && !project.deleted && activeRevision(db, site, 'micrositeRevision');
  assert(revision && (!site.data.closesAt || at < Date.parse(site.data.closesAt)), 'Эта страница больше недоступна', 404);
  return { shareId: site.data.shareId, rsvpDeadline: site.data.rsvpDeadline || '', closesAt: site.data.closesAt || '', revision: { id: revision.id, publishedAt: revision.data.publishedAt, ...clone(revision.data.displayFields) } };
}
export function getPublishedContent(db, agencyId, kind, value) {
  assert(CONTENT[kind], 'Неизвестный тип публикации'); const rows = entities(db, agencyId, null, CONTENT[kind]);
  const owner = kind === 'faq' ? rows.find(row => row.id === value) : rows.find(row => row.data.slug === value);
  const revision = activeRevision(db, owner, 'publicRevision'); assert(revision, 'Публикация не найдена', 404);
  return { id: owner.id, kind, slug: owner.data.slug || '', order: owner.data.order || 0, revision: { id: revision.id, publishedAt: revision.data.publishedAt, ...clone(revision.data.content) } };
}
export function listPublishedContent(db, agencyId, kind) {
  assert(CONTENT[kind], 'Неизвестный тип публикации'); return entities(db, agencyId, null, CONTENT[kind]).map(row => {
    const revision = activeRevision(db, row, 'publicRevision'); return revision && { id: row.id, kind, slug: row.data.slug || '', order: row.data.order || 0, revision: { id: revision.id, publishedAt: revision.data.publishedAt, ...clone(revision.data.content) } };
  }).filter(Boolean).sort((a,b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function configuredDomain(db, agencyId) { return db.prepare('SELECT configured_domain FROM publication_settings WHERE agency_id=?').get(agencyId)?.configured_domain || null; }

export async function sanitizeRaster(input) {
  assert(Buffer.isBuffer(input) && input.length > 0 && input.length <= MAX_ASSET_BYTES, 'Изображение должно быть не больше 12 МБ', 413);
  const signature = input.subarray(0, 16);
  const jpeg = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  const png = signature.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const webp = signature.subarray(0, 4).toString('ascii') === 'RIFF' && signature.subarray(8, 12).toString('ascii') === 'WEBP';
  const avif = signature.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif','avis'].includes(signature.subarray(8, 12).toString('ascii'));
  assert(jpeg || png || webp || avif, 'Разрешены только растровые JPEG, PNG, WebP или AVIF');
  let sharp; try { ({ default: sharp } = await import('sharp')); } catch { throw new Error('Для обработки изображений установите sharp@0.35.4'); }
  const source = sharp(input, { limitInputPixels: MAX_ASSET_PIXELS, failOn: 'warning' });
  const meta = await source.metadata(); assert(['jpeg','png','webp','avif'].includes(meta.format), 'Разрешены только JPEG, PNG, WebP или AVIF');
  assert(meta.width && meta.height && meta.width * meta.height <= MAX_ASSET_PIXELS, 'Изображение не должно превышать 40 мегапикселей', 413);
  const result = await source.rotate().webp({ quality: 86 }).toBuffer({ resolveWithObject: true });
  return { mime: 'image/webp', width: result.info.width, height: result.info.height, content: result.data };
}
export async function createPublicAsset(db, u, { projectId = null, ownerId, content, privateFileId = null }) {
  assert(ownerId && typeof ownerId === 'string', 'Укажите владельца изображения');
  u=currentUser(db,u);
  if (projectId) {
    const site = micrositeForProject(db, u, projectId); projectAccess(db, u, projectId, 'edit', 'microsite', ownerId, null); assert(site?.id === ownerId, 'Владелец изображения не найден', 404);
  } else {
    requireAccess(db, u, 'edit', null, 'public-site', ownerId, null);
    const owner = entity(db, ownerId); assert(owner && owner.agency_id === u.agency_id && Object.values(CONTENT).includes(owner.kind) && !owner.deleted, 'Владелец изображения не найден', 404);
  }
  if (privateFileId) {
    const file = getScoped(db, u, privateFileId, projectId, 'file'); assert(!file.deleted,'Файл удалён',409); requireAccess(db,u,['read','files'],projectId,'files',file.id,Object.keys(file.data));
    const blob = db.prepare('SELECT content FROM blobs WHERE id=?').get(file.id); assert(blob, 'Файл не найден', 404); content = Buffer.from(blob.content);
  }
  const image = await sanitizeRaster(content);
  u=currentUser(db,u);
  if (projectId) {
    const site=micrositeForProject(db,u,projectId); projectAccess(db,u,projectId,'edit','microsite',ownerId,null); assert(site?.id===ownerId&&!site.deleted,'Владелец изображения больше недоступен',404);
  } else {
    const owner=entity(db,ownerId); requireAccess(db,u,'edit',null,'public-site',ownerId,null); assert(owner&&owner.agency_id===u.agency_id&&Object.values(CONTENT).includes(owner.kind)&&!owner.deleted,'Владелец изображения больше недоступен',404);
  }
  if (privateFileId) { const file=getScoped(db,u,privateFileId,projectId,'file'); assert(!file.deleted,'Файл удалён',409); requireAccess(db,u,['read','files'],projectId,'files',file.id,Object.keys(file.data)); }
  const id = uid();
  db.prepare('INSERT INTO published_assets(id,agency_id,project_id,owner_id,revision_id,mime,width,height,content,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))').run(id,u.agency_id,projectId,ownerId,null,image.mime,image.width,image.height,image.content,0);
  return { id, mime: image.mime, width: image.width, height: image.height };
}
export function getPublicAsset(db, agencyId, id) {
  const row = db.prepare('SELECT * FROM published_assets WHERE id=? AND agency_id=? AND active=1').get(id, agencyId); assert(row, 'Изображение не найдено', 404); return row;
}
export function getPrivateAsset(db, u, id) {
  const row = db.prepare('SELECT * FROM published_assets WHERE id=? AND agency_id=?').get(id, u.agency_id); assert(row, 'Изображение не найдено', 404);
  if (row.project_id) projectAccess(db,u,row.project_id,'read','microsite',row.owner_id,null); else requireAccess(db,u,'read',null,'public-site',row.owner_id,null);
  assert(row.owner_id, 'Изображение не найдено', 404); return row;
}

const esc = value => String(value || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
const paragraph = value => esc(value).replace(/\n/g, '<br>');
export const PUBLIC_PAGE_CSS = `:root{color:#382f35;background:#fffaf7;font-family:system-ui,sans-serif}body{margin:0;background:#fffaf7}main{max-width:960px;margin:auto;padding:32px}header,section,article{margin:0 0 28px;padding:22px;border:1px solid #eadbd6;border-radius:16px;background:#fff}h1,h2,h3{font-family:Georgia,serif}img{max-width:100%;height:auto;border-radius:10px}figure{margin:16px 0}figcaption{color:#715d63;font-size:.9rem}.v2-template-plum{background:#432d3d;color:#fff0f2}.v2-template-plum section,.v2-template-plum header{background:#5b3a50;border-color:#815b70}.v2-template-photo header{background:#f0ddd3}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}.facts{display:flex;flex-wrap:wrap;gap:8px}.facts span{padding:4px 8px;background:#f3e6e4;border-radius:99px}`;
const imageHtml = (item, { preview = false } = {}) => `<figure><img src="${preview ? '/api/v2/publishing/assets/' : '/api/public/assets/'}${esc(item.assetId)}" alt="${esc(item.alt || 'Изображение свадьбы')}" loading="lazy" width="1200" height="800">${item.caption ? `<figcaption>${paragraph(item.caption)}</figcaption>` : ''}</figure>`;
const galleryOf = d => d.gallery?.length ? d.gallery : (d.assetIds || []).map((assetId,order)=>({assetId,alt:'',caption:'',order}));
export function renderWeddingHtml(site, { preview = false } = {}) {
  const d = site.revision; const gallery=galleryOf(d); const cover=gallery[0]; const blocks=(d.blocks || MICROSITE_BLOCKS.map(id=>({id,visible:true}))).filter(item=>item.visible);
  const renderBlock = block => {
    if (block.id==='cover') return `<header>${cover?imageHtml(cover,{preview}):''}<h1>${esc(d.coupleNames)}</h1><p>${esc(d.dateLabel)}${d.venue ? ` · ${esc(d.venue)}` : ''}</p>${d.dressCode?`<p>Дресс-код: ${esc(d.dressCode)}</p>`:''}${d.dressPalette?`<p>Палитра: ${esc(d.dressPalette)}</p>`:''}${d.intro?`<p>${paragraph(d.intro)}</p>`:''}</header>`;
    if (block.id==='rsvp') return '<section data-rsvp="true"><h2>Ответ на приглашение</h2><p>Откройте персональную ссылку приглашения, чтобы ответить.</p></section>';
    if (block.id==='program'&&d.schedule?.length) return `<section><h2>Программа</h2><ol>${d.schedule.map(item=>`<li><time>${esc(item.time)}</time> <strong>${esc(item.title)}</strong>${item.note ? `<p>${paragraph(item.note)}</p>` : ''}</li>`).join('')}</ol></section>`;
    if (block.id==='directions'&&d.directions) return `<section><h2>Как добраться</h2><p>${paragraph(d.directions)}</p>${d.mapUrl?`<a href="${esc(d.mapUrl)}" rel="noreferrer">Открыть карту</a>`:''}</section>`;
    if (block.id==='accommodation'&&d.accommodation) return `<section><h2>Проживание</h2><p>${paragraph(d.accommodation)}</p></section>`;
    if (block.id==='transport'&&d.transport) return `<section><h2>Трансфер</h2><p>${paragraph(d.transport)}</p></section>`;
    if (block.id==='contacts'&&d.contacts?.length) return `<section><h2>Контакты</h2><ul>${d.contacts.map(item=>`<li>${esc(item.label)}: ${item.kind==='url'?`<a href="${esc(item.value)}" rel="noreferrer">${esc(item.value)}</a>`:esc(item.value)}</li>`).join('')}</ul></section>`;
    if (block.id==='gallery'&&gallery.length>1) return `<section><h2>Галерея</h2><div class="gallery">${gallery.slice(1).map(item=>imageHtml(item,{preview})).join('')}</div></section>`;
    return '';
  };
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.coupleNames)} — приглашение</title><style>${PUBLIC_PAGE_CSS}</style></head><body class="v2-publishing-wedding v2-template-${esc(d.template)}"><main>${blocks.map(renderBlock).join('')}</main></body></html>`;
}
export function renderAgencyHtml({ agencyName = 'tie', page = 'home', content = [], domain = null, item = null, home = null }) {
  const story = page === 'story' ? item : null;
  assert(!story || story.kind === 'case', 'Кейс не найден', 404);
  const route = page === 'home' ? '/' : story ? `/stories/${story.slug}` : `/${page}`;
  const pageTitle = { stories: 'Истории', services: 'Услуги', faq: 'Вопросы' }[page] || agencyName;
  const title = story ? `${story.revision.title} — ${agencyName}` : page === 'home' ? agencyName : `${pageTitle} — ${agencyName}`;
  const description = story ? story.revision.summary : page === 'stories' ? 'Опубликованные истории свадеб агентства.' : page === 'services' ? 'Опубликованные форматы услуг агентства.' : page === 'faq' ? 'Ответы агентства на частые вопросы.' : home?.revision?.heroText || 'Свадебное агентство.';
  const canonical = domain ? `<link rel="canonical" href="https://${esc(domain)}${esc(route)}">` : '';
  const cases = content.filter(row => row.kind === 'case'); const packages = content.filter(row => row.kind === 'package'); const faqs = content.filter(row => row.kind === 'faq');
  const price = row => row.revision.priceType === 'on_request' ? (row.revision.priceLabel || 'По запросу') : `${row.revision.priceType === 'from' ? 'От ' : ''}${row.revision.priceAmount === null || row.revision.priceAmount === undefined ? '' : `${new Intl.NumberFormat('ru-RU').format(row.revision.priceAmount)} ₽`}${row.revision.priceLabel ? ` · ${row.revision.priceLabel}` : ''}`;
  const storyFacts = story ? [['Город',story.revision.city],['Площадка',story.revision.venue],['Сезон',story.revision.season],['Год',story.revision.year],['Гостей',story.revision.guestCount],['Бюджет',story.revision.budgetNote]].filter(([,value])=>value!==''&&value!==null&&value!==undefined) : [];
  const related = story ? packages.filter(row=>story.revision.serviceIds?.includes(row.id)) : [];
  const main=home?.revision;
  const body = story ? `<article><h1>${esc(story.revision.title)}</h1>${storyFacts.length?`<p class="facts">${storyFacts.map(([label,value])=>`<span>${esc(label)}: ${esc(value)}</span>`).join('')}</p>`:''}${galleryOf(story.revision).length?`<div class="gallery">${galleryOf(story.revision).map(imageHtml).join('')}</div>`:''}<p>${paragraph(story.revision.summary)}</p>${story.revision.challenge ? `<section><h2>Задача пары</h2><p>${paragraph(story.revision.challenge)}</p></section>` : ''}${story.revision.solutions ? `<section><h2>Решения агентства</h2><p>${paragraph(story.revision.solutions)}</p></section>` : ''}${story.revision.result ? `<section><h2>Результат</h2><p>${paragraph(story.revision.result)}</p></section>` : ''}${story.revision.vendors?.length&&story.revision.vendorsApproved?`<section><h2>Команда</h2><ul>${story.revision.vendors.map(vendor=>`<li>${esc(vendor)}</li>`).join('')}</ul></section>`:''}${story.revision.photoCredits?`<p>Фото: ${esc(story.revision.photoCredits)}</p>`:''}${related.length?`<section><h2>Подходящие форматы</h2><ul>${related.map(row=>`<li><a href="/services#${esc(row.id)}">${esc(row.revision.title)}</a></li>`).join('')}</ul></section>`:''}<a href="/app?sourceCaseId=${esc(story.id)}">Обсудить похожую свадьбу</a></article>` : page === 'stories' ? `<h1>Истории</h1>${cases.map(row=>`<article>${galleryOf(row.revision)[0]?imageHtml(galleryOf(row.revision)[0]):''}<h2><a href="/stories/${esc(row.slug)}">${esc(row.revision.title)}</a></h2><p>${paragraph(row.revision.summary)}</p></article>`).join('')}` : page === 'services' ? `<h1>Форматы услуг</h1>${packages.map(row=>`<article id="${esc(row.id)}"><h2>${esc(row.revision.title)}</h2><p>${paragraph(row.revision.summary)}</p><p>${esc(price(row))}</p>${row.revision.included?.length?`<h3>Что входит</h3><ul>${row.revision.included.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:''}${row.revision.excluded?.length?`<h3>Отдельно</h3><ul>${row.revision.excluded.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:''}${row.revision.outcome?`<p>${paragraph(row.revision.outcome)}</p>`:''}${row.revision.process?`<p>${paragraph(row.revision.process)}</p>`:''}<a href="/app?sourcePackageId=${esc(row.id)}">Обсудить этот формат</a></article>`).join('')}` : page === 'faq' ? `<h1>Вопросы</h1>${faqs.map(row=>`<details><summary>${esc(row.revision.question)}</summary><p>${paragraph(row.revision.answer)}</p></details>`).join('')}` : `<section><h1>${esc(main?.heroTitle || agencyName)}</h1>${main?.heroText?`<p>${paragraph(main.heroText)}</p>`:''}<a href="/app">Оставить заявку</a></section>${main?.approach?`<section><h2>Подход</h2><p>${paragraph(main.approach)}</p></section>`:''}${cases.length ? `<section><h2>Истории</h2>${cases.map(row=>`<a href="/stories/${esc(row.slug)}">${esc(row.revision.title)}</a>`).join('')}</section>` : ''}${packages.length ? `<section><h2>Форматы услуг</h2>${packages.map(row=>`<article><h3>${esc(row.revision.title)}</h3><p>${paragraph(row.revision.summary)}</p><a href="/app?sourcePackageId=${esc(row.id)}">Обсудить этот формат</a></article>`).join('')}</section>` : ''}${main?.steps?.length?`<section><h2>Этапы работы</h2><ol>${main.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol></section>`:''}${main?.benefits?.length?`<section><h2>Кабинет подготовки</h2><ul>${main.benefits.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`:''}${faqs.length?`<section><h2>Вопросы</h2>${faqs.map(row=>`<details><summary>${esc(row.revision.question)}</summary><p>${paragraph(row.revision.answer)}</p></details>`).join('')}</section>`:''}${main?.contactText?`<section><h2>Контакты</h2><p>${paragraph(main.contactText)}</p><a href="/app">Оставить заявку</a></section>`:''}`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${canonical}<style>${PUBLIC_PAGE_CSS}</style></head><body class="v2-publishing-agency"><nav><a href="/">${esc(agencyName)}</a><a href="/stories">Истории</a><a href="/services">Услуги</a><a href="/faq">Вопросы</a><a href="/app">Кабинет</a></nav><main>${body}</main></body></html>`;
}
export function sitemapXml(db, agencyId) {
  const domain = configuredDomain(db, agencyId); if (!domain) return null;
  const cases=listPublishedContent(db,agencyId,'case'), packages=listPublishedContent(db,agencyId,'package'), faqs=listPublishedContent(db,agencyId,'faq');
  const urls = ['']; if(cases.length) { urls.push('stories'); for (const item of cases) urls.push(`stories/${item.slug}`); } if(packages.length) urls.push('services'); if(faqs.length) urls.push('faq');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(path=>`<url><loc>https://${esc(domain)}/${esc(path)}</loc></url>`).join('')}</urlset>`;
}
export function migrateLegacyDrafts(db, u) {
  requirePublish(db, u); const agency = db.prepare('SELECT settings FROM agencies WHERE id=?').get(u.agency_id); const settings = JSON.parse(agency?.settings || '{}'); const created = { cases: 0, packages: 0 };
  for (const item of Array.isArray(settings.portfolio) ? settings.portfolio : []) { const row = insert(db,u,'publicCase',{slug:'',draft:contentDraft('case',{title:item.title||'',summary:item.description||''}),publishedRevisionId:null,status:'draft',order:created.cases,dirty:false}); created.cases++; }
  for (const title of Array.isArray(settings.services) ? settings.services : []) { insert(db,u,'servicePackage',{slug:'',draft:contentDraft('package',{title:String(title||'')}),publishedRevisionId:null,status:'draft',order:created.packages,dirty:false}); created.packages++; }
  return created;
}

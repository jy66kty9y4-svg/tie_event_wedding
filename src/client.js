const DB_NAME = 'tie-private-v1';
const DB_VERSION = 1;
const LOGOUT_TOMBSTONE = 'tie:pending-server-logout';
const EVENT = 'tie-client-data';
let initPromise = null;
let syncPromise = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tie-private-events-v1') : null;

function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
function identityOf(value) { return value?.user?.id && value?.agency?.id ? `${value.agency.id}:${value.user.id}` : null; }
function csrf() {
  if (typeof document === 'undefined') return '';
  const item = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith('tie_csrf='));
  try { return item ? decodeURIComponent(item.slice('tie_csrf='.length)) : ''; } catch { return ''; }
}
function emit(detail = {}, broadcast = true) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  if (broadcast) channel?.postMessage(detail);
}
channel?.addEventListener('message', event => {
  if (event.data?.type === 'logout' || event.data?.type === 'identity') initPromise = null;
  emit(event.data || { type: 'change' }, false);
});
function clientError(message, status, details) { const error = new Error(message); if (status) error.status = status; if (details !== undefined) error.details = details; return error; }

async function rawApi(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const request = { ...options, credentials: 'same-origin', headers };
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    request.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  if ((request.method || 'GET').toUpperCase() !== 'GET') headers.set('X-CSRF-Token', csrf());
  const response = await fetch(path, request);
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw clientError(value?.error || `HTTP ${response.status}`, response.status, value?.details);
  return value;
}

function hasLogoutTombstone() { try { return localStorage.getItem(LOGOUT_TOMBSTONE) === '1'; } catch { return false; } }
function setLogoutTombstone(value) { try { if (value) localStorage.setItem(LOGOUT_TOMBSTONE, '1'); else localStorage.removeItem(LOGOUT_TOMBSTONE); } catch { /* unavailable */ } }

async function completePendingLogout() {
  if (!hasLogoutTombstone()) return;
  if (!online()) throw clientError('Вы вышли офлайн. Подключитесь к сети, чтобы завершить выход.', 401);
  if (!csrf()) await rawApi('/api/public?agency=tie');
  await rawApi('/api/logout', { method: 'POST', body: {} });
  setLogoutTombstone(false);
}

export async function api(path, options = {}) {
  if (!String(path).startsWith('/api/')) throw clientError('Разрешены только локальные API-запросы');
  if (path !== '/api/logout' && path !== '/api/public' && hasLogoutTombstone()) await completePendingLogout();
  return rawApi(path, options);
}

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(clientError('Офлайн-хранилище недоступно'));
  return new Promise((resolveOpen, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('meta', { keyPath: 'key' });
      const snapshots = db.createObjectStore('snapshots', { keyPath: 'key' }); snapshots.createIndex('identity', 'identity');
      const queue = db.createObjectStore('queue', { keyPath: 'id' }); queue.createIndex('identity', 'identity');
    };
    request.onsuccess = () => resolveOpen(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx(storeNames, mode, work) {
  const db = await openDb();
  try {
    return await new Promise((resolveTx, reject) => {
      const transaction = db.transaction(storeNames, mode);
      let result;
      transaction.oncomplete = () => resolveTx(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || clientError('Операция хранилища отменена'));
      try { result = work(transaction); } catch (error) { transaction.abort(); reject(error); }
    });
  } finally { db.close(); }
}

function requestValue(request) { return new Promise((resolveRequest, reject) => { request.onsuccess = () => resolveRequest(request.result); request.onerror = () => reject(request.error); }); }
async function getMeta(key) { return tx(['meta'], 'readonly', tr => requestValue(tr.objectStore('meta').get(key))); }
async function putMeta(key, value) { return tx(['meta'], 'readwrite', tr => tr.objectStore('meta').put({ key, value })); }
async function records(store, index, value) { return tx([store], 'readonly', tr => requestValue(tr.objectStore(store).index(index).getAll(value))); }

async function clearPrivate() {
  if (typeof indexedDB === 'undefined') return;
  await tx(['meta', 'snapshots', 'queue'], 'readwrite', tr => {
    tr.objectStore('meta').clear(); tr.objectStore('snapshots').clear(); tr.objectStore('queue').clear();
  });
}

async function reconcileIdentity(state) {
  const next = identityOf(state);
  if (!next) return null;
  const current = (await getMeta('identity'))?.value || null;
  if (current && current !== next) await clearPrivate();
  await putMeta('identity', next);
  await putMeta('identity-public', { user: state.user, agency: state.agency });
  if (current && current !== next) emit({ type: 'identity', identity: next });
  return next;
}

async function removeInvisibleSnapshots(state, identity) {
  if (!Array.isArray(state.projects)) return;
  const visible = new Set(state.projects.map(project => project.id));
  await tx(['snapshots'], 'readwrite', tr => {
    const request = tr.objectStore('snapshots').index('identity').openCursor(identity);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!visible.has(cursor.value.projectId)) cursor.delete();
      cursor.continue();
    };
  });
}

async function currentIdentity() { return (await getMeta('identity'))?.value || null; }
function snapshotKey(identity, projectId) { return `${identity}:${projectId}`; }

async function savedSnapshot(projectId) {
  const identity = await currentIdentity();
  if (!identity) return null;
  return tx(['snapshots'], 'readonly', tr => requestValue(tr.objectStore('snapshots').get(snapshotKey(identity, projectId))));
}

async function saveSnapshot(identity, projectId, snapshot) {
  const preparedAt = Date.now();
  const expiresAt = Number(snapshot.expiresAt) || preparedAt + 7 * 86400000;
  await tx(['snapshots'], 'readwrite', tr => tr.objectStore('snapshots').put({ key: snapshotKey(identity, projectId), identity, projectId, preparedAt, expiresAt, snapshot }));
}

function requireFresh(record) {
  if (!record) throw clientError('Проект не подготовлен для работы без сети', 404);
  if (record.expiresAt <= Date.now()) throw clientError('Срок офлайн-доступа истёк. Подключитесь к сети и обновите проект.', 410);
  return structuredClone(record.snapshot);
}

function applyOptimistic(snapshot, commands) {
  return commands.reduce((value, item) => optimistic(value, item.command), snapshot);
}

async function preparedState(projectId) {
  const record = await savedSnapshot(projectId);
  const base = requireFresh(record);
  const identity = await currentIdentity();
  const queued = (await records('queue', 'identity', identity)).filter(item => item.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt);
  return applyOptimistic(base, queued);
}

async function offlineDashboard() {
  const identity = await currentIdentity();
  if (!identity) throw clientError('Нет подготовленных офлайн-данных', 401);
  const publicIdentity = (await getMeta('identity-public'))?.value;
  const prepared = (await records('snapshots', 'identity', identity)).filter(x => x.expiresAt > Date.now());
  if (!publicIdentity || !prepared.length) throw clientError('Нет подготовленных офлайн-данных', 404);
  return { user: publicIdentity.user, agency: publicIdentity.agency, grants: [], projects: prepared.map(x => x.snapshot.project), applications: [], notifications: [], global: [], roles: [], users: [], assignments: [], financials: null, offline: true };
}

export async function loadState(projectId = null) {
  if (online()) {
    try {
      const state = await api(`/api/state${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`);
      const identity = await reconcileIdentity(state);
      await removeInvisibleSnapshots(state, identity);
      return state;
    } catch (error) {
      if (error.status) throw error;
    }
  }
  if (hasLogoutTombstone()) throw clientError('Вы вышли из аккаунта', 401);
  return projectId ? preparedState(projectId) : offlineDashboard();
}

export async function prepareProject(projectId) {
  if (!projectId) throw clientError('Выберите проект');
  const state = await api(`/api/offline?project=${encodeURIComponent(projectId)}`);
  const identity = await reconcileIdentity(state);
  await saveSnapshot(identity, projectId, state);
  emit({ type: 'prepared', projectId });
  return state;
}

function allowedByGrant(snapshot, action, section, row = null, fields = []) {
  if (snapshot.user?.protected) return true;
  return (snapshot.grants || []).some(grant => {
    if (!(grant.permissions || []).includes(action)) return false;
    if (grant.project_id !== null && grant.project_id !== snapshot.project?.id) return false;
    const limits = grant.restrictions || {};
    if (limits.sections?.length && !limits.sections.includes(section)) return false;
    if (limits.rows?.length && row && !limits.rows.includes(row)) return false;
    if (limits.fields?.length && fields.some(field => !limits.fields.includes(field))) return false;
    return true;
  });
}

function allowedOffline(command, snapshot) {
  if (command.op === 'movement.save') {
    const obligation = snapshot.entities?.find(entity => entity.id === command.data?.obligationId && entity.kind === 'obligation');
    return !!obligation && ['payment', 'fee'].includes(command.data?.type) && command.obligationVersion === obligation.version &&
      snapshot.project?.data?.offline?.includes('payouts') && allowedByGrant(snapshot, 'finance', 'budget', obligation.id);
  }
  if (command.op !== 'entity.edit' || !command.entityId) return false;
  const row = snapshot.entities?.find(entity => entity.id === command.entityId && entity.kind === 'row');
  const table = row && snapshot.entities?.find(entity => entity.id === row.parent_id && entity.kind === 'table');
  const fields = Object.keys(command.data || {});
  return !!row && !!table && command.version === row.version && command.schemaVersion === table.version &&
    fields.every(field => table.data.columns.some(column => column.id === field)) && allowedByGrant(snapshot, 'edit', table.id, row.id, fields);
}

function optimistic(snapshot, command) {
  const next = structuredClone(snapshot);
  if (command.op === 'entity.edit') {
    const row = next.entities.find(x => x.id === command.entityId);
    if (row) { row.data = { ...row.data, ...command.data }; row.version += 1; row.updated_at = new Date().toISOString(); }
  } else if (command.op === 'movement.save') {
    const existing = command.entityId && next.entities.find(x => x.id === command.entityId);
    const row = existing || { id: `offline:${command.id}`, agency_id: next.agency.id, project_id: command.projectId, kind: 'movement', parent_id: null, data: {}, version: 0, deleted: false, updated_at: new Date().toISOString() };
    row.data = { ...row.data, ...command.data }; row.version += 1;
    if (!existing) next.entities.push(row);
    const obligation = next.entities.find(x => x.id === command.data?.obligationId && x.kind === 'obligation');
    if (obligation && ['payment', 'fee'].includes(command.data.type)) {
      obligation.data.paid = (obligation.data.paid || 0) + command.data.amount;
      obligation.data.due = Math.max(0, (obligation.data.due ?? obligation.data.agreed ?? 0) - command.data.amount);
      obligation.version += 1;
    }
  }
  return next;
}

async function queueCommand(body) {
  if (hasLogoutTombstone()) throw clientError('Вы вышли из аккаунта', 401);
  const identity = await currentIdentity();
  const record = body.projectId ? await savedSnapshot(body.projectId) : null;
  const snapshot = body.projectId ? await preparedState(body.projectId) : requireFresh(record);
  if (!allowedOffline(body, snapshot)) throw clientError('Это действие требует подключения к сети', 503);
  await tx(['queue'], 'readwrite', tr => {
    tr.objectStore('queue').put({ id: body.id, identity, projectId: body.projectId, command: body, state: 'pending', createdAt: Date.now() });
  });
  emit({ type: 'queued', projectId: body.projectId, id: body.id });
  return { queued: true, id: body.id };
}

export async function command(body) {
  const value = { ...body, id: body?.id || crypto.randomUUID() };
  if (!value.op) throw clientError('Не указано действие');
  if (online()) {
    try { return await api('/api/command', { method: 'POST', body: value }); }
    catch (error) { if (error.status) throw error; }
  }
  return queueCommand(value);
}

async function queueForCurrent() {
  const identity = await currentIdentity();
  return identity ? records('queue', 'identity', identity) : [];
}

export async function getOfflineStatus(projectId = null) {
  const identity = await currentIdentity();
  if (!identity || hasLogoutTombstone()) return { preparedAt: null, expiresAt: null, pending: 0, conflicts: [], projects: [] };
  const [saved, queued] = await Promise.all([records('snapshots', 'identity', identity), queueForCurrent()]);
  const selected = projectId ? saved.find(x => x.projectId === projectId) : saved.sort((a, b) => b.preparedAt - a.preparedAt)[0];
  const scopedQueue = projectId ? queued.filter(x => x.projectId === projectId) : queued;
  return {
    preparedAt: selected?.preparedAt || null,
    expiresAt: selected?.expiresAt || null,
    pending: scopedQueue.filter(x => x.state === 'pending').length,
    conflicts: scopedQueue.filter(x => x.state === 'conflict').map(x => ({ id: x.id, command: x.command, error: x.error, status: x.status, details: x.details })),
    projects: saved.map(x => ({ id: x.projectId, name: x.snapshot.project?.data?.name || x.projectId })),
  };
}

async function markConflict(item, error) {
  await tx(['queue'], 'readwrite', tr => tr.objectStore('queue').put({ ...item, state: 'conflict', error: error.message, status: error.status || 0, details: error.details }));
}

async function performSync() {
  if (!online()) return getOfflineStatus();
  await completePendingLogout();
  const state = await rawApi('/api/state');
  const before = await currentIdentity();
  const identity = await reconcileIdentity(state);
  await removeInvisibleSnapshots(state, identity);
  if (before && before !== identity) return getOfflineStatus();
  const queued = (await queueForCurrent()).sort((a, b) => a.createdAt - b.createdAt);
  const affected = new Set();
  for (const item of queued) {
    if (item.state === 'conflict') continue;
    try {
      await rawApi('/api/command', { method: 'POST', body: item.command });
      await tx(['queue'], 'readwrite', tr => tr.objectStore('queue').delete(item.id));
      if (item.projectId) affected.add(item.projectId);
    } catch (error) {
      if (!error.status) break;
      await markConflict(item, error);
    }
  }
  for (const projectId of affected) {
    try {
      const fresh = await rawApi(`/api/offline?project=${encodeURIComponent(projectId)}`);
      await saveSnapshot(identity, projectId, fresh);
    } catch (error) {
      if (error.status === 403 || error.status === 404) await tx(['snapshots'], 'readwrite', tr => tr.objectStore('snapshots').delete(snapshotKey(identity, projectId)));
      else if (!error.status) break;
    }
  }
  emit({ type: 'sync' });
  return getOfflineStatus();
}

export function syncQueue() {
  if (syncPromise) return syncPromise;
  const run = () => performSync();
  syncPromise = (typeof navigator !== 'undefined' && navigator.locks?.request ? navigator.locks.request('tie-offline-sync', run) : run())
    .finally(() => { syncPromise = null; });
  return syncPromise;
}

export async function discardCommand(id) {
  const identity = await currentIdentity();
  const item = await tx(['queue'], 'readonly', tr => requestValue(tr.objectStore('queue').get(id)));
  if (!item || item.identity !== identity || item.state !== 'conflict') throw clientError('Конфликт не найден', 404);
  await tx(['queue'], 'readwrite', tr => tr.objectStore('queue').delete(id));
  emit({ type: 'discarded', id });
}

export async function retryCommand(id, replacements = {}) {
  const identity = await currentIdentity();
  const item = await tx(['queue'], 'readonly', tr => requestValue(tr.objectStore('queue').get(id)));
  if (!item || item.identity !== identity || item.state !== 'conflict') throw clientError('Конфликт не найден', 404);
  const changed = Object.keys(replacements).some(key => JSON.stringify(item.command[key]) !== JSON.stringify(replacements[key]));
  const next = { ...item.command, ...replacements, id: changed ? crypto.randomUUID() : item.command.id };
  await tx(['queue'], 'readwrite', tr => {
    tr.objectStore('queue').delete(id);
    tr.objectStore('queue').put({ ...item, id: next.id, command: next, state: 'pending', error: undefined, status: undefined, details: undefined, createdAt: Date.now() });
  });
  emit({ type: 'retry', id: next.id });
  return { queued: true, id: next.id };
}

export async function logout() {
  await clearPrivate();
  initPromise = null;
  setLogoutTombstone(true);
  if (online()) {
    try { await completePendingLogout(); } catch (error) { if (error.status) throw error; }
  }
  emit({ type: 'logout' });
  return { ok: true };
}

export function subscribe(callback) {
  if (typeof window === 'undefined') return () => {};
  const change = event => callback(event.type === EVENT ? event.detail : { type: event.type });
  const storage = event => { if (event.key === LOGOUT_TOMBSTONE) callback({ type: event.newValue === '1' ? 'logout' : 'session' }); };
  window.addEventListener('online', change); window.addEventListener('offline', change); window.addEventListener(EVENT, change); window.addEventListener('storage', storage);
  return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change); window.removeEventListener(EVENT, change); window.removeEventListener('storage', storage); };
}

export function initClient() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js');
    if (online()) {
      await completePendingLogout();
      const identity = await currentIdentity();
      if (identity) {
        try { const state = await rawApi('/api/state'); const current = await reconcileIdentity(state); await removeInvisibleSnapshots(state, current); }
        catch (error) { if (error.status === 401) await clearPrivate(); else if (error.status) throw error; }
      }
    }
    return { online: online() };
  })().catch(error => { initPromise = null; throw error; });
  return initPromise;
}

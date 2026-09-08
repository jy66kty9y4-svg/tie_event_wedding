import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openDatabase, Fault, assert } from './db.mjs';
import { can, requireAccess, digest, token, userSession, rateLimit } from './auth.mjs';
import { bootstrap, authenticate, register, publicInfo, snapshot, execute, upload, download } from './service.mjs';

import { calendar, notifications, preferences, previewMeeting, processOutbox } from './v2/calendar/index.mjs';
import { dashboard } from './v2/calendar/readiness.mjs';
import {context as guestContext, exchange as guestExchange, guestList,guestInvites,seatingSnapshot,legacySeatingPreview,respond as guestRespond} from './v2/guest/index.mjs';
import { members, scoped } from './v2/common.mjs';
import { configuredDomain, createPublicAsset, getMicrosite, getPrivateAsset, getPublicAsset, getPublicHome, getPublishedContent, getPublishedHome, getPublishedMicrosite, listContent, listPublishedContent, previewMicrosite, renderAgencyHtml, renderWeddingHtml, sitemapXml } from './v2/publishing/index.mjs';
import { integrationHooks as workflow } from './v2/workflow/index.mjs';

const SESSION_COOKIE = 'tie_session';
const CSRF_COOKIE = 'tie_csrf';
const GUEST_SESSION_COOKIE = 'tie_guest_session';
const GUEST_CSRF_COOKIE = 'tie_guest_csrf';
const MAX_BODY = 12 * 1024 * 1024;
const MIME = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

function cookies(req) {
  const result = {};
  for (const item of String(req.headers.cookie || '').split(';')) {
    const at = item.indexOf('=');
    if (at < 1) continue;
    try { result[item.slice(0, at).trim()] = decodeURIComponent(item.slice(at + 1).trim()); } catch { /* ignore malformed cookies */ }
  }
  return result;
}

function cookie(name, value, req, { httpOnly = false, clear = false, maxAge = 7 * 86400 } = {}) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict; ${httpOnly ? 'HttpOnly; ' : ''}${secure ? 'Secure; ' : ''}Max-Age=${clear ? 0 : maxAge}`;
}

function securityHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ...extra,
  };
}

function sendJson(res, status, value, extra = {}) {
  const data = Buffer.from(JSON.stringify(value));
  res.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store, private', ...extra }));
  res.end(data);
}
function sendHtml(res, status, value, extra = {}) {
  const data = Buffer.from(value);
  res.writeHead(status, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length, ...extra }));
  res.end(data);
}

async function readJson(req) {
  assert(String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json'), 'Требуется Content-Type application/json', 415);
  const declared = Number(req.headers['content-length'] || 0);
  assert(Number.isFinite(declared) && declared <= MAX_BODY, 'Запрос больше 12 МБ', 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) { req.resume(); throw new Fault('Запрос больше 12 МБ', 413); }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    assert(body && typeof body === 'object' && !Array.isArray(body), 'Ожидается JSON-объект');
    return body;
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault('Некорректный JSON', 400);
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const protocol = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return origin === `${protocol}://${req.headers.host}`;
}

function requireCsrf(req) {
  assert(sameOrigin(req), 'Запрос с другого сайта отклонён', 403);
  const site = req.headers['sec-fetch-site'];
  assert(!site || site === 'same-origin' || site === 'none', 'Запрос с другого сайта отклонён', 403);
  const expected = cookies(req)[CSRF_COOKIE] || '';
  const supplied = String(req.headers['x-csrf-token'] || '');
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  assert(a.length >= 20 && a.length === b.length && timingSafeEqual(a, b), 'Обновите страницу и повторите действие', 403);
}
function requireGuestCsrf(req) {
  assert(sameOrigin(req), 'Запрос с другого сайта отклонён', 403);
  const site = req.headers['sec-fetch-site'];
  assert(!site || site === 'same-origin' || site === 'none', 'Запрос с другого сайта отклонён', 403);
  const expected = cookies(req)[GUEST_CSRF_COOKIE] || '';
  const supplied = String(req.headers['x-guest-csrf-token'] || '');
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  assert(a.length >= 20 && a.length === b.length && timingSafeEqual(a, b), 'Обновите страницу и повторите действие', 403);
}

function requireUser(db, req) {
  const user = userSession(db, cookies(req)[SESSION_COOKIE]);
  assert(user, 'Войдите в аккаунт', 401);
  return user;
}

function clientIp(req) {
  return String(req.socket.remoteAddress || 'local').slice(0, 100);
}

function addCsrf(req, res) {
  if (!cookies(req)[CSRF_COOKIE]) res.setHeader('Set-Cookie', cookie(CSRF_COOKIE, token(), req));
}

function attachmentName(name) {
  return String(name || 'file').replace(/[\r\n"\\]/g, '_').slice(0, 180);
}

async function readRaw(req, limit = MAX_BODY) {
  const declared = Number(req.headers['content-length'] || 0);
  assert(Number.isFinite(declared) && declared <= limit, 'Запрос больше 12 МБ', 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) { req.resume(); throw new Fault('Запрос больше 12 МБ', 413); } chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function base64(value) {
  assert(typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0, 'Проверьте содержимое изображения');
  const out = Buffer.from(value, 'base64'); assert(out.length > 0, 'Проверьте содержимое изображения'); return out;
}
async function publicationAssetInput(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (type.startsWith('application/json')) {
    const body = await readJson(req); return { projectId: body.projectId || null, ownerId: body.ownerId, privateFileId: body.privateFileId || null, content: body.content === undefined ? undefined : base64(body.content) };
  }
  const match = type.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))/);
  assert(match, 'Требуется JSON или multipart/form-data', 415);
  const raw = await readRaw(req), boundary = Buffer.from(`--${match[1] || match[2]}`), fields = {};
  let at = raw.indexOf(boundary);
  while (at >= 0) {
    let start = at + boundary.length; if (raw.subarray(start, start + 2).equals(Buffer.from('--'))) break;
    if (raw.subarray(start, start + 2).equals(Buffer.from('\r\n'))) start += 2;
    const headersEnd = raw.indexOf(Buffer.from('\r\n\r\n'), start); assert(headersEnd >= 0, 'Некорректный multipart запрос');
    const headers = raw.subarray(start, headersEnd).toString('utf8'); const name = headers.match(/name="([^"]+)"/i)?.[1]; assert(name && /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(name), 'Некорректный multipart запрос');
    const next = raw.indexOf(boundary, headersEnd + 4); assert(next >= 0, 'Некорректный multipart запрос');
    fields[name] = raw.subarray(headersEnd + 4, next - 2); at = next;
  }
  const string = key => fields[key] ? fields[key].toString('utf8') : null;
  const content = fields.content || fields.file; assert(content || string('privateFileId'), 'Передайте изображение или privateFileId');
  return { projectId: string('projectId'), ownerId: string('ownerId'), privateFileId: string('privateFileId'), content };
}
function publicEntryTags(root) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, '.vite', 'manifest.json'), 'utf8'));
    const entry = Object.values(manifest).find(item => item?.isEntry && item?.src === 'src/v2/public-entry.jsx');
    if (!entry) return ''; const seen=new Set(), collect=item=>{ for(const file of item?.css||[]) seen.add(file); for(const key of item?.imports||[]) collect(manifest[key]); }; collect(entry);
    const css = [...seen].map(file => `<link rel="stylesheet" href="/${file}">`).join('');
    return `${css}<script type="module" src="/${entry.file}"></script>`;
  } catch { return ''; }
}
function withPublicEntry(html, root) { return html.replace('</head>', `${publicEntryTags(root)}</head>`); }
function publicAgency(db, url) {
  const agency = publicInfo(db, url.searchParams.get('agency') || 'tie');
  assert(agency && !agency.notFound && agency.id, 'Публичная страница не найдена', 404);
  return agency;
}
function sendAsset(res, asset, extra = {}) {
  res.writeHead(200, securityHeaders({ 'Content-Type': asset.mime, 'Content-Length': asset.content.length, 'Cache-Control': 'no-store', ...extra }));
  res.end(asset.content);
}

async function serveStatic(req, res, distDir, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) throw new Fault('Метод не поддерживается', 405);
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new Fault('Некорректный адрес', 400); }
  if (decoded.split('/').some(part => part.startsWith('.'))) throw new Fault('Файл не найден', 404);
  const base = realpathSync(distDir);
  const relative = decoded.replace(/^\/+/, '');
  let target = resolve(base, relative || 'index.html');
  if (!target.startsWith(base + sep) && target !== base) throw new Fault('Файл не найден', 404);
  if (!existsSync(target) || !statSync(target).isFile()) target = join(base, 'index.html');
  const actual = realpathSync(target);
  if (!actual.startsWith(base + sep)) throw new Fault('Файл не найден', 404);
  const stat = statSync(actual);
  const isShell = actual === join(base, 'index.html');
  const cache = isShell || actual.endsWith(`${sep}sw.js`) ? 'no-cache' : /\.[a-f0-9]{8,}\./i.test(actual) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  res.writeHead(200, securityHeaders({ 'Content-Type': MIME[extname(actual).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': cache }));
  if (req.method === 'HEAD') res.end(); else createReadStream(actual).pipe(res);
}

export function createHttpServer({ dbPath = process.env.TIE_DB_PATH || 'data/tie.sqlite', distDir = process.env.TIE_DIST_DIR || 'dist' } = {}) {
  const db = openDatabase(dbPath);
  const root = resolve(distDir);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      addCsrf(req, res);
      if (url.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });
      if (url.pathname === '/api/public' && req.method === 'GET') return sendJson(res, 200, publicInfo(db, url.searchParams.get('agency') || 'tie'));

      // Public RSVP is deliberately handled before staff CSRF/session routing.
      if (url.pathname.startsWith('/api/public/rsvp/')) {
        assert(['GET', 'POST'].includes(req.method), 'Метод не поддерживается', 405);
        const shareId = url.searchParams.get('shareId') || '';
        if (url.pathname === '/api/public/rsvp/exchange' && req.method === 'POST') {
          assert(sameOrigin(req), 'Запрос с другого сайта отклонён', 403);
          const body = await readJson(req); rateLimit(db, `guest-exchange-ip:${clientIp(req)}`, 30); rateLimit(db, `guest-exchange-token:${digest(String(body.token || ''))}`, 8);
          const result = guestExchange(db, { shareId: body.shareId, token: body.token, ip: clientIp(req) });
          return sendJson(res, 200, { expiresAt: result.expiresAt, shareId: result.shareId }, { 'Set-Cookie': [cookie(GUEST_SESSION_COOKIE, result.sessionToken, req, { httpOnly: true, maxAge: 86400 }), cookie(GUEST_CSRF_COOKIE, result.csrfToken, req, { maxAge: 86400 })] });
        }
        const guest = cookies(req);
        if (url.pathname === '/api/public/rsvp/context' && req.method === 'GET') {
          return sendJson(res, 200, guestContext(db, { shareId, sessionToken: guest[GUEST_SESSION_COOKIE], csrfToken: guest[GUEST_CSRF_COOKIE] }));
        }
        if (url.pathname === '/api/public/rsvp/respond' && req.method === 'POST') {
          requireGuestCsrf(req); rateLimit(db, `guest-respond-ip:${clientIp(req)}`, 60); rateLimit(db, `guest-respond-session:${digest(String(guest[GUEST_SESSION_COOKIE] || ''))}`, 30);
          const body = await readJson(req);
          return sendJson(res, 200, guestRespond(db, { shareId: body.shareId, sessionToken: guest[GUEST_SESSION_COOKIE], csrfToken: guest[GUEST_CSRF_COOKIE], commandId: body.commandId, inviteVersion: body.inviteVersion, schemaVersion: body.schemaVersion, changes: body.changes }));
        }
        throw new Fault('API-метод не найден', 404);
      }
      if (url.pathname.startsWith('/api/public/w/') && req.method === 'GET') {
        const shareId = url.pathname.slice('/api/public/w/'.length); assert(shareId && !shareId.includes('/'), 'Страница не найдена', 404);
        return sendJson(res, 200, getPublishedMicrosite(db, shareId));
      }
      if (url.pathname.startsWith('/api/public/content/') && req.method === 'GET') {
        const parts=url.pathname.slice('/api/public/content/'.length).split('/'); assert(parts.length===2&&['case','package','faq'].includes(parts[0])&&parts[1], 'Публикация не найдена',404);
        const agency=publicAgency(db,url); return sendJson(res,200,getPublishedContent(db,agency.id,parts[0],parts[1]));
      }
      if (url.pathname.startsWith('/api/public/assets/') && req.method === 'GET') {
        const id=url.pathname.slice('/api/public/assets/'.length); assert(id&&!id.includes('/'),'Изображение не найдено',404);
        return sendAsset(res,getPublicAsset(db,publicAgency(db,url).id,id));
      }

      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'POST') {
          requireCsrf(req);
          rateLimit(db, `http:${clientIp(req)}`, 600);
        }
        if (url.pathname === '/api/setup' && req.method === 'POST') {
          assert(!db.prepare('SELECT id FROM agencies LIMIT 1').get(), 'Настройка уже выполнена', 409);
          const result = bootstrap(db, await readJson(req));
          return sendJson(res, 201, { user: result.user }, { 'Set-Cookie': [cookie(SESSION_COOKIE, result.token, req, { httpOnly: true }), cookie(CSRF_COOKIE, cookies(req)[CSRF_COOKIE] || token(), req)] });
        }
        if (url.pathname === '/api/register' && req.method === 'POST') {
          const result = register(db, await readJson(req), clientIp(req));
          return sendJson(res, 201, { user: result.user }, { 'Set-Cookie': [cookie(SESSION_COOKIE, result.token, req, { httpOnly: true }), cookie(CSRF_COOKIE, cookies(req)[CSRF_COOKIE] || token(), req)] });
        }
        if (url.pathname === '/api/login' && req.method === 'POST') {
          const result = authenticate(db, await readJson(req), clientIp(req));
          return sendJson(res, 200, { user: result.user }, { 'Set-Cookie': [cookie(SESSION_COOKIE, result.token, req, { httpOnly: true }), cookie(CSRF_COOKIE, cookies(req)[CSRF_COOKIE] || token(), req)] });
        }
        if (url.pathname === '/api/logout' && req.method === 'POST') {
          const raw = cookies(req)[SESSION_COOKIE];
          if (raw) db.prepare('DELETE FROM sessions WHERE digest=?').run(digest(raw));
          return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', req, { httpOnly: true, clear: true }) });
        }
        if(url.pathname.startsWith('/api/v2/')) {
          const u=requireUser(db,req), q=Object.fromEntries(url.searchParams), path=url.pathname;
          if(req.method==='GET') {
            if(path==='/api/v2/publishing/microsite') return sendJson(res,200,getMicrosite(db,u,q.projectId));
            if(path==='/api/v2/publishing/microsite/preview') return sendJson(res,200,previewMicrosite(db,u,q.projectId));
            if(path==='/api/v2/publishing/content') return sendJson(res,200,listContent(db,u,q.kind,q));
            if(path==='/api/v2/publishing/home') return sendJson(res,200,getPublicHome(db,u));
            if(path.startsWith('/api/v2/publishing/assets/')) { const id=path.slice('/api/v2/publishing/assets/'.length); assert(id&&!id.includes('/'),'Изображение не найдено',404); return sendAsset(res,getPrivateAsset(db,u,id),{'Cache-Control':'no-store, private'}); }
            if(path==='/api/v2/workflow/tasks') return sendJson(res,200,workflow.listTasks(db,u,q));
            if(path.startsWith('/api/v2/workflow/tasks/')) return sendJson(res,200,workflow.getTask(db,u,{...q,id:path.slice('/api/v2/workflow/tasks/'.length)}));
            if(path==='/api/v2/workflow/approvals') return sendJson(res,200,workflow.listApprovals(db,u,q));
            if(path.startsWith('/api/v2/workflow/approvals/')) return sendJson(res,200,workflow.getApproval(db,u,{...q,id:path.slice('/api/v2/workflow/approvals/'.length)}));
            if(path==='/api/v2/workflow/template-preview') return sendJson(res,200,workflow.previewTemplateApplication(db,u,q));
            if(path==='/api/v2/workflow/reschedule-preview') return sendJson(res,200,workflow.previewReschedule(db,u,q));
            if(path==='/api/v2/workflow/budget-preview') return sendJson(res,200,workflow.previewBudgetApplication(db,u,q));
            if(path==='/api/v2/guests')return sendJson(res,200,guestList(db,u,q.projectId,q.guestTableId,q));
            if(path==='/api/v2/invites')return sendJson(res,200,guestInvites(db,u,q.projectId,q.guestTableId));
            if(path==='/api/v2/seating')return sendJson(res,200,seatingSnapshot(db,u,q.projectId,q.planId,q));
            if(path==='/api/v2/legacy-preview')return sendJson(res,200,legacySeatingPreview(db,u,q.projectId,q.guestTableId,q.columnId));
            if(path==='/api/v2/dashboard')return sendJson(res,200,dashboard(db,u,q));
            if(path==='/api/v2/calendar/events')return sendJson(res,200,calendar(db,u,q));
            if(path==='/api/v2/notifications')return sendJson(res,200,notifications(db,u,q));
            if(path==='/api/v2/notification-preferences')return sendJson(res,200,preferences(db,u));
            if(path==='/api/v2/members')return sendJson(res,200,{items:members(db,u,q.projectId)});
            if(path==='/api/v2/calendar/meeting'){const row=scoped(db,u,q.entityId,undefined,'meeting');requireAccess(db,u,'read',row.project_id,'calendar',row.id,null);return sendJson(res,200,row);}
          }
          if(req.method==='POST'&&path==='/api/v2/publishing/assets') {
            const input=await publicationAssetInput(req); return sendJson(res,201,await createPublicAsset(db,u,input));
          }
          if(req.method==='POST'&&path==='/api/v2/calendar/meeting-preview')return sendJson(res,200,previewMeeting(db,u,await readJson(req)));
        }
        if (url.pathname === '/api/state' && req.method === 'GET') return sendJson(res, 200, snapshot(db, requireUser(db, req), url.searchParams.get('project') || null));
        if (url.pathname === '/api/offline' && req.method === 'GET') {
          const project = url.searchParams.get('project'); assert(project, 'Укажите проект');
          return sendJson(res, 200, snapshot(db, requireUser(db, req), project, true));
        }
        if (url.pathname === '/api/command' && req.method === 'POST') return sendJson(res, 200, execute(db, requireUser(db, req), await readJson(req)));
        if (url.pathname === '/api/files' && req.method === 'POST') {
          const project = url.searchParams.get('project'); assert(project, 'Укажите проект');
          return sendJson(res, 201, upload(db, requireUser(db, req), project, await readJson(req)));
        }
        if (url.pathname.startsWith('/api/files/') && req.method === 'GET') {
          const id = url.pathname.slice('/api/files/'.length); assert(id && !id.includes('/'), 'Файл не найден', 404);
          const result = download(db, requireUser(db, req), id);
          res.writeHead(200, securityHeaders({ 'Content-Type': result.row.data.mime || 'application/octet-stream', 'Content-Length': result.content.length, 'Content-Disposition': `attachment; filename="${attachmentName(result.row.data.name)}"`, 'Cache-Control': 'no-store, private' }));
          return res.end(result.content);
        }
        throw new Fault('API-метод не найден', 404);
      }

      if (url.pathname.startsWith('/w/') && req.method === 'GET') {
        const shareId=url.pathname.slice('/w/'.length); assert(shareId&&!shareId.includes('/'),'Страница не найдена',404);
        const html=withPublicEntry(renderWeddingHtml(getPublishedMicrosite(db,shareId)),root);
        return sendHtml(res,200,html,{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'});
      }
      if (url.pathname === '/sitemap.xml' && req.method === 'GET') {
        const xml=sitemapXml(db,publicAgency(db,url).id); assert(xml,'Карта сайта пока недоступна',404);
        const data=Buffer.from(xml); res.writeHead(200,securityHeaders({'Content-Type':'application/xml; charset=utf-8','Content-Length':data.length,'Cache-Control':'no-store'})); return res.end(data);
      }
      if (['/','/stories','/services','/faq'].includes(url.pathname) || /^\/stories\/[^/]+$/.test(url.pathname)) {
        if (url.pathname==='/' && publicInfo(db,url.searchParams.get('agency')||'tie').notFound) { assert(existsSync(root), 'Сначала соберите интерфейс: npm run build', 503); return await serveStatic(req,res,root,url.pathname); }
        const agency=publicAgency(db,url), home=getPublishedHome(db,agency.id);
        // Until the first published main snapshot, preserve the legacy home shell.
        if (url.pathname==='/' && !home) { assert(existsSync(root), 'Сначала соберите интерфейс: npm run build', 503); return await serveStatic(req,res,root,url.pathname); }
        const content=['case','package','faq'].flatMap(kind=>listPublishedContent(db,agency.id,kind));
        const story=url.pathname.startsWith('/stories/') ? getPublishedContent(db,agency.id,'case',decodeURIComponent(url.pathname.slice('/stories/'.length))) : null;
        const page=story?'story':url.pathname==='/'?'home':url.pathname.slice(1);
        return sendHtml(res,200,renderAgencyHtml({agencyName:agency.name,page,content,domain:configuredDomain(db,agency.id),item:story,home}),{'Cache-Control':'no-store'});
      }

      assert(existsSync(root), 'Сначала соберите интерфейс: npm run build', 503);
      return await serveStatic(req, res, root, url.pathname);
    } catch (error) {
      const status = error instanceof Fault ? error.status : 500;
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Внутренняя ошибка сервера' : error.message, ...(error instanceof Fault && error.details !== undefined ? { details: error.details } : {}) });
      else res.destroy();
    }
  });
  server.db = db;
  const outboxTimer=setInterval(()=>{try{processOutbox(db)}catch{/* Leave durable work queued for retry; no private payload logging. */}},30000);outboxTimer.unref();
  server.on('close', () => { clearInterval(outboxTimer); try { db.close(); } catch { /* already closed */ } });
  return server;
}

export async function startServer(options = {}) {
  const host = options.host || process.env.HOST || '127.0.0.1';
  const port = Number(options.port ?? process.env.PORT ?? 4173);
  const allowRemote = options.allowRemote === true || process.env.TIE_ALLOW_REMOTE === '1';
  assert(['127.0.0.1', 'localhost', '::1'].includes(host) || (allowRemote && ['0.0.0.0', '::'].includes(host)), 'Внешняя привязка требует TIE_ALLOW_REMOTE=1; локальный запуск использует localhost');
  const server = createHttpServer(options);
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, resolveListen); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const server = await startServer();
  const address = server.address();
  console.log(`tie.event: http://localhost:${address.port}`);
}

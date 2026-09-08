import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer } from '../server/http.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tie-public-http-')), dist = join(root, 'dist'); mkdirSync(dist); mkdirSync(join(dist,'.vite')); mkdirSync(join(dist,'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>legacy shell</title>');
  writeFileSync(join(dist,'.vite','manifest.json'),JSON.stringify({'src/v2/public-entry.jsx':{src:'src/v2/public-entry.jsx',isEntry:true,file:'assets/guest.js',imports:['_guest.css']},'_guest.css':{file:'assets/guest.css',css:['assets/guest.css']}}));
  writeFileSync(join(dist,'assets','guest.js'),'export {}'); writeFileSync(join(dist,'assets','guest.css'),'.v2-rsvp{}');
  const server = createHttpServer({ dbPath: ':memory:', distDir: dist }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, jar = new Map();
  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {}); if (jar.size) headers.set('cookie', [...jar].map(([key,value]) => `${key}=${value}`).join('; '));
    const response = await fetch(base + path, { ...options, headers });
    for (const value of response.headers.getSetCookie()) { const first=value.split(';',1)[0], at=first.indexOf('='); jar.set(first.slice(0,at),decodeURIComponent(first.slice(at+1))); }
    return response;
  }
  async function json(path, options = {}) { const response=await request(path,options); return {response,body:await response.json()}; }
  const post=(path,body,{csrf=true,headers={}}={}) => json(path,{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':jar.get('tie_csrf')||''}:{}),...headers},body:JSON.stringify(body)});
  return { server, jar, request, json, post };
}

test('published wedding HTTP is private-to-draft, no-store, and revokes public asset URLs', async t => {
  const app=await fixture(t); await app.json('/api/public'); const setupFallback=await app.request('/'); assert.equal(setupFallback.status,200); assert.match(await setupFallback.text(),/legacy shell/);
  let result=await app.post('/api/setup',{slug:'tie',agencyName:'Tie',name:'Ada',email:'ada@example.test',password:'long-password-123'}); assert.equal(result.response.status,201);
  const legacyFallback=await app.request('/'); assert.equal(legacyFallback.status,200); assert.match(await legacyFallback.text(),/legacy shell/);
  result=await app.post('/api/command',{id:'public-http-project-001',op:'project.create',data:{name:'Лада и Никита',date:'2027-09-01'}}); const projectId=result.body.id;
  result=await app.post('/api/command',{id:'public-http-draft-001',op:'microsite.saveDraft',projectId,data:{draft:{coupleNames:'Лада и Никита',dateLabel:'1 сентября 2027'}}}); let site=result.body;
  assert.equal((await app.json(`/api/v2/publishing/microsite?projectId=${projectId}`)).response.status,200); assert.equal((await app.json(`/api/v2/publishing/microsite/preview?projectId=${projectId}`)).response.status,200); assert.equal((await app.json('/api/v2/publishing/content?kind=case')).response.status,200);
  const { default: sharp } = await import('sharp'); const png=await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();
  const form=new FormData(); form.set('projectId',projectId); form.set('ownerId',site.id); form.set('file',new Blob([png],{type:'image/png'}),'pair.png');
  const upload=await app.request('/api/v2/publishing/assets',{method:'POST',headers:{'x-csrf-token':app.jar.get('tie_csrf')},body:form}); assert.equal(upload.status,201); const staged=await upload.json();
  result=await app.post('/api/command',{id:'public-http-draft-002',op:'microsite.saveDraft',projectId,version:site.version,data:{draft:{...site.data.draft,gallery:[{assetId:staged.id,alt:'Пара',caption:'Церемония',order:0}]}}}); site=result.body;
  result=await app.post('/api/command',{id:'public-http-publish-001',op:'microsite.publish',projectId,version:site.version}); site=result.body;
  const page=await app.request(`/w/${site.data.shareId}`); assert.equal(page.status,200); const html=await page.text(); assert.match(html,/Лада и Никита/); assert.match(html,/assets\/guest\.js/); assert.match(html,/assets\/guest\.css/); assert.match(page.headers.get('cache-control'),/no-store/); assert.equal(page.headers.get('referrer-policy'),'no-referrer'); assert.match(page.headers.get('x-robots-tag'),/noindex/);
  const publicSite=await app.json(`/api/public/w/${site.data.shareId}`); assert.equal(publicSite.response.status,200); assert.equal(publicSite.body.revision.gallery[0].assetId,publicSite.body.revision.assetIds[0]); assert.doesNotMatch(JSON.stringify(publicSite.body),new RegExp(staged.id));
  const publicAssetId=publicSite.body.revision.assetIds[0]; const asset=await app.request(`/api/public/assets/${publicAssetId}`); assert.equal(asset.status,200); assert.equal(asset.headers.get('content-type'),'image/webp');
  result=await app.post('/api/command',{id:'public-http-unpublish-001',op:'microsite.unpublish',projectId,version:site.version}); assert.equal(result.response.status,200);
  assert.equal((await app.request(`/api/public/assets/${publicAssetId}`)).status,404); assert.equal((await app.request(`/w/${site.data.shareId}`)).status,404);
});

test('publishing uploads require staff CSRF and staff cookies never become guest sessions', async t => {
  const app=await fixture(t); await app.json('/api/public');
  let result=await app.post('/api/setup',{slug:'tie',agencyName:'Tie',name:'Ada',email:'ada@example.test',password:'long-password-123'}); assert.equal(result.response.status,201);
  const noCsrf=await app.post('/api/v2/publishing/assets',{ownerId:'missing',content:'AA=='},{csrf:false}); assert.equal(noCsrf.response.status,403);
  const guestContext=await app.json('/api/public/rsvp/context?shareId=not-a-real-share-id'); assert.equal(guestContext.response.status,403); assert.equal(app.jar.has('tie_guest_session'),false);
  const crossOrigin=await app.request('/api/public/rsvp/exchange',{method:'POST',headers:{'content-type':'application/json',origin:'https://attacker.example'},body:JSON.stringify({shareId:'not-a-real-share-id',token:'x'.repeat(32)})}); assert.equal(crossOrigin.status,403);
});

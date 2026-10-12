import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,entity,entities} from '../server/db.mjs';
import {grant} from '../server/auth.mjs';
import {bootstrap,execute,snapshot} from '../server/service.mjs';
import {createHttpServer} from '../server/http.mjs';
import {getPublicAsset} from '../server/v2/publishing/index.mjs';
import {uploadVendorPhoto,getVendorPhoto} from '../server/vendor-profile.mjs';
import {normalizeVendorLinks,vendorLinks,vendorMatchesQuery,vendorDraftFromCatalog} from '../src/vendor-profile.js';
import {registerTestUser} from './fixtures/account.mjs';

let sequence=0;
const run=(db,user,op,body={})=>execute(db,user,{id:`vendor-profile-test-${++sequence}`,op,...body});
const links=[{title:'Instagram',url:'https://instagram.com/example',comment:'Основное портфолио'},{title:'Website',url:'https://example.test/prices',comment:'Цены и пакеты'},{title:'Telegram',url:'https://t.me/example',comment:'Быстрая связь'}];
function fixture(t){const db=openDatabase(':memory:');t.after(()=>db.close());const user=bootstrap(db,{slug:'tie',agencyName:'Тест',name:'Админ',email:'owner@example.test',password:'vendor-test-password'}).user;const project=run(db,user,'project.create',{data:{name:'Тестовая свадьба',date:'2027-06-12'}});return{db,user,project};}
const create=(db,user,kind,data,projectId=null)=>run(db,user,'entity.create',{kind,projectId,data});
const edit=(db,user,row,data)=>run(db,user,'entity.edit',{entityId:row.id,projectId:row.project_id,version:row.version,data});
function member(db,user,projectId,key='couple'){const account=registerTestUser(db,{slug:'tie',name:'Тестовый участник',email:`member-${++sequence}@example.test`,password:'vendor-member-password'}).user;const role=db.prepare('SELECT id FROM roles WHERE agency_id=? AND key=?').get(user.agency_id,key);grant(db,account,role.id,projectId);return account;}
const image=()=>sharp({create:{width:32,height:24,channels:3,background:'#ad4d70'}}).png().toBuffer();

test('vendor links preserve legacy portfolio, validate safe URLs and omit private notes from wedding drafts',()=>{
  assert.deepEqual(normalizeVendorLinks(links),links);
  assert.equal(vendorLinks({portfolio:links[0].url,links}).length,3);
  assert.equal(vendorLinks({portfolio:'https://legacy.test'}).length,1);
  for(const url of ['javascript:alert(1)','data:text/html,test','ftp://example.test','https://login:password@example.test','bad address'])assert.throws(()=>normalizeVendorLinks([{url}]));
  assert.throws(()=>normalizeVendorLinks(Array(21).fill(links[0])));
  assert.throws(()=>normalizeVendorLinks([{...links[0],comment:'x'.repeat(1001)}]));
  const draft=vendorDraftFromCatalog({id:'catalog-id',data:{name:'Фотограф',links,photoId:'photo',price:125050,notes:'Только агентству'}});
  assert.equal(draft.vendorId,'catalog-id');assert.equal(draft.price,125050);assert.equal(draft.photoId,'photo');assert.deepEqual(draft.links,links);assert.equal(draft.notes,undefined);
});

test('agency search matches Cyrillic tokens, email, link metadata and both Russian phone prefixes',()=>{
  const vendor={data:{name:'Пётр Соколов',contact:'Связь: +7 (999) 123-45-67, p@example.test; запасной +7 900 000-00-00',services:'Фото и видео',links}};
  for(const query of ['петр соколов','соколов фото','p@example.test','Основное портфолио','example.test/prices','8 (999) 123-45-67','79991234567','123-45-67'])assert.equal(vendorMatchesQuery(vendor,query),true,query);
  assert.equal(vendorMatchesQuery(vendor,'99999999'),false);assert.equal(vendorMatchesQuery(vendor,'другой фотограф'),false);
});

test('multiple links persist in catalog and wedding; duplicate assignment rolls back and choice remains editable by couple',t=>{
  const {db,user,project}=fixture(t),vendor=create(db,user,'vendor',{name:'Пётр Соколов',contact:'+79991234567',links,price:125050,notes:'Внутреннее'});
  assert.equal(vendor.data.portfolio,links[0].url);
  const selected=create(db,user,'selection',{title:vendor.data.name,vendorId:vendor.id,price:vendor.data.price},project.id);
  assert.deepEqual(selected.data.links,links);assert.equal(selected.data.notes,undefined);
  assert.deepEqual(snapshot(db,user,project.id).entities.find(row=>row.id===selected.id).data.links,links);
  const before=entities(db,user.agency_id,project.id,'selection').length;
  assert.throws(()=>create(db,user,'selection',{title:'Дубль',vendorId:vendor.id,selected:true,price:125050},project.id),e=>e.status===409);
  assert.equal(entities(db,user.agency_id,project.id,'selection').length,before);
  assert.throws(()=>edit(db,user,vendor,{links:[{url:'javascript:alert(1)'}]}),e=>e.status===400);
  assert.equal(entity(db,vendor.id).version,vendor.version);
  const couple=member(db,user,project.id),chosen=edit(db,couple,selected,{selected:true});
  assert.equal(chosen.data.selected,true);assert.deepEqual(chosen.data.links,links);
  assert.throws(()=>edit(db,couple,chosen,{links:[]}),e=>e.status===403);
  const without=edit(db,user,vendor,{links:[]});assert.equal(without.data.portfolio,'');assert.deepEqual(entity(db,selected.id).data.links,links);
});

test('private photos persist and copy from agency to wedding; removal restores placeholder without breaking the other card',async t=>{
  const {db,user,project}=fixture(t),photo=await uploadVendorPhoto(db,user,{content:await image()}),vendor=create(db,user,'vendor',{name:'Фотограф',photoId:photo.id,links});
  assert.equal(photo.mime,'image/webp');assert.equal(photo.width,32);
  const metadata=await sharp(getVendorPhoto(db,user,photo.id,vendor.id).content).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.exif,undefined);
  assert.throws(()=>getPublicAsset(db,user.agency_id,photo.id),e=>e.status===404);
  const selected=create(db,user,'selection',{title:'Фотограф',vendorId:vendor.id,price:100000},project.id),couple=member(db,user,project.id);
  assert.equal(selected.data.photoId,photo.id);assert.equal(getVendorPhoto(db,couple,photo.id,selected.id).mime,'image/webp');
  assert.throws(()=>getVendorPhoto(db,couple,photo.id,vendor.id),e=>e.status===403);
  assert.throws(()=>getVendorPhoto(db,couple,photo.id),e=>e.status===404);
  assert.equal(snapshot(db,couple,project.id).entities.find(row=>row.id===selected.id).data.photoId,photo.id);
  await assert.rejects(()=>uploadVendorPhoto(db,couple,{projectId:project.id,entityId:selected.id,content:Buffer.from('bad')}),e=>e.status===403);
  const cleared=edit(db,user,selected,{photoId:null});assert.equal(cleared.data.photoId,null);assert.throws(()=>getVendorPhoto(db,couple,photo.id,selected.id),e=>e.status===404);
  assert.equal(getVendorPhoto(db,user,photo.id,vendor.id).mime,'image/webp');
  assert.throws(()=>edit(db,user,cleared,{photoId:false}),e=>e.status===400);
});

test('photos reject corrupt formats/oversize and recheck revoked permissions after asynchronous decoding',async t=>{
  const {db,user}=fixture(t),content=await image();
  await assert.rejects(()=>uploadVendorPhoto(db,user,{content:Buffer.from('<svg></svg>')}),e=>e.status===400);
  await assert.rejects(()=>uploadVendorPhoto(db,user,{content:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])}),e=>e.status===400);
  await assert.rejects(()=>uploadVendorPhoto(db,user,{content:Buffer.alloc(5*1024*1024+1)}),e=>e.status===413);
  assert.equal(db.prepare("SELECT count(*) n FROM published_assets WHERE revision_id='vendor-photo'").get().n,0);
  const organizer=member(db,user,null,'organizer'),pending=uploadVendorPhoto(db,organizer,{content});
  db.prepare('DELETE FROM grants WHERE user_id=?').run(organizer.id);
  await assert.rejects(()=>pending,e=>e.status===403);
  assert.equal(db.prepare("SELECT count(*) n FROM published_assets WHERE revision_id='vendor-photo'").get().n,0);
});

test('photo access is bounded by agency, project and exact field even with stale user objects',async t=>{
  const {db,user,project}=fixture(t),other=run(db,user,'project.create',{data:{name:'Другая свадьба',date:'2027-06-13'}}),photo=await uploadVendorPhoto(db,user,{projectId:project.id,content:await image()});
  assert.throws(()=>create(db,user,'selection',{title:'Чужая фотография',photoId:photo.id},other.id),e=>e.status===403);
  const vendor=create(db,user,'selection',{title:'Тестовое фото',photoId:photo.id},project.id),reader=member(db,user,project.id,'contractor');
  db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run(JSON.stringify({sections:['vendors'],rows:[vendor.id],fields:['title']}),reader.id);
  assert.throws(()=>getVendorPhoto(db,reader,photo.id,vendor.id),e=>e.status===403);
  db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run(JSON.stringify({sections:['vendors'],rows:[vendor.id],fields:['photoId']}),reader.id);
  assert.equal(getVendorPhoto(db,reader,photo.id,vendor.id).mime,'image/webp');
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(reader.id);assert.throws(()=>getVendorPhoto(db,reader,photo.id,vendor.id),e=>e.status===401||e.status===403);
  db.prepare("INSERT INTO agencies(id,slug,name,settings) VALUES('other-agency','other','Other','{}')").run();
  db.prepare("INSERT INTO users(id,agency_id,email,name,password,protected) VALUES('other-owner','other-agency','other@example.test','Другой админ',?,1)").run(db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password);
  const outsider=db.prepare("SELECT * FROM users WHERE id='other-owner'").get();
  assert.throws(()=>getVendorPhoto(db,outsider,photo.id,vendor.id),e=>e.status===404);
});

test('HTTP photos require authenticated CSRF upload, stay private and return normalized image bytes',async t=>{
  const root=mkdtempSync(join(tmpdir(),'tie-vendor-http-')),dist=join(root,'dist');mkdirSync(dist);writeFileSync(join(dist,'index.html'),'<title>Test</title>');
  const server=createHttpServer({dbPath:':memory:',distDir:dist});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,jar=new Map();
  async function request(path,options={}){const headers=new Headers(options.headers);if(jar.size)headers.set('cookie',[...jar].map(([k,v])=>`${k}=${v}`).join('; '));const response=await fetch(base+path,{...options,headers});for(const cookie of response.headers.getSetCookie()){const [k,v]=cookie.split(';',1)[0].split('=');jar.set(k,v);}return response;}
  const post=(path,body,csrf=true)=>request(path,{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':jar.get('tie_csrf')||''}:{})},body:JSON.stringify(body)});
  await request('/api/public');assert.equal((await post('/api/setup',{slug:'tie',agencyName:'Test',name:'Test',email:'owner@example.test',password:'vendor-http-password'})).status,201);
  const content=(await image()).toString('base64');assert.equal((await post('/api/vendor-photos',{content},false)).status,403);
  assert.equal((await post('/api/vendor-photos',{content:'invalid'})).status,400);
  const uploaded=await post('/api/vendor-photos',{content});assert.equal(uploaded.status,201);const asset=await uploaded.json();
  const saved=await post('/api/command',{id:'vendor-http-create',op:'entity.create',kind:'vendor',data:{name:'Тестовый подрядчик',photoId:asset.id,links}});assert.equal(saved.status,200);const row=await saved.json();
  const path=`/api/vendor-photos/${asset.id}?entityId=${row.id}`,response=await request(path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.match(response.headers.get('cache-control'),/no-store.*private/);assert.equal((await response.arrayBuffer()).byteLength>0,true);
  assert.equal((await request(`/api/public/assets/${asset.id}`)).status,404);
  const removed=await post('/api/command',{id:'vendor-http-photo-remove',op:'entity.edit',entityId:row.id,version:row.version,data:{photoId:null}});assert.equal(removed.status,200);assert.equal((await request(path)).status,404);
  await post('/api/logout',{});assert.equal((await request(path)).status,401);
});

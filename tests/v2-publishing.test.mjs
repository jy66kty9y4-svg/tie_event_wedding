import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, entity, uid } from '../server/db.mjs';
import { bootstrap, execute, register, upload } from '../server/service.mjs';
import { executeModule } from '../server/v2/common.mjs';
import { migrate, operations, createPublicAsset, getPublicAsset, getMicrosite, getPublishedMicrosite, getPublishedContent, getPublishedHome, listPublishedContent, previewMicrosite, renderAgencyHtml, renderWeddingHtml, sitemapXml } from '../server/v2/publishing/index.mjs';

function fixture() {
  const db = openDatabase(':memory:');
  const login = bootstrap(db, { slug: 'tie', agencyName: 'Tie', name: 'Админ', email: 'admin@example.test', password: 'long-password-123' });
  migrate(db);
  return { db, user: login.user };
}
let commandNumber = 0;
function command(db, user, op, body = {}) { return executeModule(db, user, { id: `publishing-${++commandNumber}-command`, op, ...body }, operations); }
function project(db, user) { return execute(db, user, { id: `base-project-${++commandNumber}`, op: 'project.create', data: { name: 'Лена и Олег', date: '2027-09-14' } }); }

test('microsite keeps drafts private and exposes only an immutable published snapshot', () => {
  const { db, user } = fixture(); const p = project(db, user);
  let site = command(db, user, 'microsite.saveDraft', { projectId: p.id, data: { draft: { template: 'plum', coupleNames: 'Лена и Олег', dateLabel: '14 сентября 2027', intro: '<script>private</script>', schedule: [{ time: '15:00', title: 'Сбор гостей' }] }, rsvpDeadline: '2027-09-01' } });
  assert.equal(site.data.status, 'draft');
  assert.throws(() => getPublishedMicrosite(db, site.data.shareId), /недоступна/);
  site = command(db, user, 'microsite.publish', { projectId: p.id, version: site.version });
  const publicSite = getPublishedMicrosite(db, site.data.shareId);
  assert.equal(publicSite.revision.coupleNames, 'Лена и Олег');
  assert.equal(Object.hasOwn(publicSite.revision, 'shareId'), false);
  assert.equal(Object.hasOwn(publicSite.revision, 'rsvpDeadline'), false);
  const revisionId = site.data.publishedRevisionId;
  const published = entity(db, revisionId);
  assert.equal(published.data.displayFields.intro, '<script>private</script>');
  site = command(db, user, 'microsite.saveDraft', { projectId: p.id, version: site.version, data: { draft: { ...site.data.draft, intro: 'Новый текст' } } });
  assert.equal(getPublishedMicrosite(db, site.data.shareId).revision.intro, '<script>private</script>');
  assert.match(renderWeddingHtml(publicSite), /&lt;script&gt;private&lt;\/script&gt;/);
  assert.match(previewMicrosite(db, user, p.id).html, /Новый текст/);
  assert.equal(getMicrosite(db, user, p.id).data.dirty, true);
});

test('unpublish and rotate revoke prior wedding URL while creating a fresh revision', () => {
  const { db, user } = fixture(); const p = project(db, user);
  let site = command(db, user, 'microsite.saveDraft', { projectId: p.id, data: { draft: { coupleNames: 'Аня и Миша', dateLabel: '1 июня 2027' } } });
  site = command(db, user, 'microsite.publish', { projectId: p.id, version: site.version }); const oldShare = site.data.shareId; const oldRevision = site.data.publishedRevisionId;
  site = command(db, user, 'microsite.rotateShareId', { projectId: p.id, version: site.version });
  assert.notEqual(site.data.shareId, oldShare); assert.notEqual(site.data.publishedRevisionId, oldRevision);
  assert.throws(() => getPublishedMicrosite(db, oldShare), /недоступна/);
  assert.equal(getPublishedMicrosite(db, site.data.shareId).revision.coupleNames, 'Аня и Миша');
  site = command(db, user, 'microsite.unpublish', { projectId: p.id, version: site.version });
  assert.equal(site.data.status, 'unpublished'); assert.throws(() => getPublishedMicrosite(db, site.data.shareId), /недоступна/);
});

test('agency content starts as drafts, guards slugs, and publishes an immutable public revision', () => {
  const { db, user } = fixture();
  let story = command(db, user, 'publicContent.saveDraft', { data: { kind: 'case', draft: { title: 'Свадьба в соснах', slug: 'svadba-v-sosnah', summary: 'Подтверждённая агентством история', vendors: ['Фотограф'] } } });
  assert.throws(() => getPublishedContent(db, user.agency_id, 'case', 'svadba-v-sosnah'), /не найдена/);
  story = command(db, user, 'publicContent.publish', { entityId: story.id, version: story.version, data: { kind: 'case' } });
  const publicStory = getPublishedContent(db, user.agency_id, 'case', 'svadba-v-sosnah');
  assert.equal(publicStory.revision.title, 'Свадьба в соснах');
  const publishedVersion = story.data.publishedRevisionId;
  story = command(db, user, 'publicContent.saveDraft', { entityId: story.id, version: story.version, data: { kind: 'case', draft: { ...story.data.draft, summary: 'Новый черновик' } } });
  assert.equal(getPublishedContent(db, user.agency_id, 'case', 'svadba-v-sosnah').revision.summary, 'Подтверждённая агентством история');
  assert.equal(entity(db, publishedVersion).data.content.summary, 'Подтверждённая агентством история');
  assert.equal(listPublishedContent(db, user.agency_id, 'case').length, 1);
  assert.throws(() => command(db, user, 'publicContent.saveDraft', { data: { kind: 'case', draft: { title: 'Другое', slug: 'svadba-v-sosnah' } } }), /занят/);
});

test('SSR uses configured canonical only and sitemap contains published agency pages only', () => {
  const { db, user } = fixture();
  let story = command(db, user, 'publicContent.saveDraft', { data: { kind: 'case', draft: { title: 'История', slug: 'istoriya', summary: 'Текст' } } });
  story = command(db, user, 'publicContent.publish', { entityId: story.id, version: story.version, data: { kind: 'case' } });
  const before = renderAgencyHtml({ agencyName: 'tie', content: listPublishedContent(db, user.agency_id, 'case') });
  assert.doesNotMatch(before, /canonical/); assert.equal(sitemapXml(db, user.agency_id), null);
  command(db, user, 'publicContent.configureDomain', { data: { configuredDomain: 'weddings.example' } });
  const xml = sitemapXml(db, user.agency_id); assert.match(xml, /https:\/\/weddings\.example\/stories\/istoriya/); assert.doesNotMatch(xml, /\/w\//);
  const html = renderAgencyHtml({ agencyName: 'tie', page: 'stories', content: listPublishedContent(db, user.agency_id, 'case'), domain: 'weddings.example' });
  assert.match(html, /rel="canonical" href="https:\/\/weddings\.example\/stories"/);
  const publishedStory = getPublishedContent(db, user.agency_id, 'case', 'istoriya');
  const storyHtml = renderAgencyHtml({ agencyName: 'tie', page: 'story', item: publishedStory, domain: 'weddings.example' });
  assert.match(storyHtml, /<meta name="description" content="Текст">/); assert.match(storyHtml, /https:\/\/weddings\.example\/stories\/istoriya/); assert.match(storyHtml, /Кабинет/);
});

test('sitemap lists only routes with published content while retaining the reachable legacy root', () => {
  const { db, user } = fixture();
  command(db,user,'publicContent.configureDomain',{data:{configuredDomain:'weddings.example'}});
  let xml=sitemapXml(db,user.agency_id); assert.match(xml,/https:\/\/weddings\.example\//); assert.doesNotMatch(xml,/\/stories|\/services|\/faq/);
  let service=command(db,user,'publicContent.saveDraft',{data:{kind:'package',draft:{title:'Координация',slug:'coordination',summary:'Описание'}}});
  xml=sitemapXml(db,user.agency_id); assert.doesNotMatch(xml,/\/services/);
  service=command(db,user,'publicContent.publish',{entityId:service.id,version:service.version,data:{kind:'package'}});
  xml=sitemapXml(db,user.agency_id); assert.match(xml,/https:\/\/weddings\.example\/services/); assert.doesNotMatch(xml,/\/stories|\/faq/);
});

test('public raster assets are private until their owning revision is published', async () => {
  const { db, user } = fixture(); const p = project(db, user);
  let site = command(db, user, 'microsite.saveDraft', { projectId: p.id, data: { draft: { coupleNames: 'Ира и Кирилл', dateLabel: '8 августа 2027' } } });
  const { default: sharp } = await import('sharp');
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#e9d4d6' } }).png().toBuffer();
  const image = await createPublicAsset(db, user, { projectId: p.id, ownerId: site.id, content: png });
  assert.equal(image.mime, 'image/webp'); assert.throws(() => getPublicAsset(db, user.agency_id, image.id), /не найдено/);
  site = command(db, user, 'microsite.saveDraft', { projectId: p.id, version: site.version, data: { draft: { ...site.data.draft, gallery: [{ assetId: image.id, alt: 'Портрет пары', caption: 'Церемония', order: 0 }] } } });
  site = command(db, user, 'microsite.publish', { projectId: p.id, version: site.version });
  assert.throws(() => getPublicAsset(db, user.agency_id, image.id), /не найдено/);
  const publishedSite = getPublishedMicrosite(db, site.data.shareId); const publicAssetId = publishedSite.revision.assetIds[0]; const active = getPublicAsset(db, user.agency_id, publicAssetId); assert.equal(active.mime, 'image/webp'); assert.equal(active.active, 1); assert.equal(publishedSite.revision.gallery[0].assetId, publicAssetId); assert.match(renderWeddingHtml(publishedSite), new RegExp(`/api/public/assets/${publicAssetId}`)); assert.doesNotMatch(renderWeddingHtml(publishedSite), new RegExp(image.id));
  site = command(db, user, 'microsite.unpublish', { projectId: p.id, version: site.version });
  assert.throws(() => getPublicAsset(db, user.agency_id, publicAssetId), /не найдено/);
  site = command(db, user, 'microsite.publish', { projectId: p.id, version: site.version });
  assert.notEqual(getPublishedMicrosite(db, site.data.shareId).revision.assetIds[0], publicAssetId);
});

test('agency main has a separate immutable publication snapshot', () => {
  const { db, user } = fixture();
  let home = command(db, user, 'publicSite.saveMainDraft', { data: { draft: { heroTitle: 'Собранный день', heroText: 'Текст агентства', approach: 'Подход', steps: ['Знакомство'], benefits: ['Общий кабинет'], contactText: 'Связаться с агентством' } } });
  home = command(db, user, 'publicSite.publishMain', { version: home.version });
  assert.equal(getPublishedHome(db, user.agency_id).revision.heroTitle, 'Собранный день');
  home = command(db, user, 'publicSite.saveMainDraft', { version: home.version, data: { draft: { ...home.data.draft, heroTitle: 'Черновик' } } });
  assert.equal(getPublishedHome(db, user.agency_id).revision.heroTitle, 'Собранный день');
});

test('protected microsite blocks cannot hide RSVP and private image sources never enter revisions', async () => {
  const { db, user } = fixture(); const p = project(db,user);
  assert.throws(() => command(db,user,'microsite.saveDraft',{projectId:p.id,data:{draft:{coupleNames:'Нина и Борис',dateLabel:'2 мая 2027',blocks:[{id:'cover',visible:true},{id:'rsvp',visible:false},{id:'program',visible:true},{id:'directions',visible:true},{id:'contacts',visible:true},{id:'accommodation',visible:true},{id:'transport',visible:true},{id:'gallery',visible:true}]}}}),/нельзя скрыть/);
  let site=command(db,user,'microsite.saveDraft',{projectId:p.id,data:{draft:{coupleNames:'Нина и Борис',dateLabel:'2 мая 2027'}}});
  const {default:sharp}=await import('sharp'); const bytes=await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();
  const privateFile=upload(db,user,p.id,{name:'private.png',mime:'image/png',content:bytes.toString('base64')});
  const derivative=await createPublicAsset(db,user,{projectId:p.id,ownerId:site.id,privateFileId:privateFile.id});
  site=command(db,user,'microsite.saveDraft',{projectId:p.id,version:site.version,data:{draft:{...site.data.draft,assetIds:[derivative.id]}}});
  site=command(db,user,'microsite.publish',{projectId:p.id,version:site.version}); const revision=entity(db,site.data.publishedRevisionId);
  assert.equal(JSON.stringify(revision.data).includes(privateFile.id),false);
});

function restrictedUser(db, agencyId, projectId, restrictions) {
  const user=register(db,{slug:'tie',name:'Ограниченный',email:`limited-${uid()}@example.test`,password:'long-password-123'}).user;
  const roleId=uid(); db.prepare('INSERT INTO roles(id,agency_id,name,permissions,protected,key) VALUES(?,?,?,?,?,?)').run(roleId,agencyId,'Публикация',JSON.stringify(['read','create','edit','publishWeddingSite']),0,'limited-publishing');
  db.prepare('INSERT INTO grants(id,agency_id,user_id,role_id,project_id,restrictions) VALUES(?,?,?,?,?,?)').run(uid(),agencyId,user.id,roleId,projectId,JSON.stringify(restrictions));
  return user;
}

test('field-limited publishing grants cannot read, write, or replay full microsite payloads', () => {
  const {db,user:admin}=fixture(); const p=project(db,admin);
  const site=command(db,admin,'microsite.saveDraft',{projectId:p.id,data:{draft:{coupleNames:'Света и Роман',dateLabel:'7 июля 2027'}}});
  const limited=restrictedUser(db,admin.agency_id,p.id,{sections:['microsite'],rows:[site.id],fields:['status']});
  assert.throws(()=>getMicrosite(db,limited,p.id),/Недостаточно прав/);
  assert.throws(()=>executeModule(db,limited,{id:'limited-save-command-0001',op:'microsite.saveDraft',projectId:p.id,version:site.version,data:{draft:{...site.data.draft,intro:'Скрытый текст'}}},operations),/Недостаточно прав/);
  const replayUser=restrictedUser(db,admin.agency_id,p.id,{sections:['microsite'],rows:[site.id],fields:[]});
  const payload={id:'replay-field-revocation-0001',op:'microsite.saveDraft',projectId:p.id,version:site.version,data:{draft:{...site.data.draft,intro:'Сохранённый текст'}}};
  executeModule(db,replayUser,payload,operations);
  db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run(JSON.stringify({sections:['microsite'],rows:[site.id],fields:['status']}),replayUser.id);
  assert.throws(()=>executeModule(db,replayUser,payload,operations),/Недостаточно прав/);
});

test('private source from another project cannot become a publication asset', async () => {
  const {db,user}=fixture(); const first=project(db,user); const second=project(db,user);
  const site=command(db,user,'microsite.saveDraft',{projectId:first.id,data:{draft:{coupleNames:'Оля и Данил',dateLabel:'3 августа 2027'}}});
  const {default:sharp}=await import('sharp'); const bytes=await sharp({create:{width:1,height:1,channels:3,background:'#fff'}}).png().toBuffer();
  const foreign=upload(db,user,second.id,{name:'foreign.png',mime:'image/png',content:bytes.toString('base64')});
  await assert.rejects(()=>createPublicAsset(db,user,{projectId:first.id,ownerId:site.id,privateFileId:foreign.id}),/Запись не найдена/);
});

test('SSR renders ordered wedding blocks and complete published case/package fields only', () => {
  const wedding=renderWeddingHtml({revision:{template:'photo',coupleNames:'Лада & Никита',dateLabel:'1 сентября',dressCode:'Светлые тона',dressPalette:'Слива',transport:'Автобус в 14:00',assetIds:['public-cover'],gallery:[{assetId:'public-cover',alt:'Пара у сада',caption:'Церемония',order:0},{assetId:'public-gallery',alt:'Столы в саду',caption:'Ужин',order:1}],blocks:[{id:'transport',visible:true},{id:'cover',visible:true},{id:'gallery',visible:true},{id:'rsvp',visible:true}]}});
  assert(wedding.indexOf('<h2>Трансфер</h2>') < wedding.indexOf('<h1>Лада &amp; Никита</h1>')); assert.match(wedding,/Дресс-код: Светлые тона/); assert.match(wedding,/Палитра: Слива/); assert.match(wedding,/\/api\/public\/assets\/public-gallery/); assert.match(wedding,/alt="Столы в саду"/); assert.match(wedding,/Церемония/);
  const preview=renderWeddingHtml({revision:{template:'light',coupleNames:'Лада',dateLabel:'1',assetIds:['private-stage'],blocks:[{id:'cover',visible:true},{id:'rsvp',visible:true}]}},{preview:true}); assert.match(preview,/\/api\/v2\/publishing\/assets\/private-stage/);
  const story={id:'case-1',kind:'case',slug:'garden',revision:{title:'Садовая история',summary:'Опубликованный & текст',city:'Тверь',venue:'Сад',season:'Лето',year:'2027',guestCount:42,budgetNote:'по запросу',challenge:'Задача',solutions:'Решение',result:'Результат',vendors:['Фотограф'],vendorsApproved:true,photoCredits:'Автор',serviceIds:['package-1'],gallery:[{assetId:'case-image',alt:'Садовая церемония',caption:'Кадр',order:0}]}};
  const service={id:'package-1',kind:'package',slug:'coordination',revision:{title:'Координация',summary:'Описание',priceType:'from',priceAmount:12000,priceLabel:'за день',included:['План'],excluded:['Площадка'],outcome:'Итог',process:'Этапы'}};
  const storyHtml=renderAgencyHtml({agencyName:'tie',page:'story',item:story,content:[story,service],domain:'tie.example'}); assert.match(storyHtml,/\/api\/public\/assets\/case-image/); assert.match(storyHtml,/Гостей: 42/); assert.match(storyHtml,/Автор/); assert.match(storyHtml,/Координация/); assert.match(storyHtml,/Опубликованный &amp; текст/); assert.doesNotMatch(storyHtml,/черновик/);
  const servicesHtml=renderAgencyHtml({agencyName:'tie',page:'services',content:[service]}); assert.match(servicesHtml,/Что входит/); assert.match(servicesHtml,/Отдельно/); assert.match(servicesHtml,/12.*000 ₽/); assert.match(servicesHtml,/Итог/); assert.match(servicesHtml,/Этапы/);
});

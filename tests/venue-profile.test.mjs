import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {openDatabase,entity,entities,uid,insert,change} from '../server/db.mjs';
import {bootstrap,execute,snapshot,backfillVenueCatalog} from '../server/service.mjs';
import {grant} from '../server/auth.mjs';
import {registerTestUser} from './fixtures/account.mjs';
import {uploadVendorPhoto,getVendorPhoto} from '../server/vendor-profile.mjs';
import {normalizeVenue,venueRent,venueRentLabel,venueExtraLabel,venuePhotoIds,normalizeVenuePhotos,venueMapUrl} from '../src/venue-profile.js';
import {vendorDraftFromCatalog,vendorMatchesQuery} from '../src/vendor-profile.js';
const run=(db,u,op,body={})=>execute(db,u,{id:uid(),op,...body});
const create=(db,u,kind,data,projectId=null)=>run(db,u,'entity.create',{kind,data,projectId});
const edit=(db,u,row,data)=>run(db,u,'entity.edit',{projectId:row.project_id,entityId:row.id,version:row.version,data});
const example=()=>normalizeVenue({address:'Лесная, 1',website:'https://example.test/venue',rentMode:'days',rentDays:{mon:5000000,tue:5000000,wed:5000000,thu:7000000,fri:8000000,sat:12000000,sun:10000000},menuFrom:800000,deposit:30000000,depositKind:'minimum',extras:[{label:'Церемония',amount:1500000,required:true},{label:'Дом невесты',amount:1500000,required:true}],details:'Большое описание\n'.repeat(700)});
function fixture(t){const db=openDatabase(':memory:');t.after(()=>db.close());const u=bootstrap(db,{slug:'tie',agencyName:'Тест',name:'Админ',email:'admin@example.test',password:'venue-test-password'}).user;const project=run(db,u,'project.create',{data:{name:'Тестовая свадьба',date:'2027-06-12'}});const member=(key='couple',p=project.id)=>{const account=registerTestUser(db,{slug:'tie',name:'Участник',email:`${uid()}@example.test`,password:'venue-member-password'}).user;grant(db,account,db.prepare('SELECT id FROM roles WHERE key=?').get(key).id,p);return account};return{db,u,project,member}}
const png=()=>sharp({create:{width:80,height:50,channels:3,background:'#b01a1a'}}).png().toBuffer();

test('rent uses the open-date range, exact UTC weekday, manual override and missing tariff honestly',()=>{
  const d={venue:example()};assert.equal(venueRentLabel(d),'50 000–120 000 ₽');
  assert.equal(venueRent(d,'2027-06-12').min,12000000);assert.equal(venueRent(d,'2027-06-13').min,10000000);
  const partial={venue:{...d.venue,rentDays:{mon:0,sat:12000000}}};assert.equal(venueRent(partial).partial,true);assert.equal(venueRentLabel(partial,'2027-06-10'),'Нужно уточнить');assert.equal(venueRent(partial).min,0);
  assert.equal(venueRentLabel({venue:{...d.venue,rentOverride:4200000}},'2027-06-12'),'42 000 ₽');
  assert.equal(venueRentLabel({venue:normalizeVenue({rentMin:5000000})}),'от 50 000 ₽');assert.equal(venueRentLabel({venue:normalizeVenue({rentMax:9000000})}),'до 90 000 ₽');
});
test('validation bounds money, descriptions, URLs, deposit meaning and extra charges',()=>{
  assert.ok(example().details.length>8000);assert.equal(example().depositKind,'minimum');
  for(const data of [{rentMin:100,rentMax:50},{menuFrom:-1},{deposit:0.1},{rentDays:{mon:NaN}},{servicePercent:101},{website:'javascript:alert(1)'},{mapUrl:'https://user:pass@example.test'},{depositKind:'double'},{capacity:0},{extras:[{label:''}]},{details:'x'.repeat(30001)}])assert.throws(()=>normalizeVenue(data));
  assert.throws(()=>normalizeVenue({extraFrom:100,extras:[{label:'Церемония',amount:1500000,required:true}]}));
  const d={venue:example()};assert.equal(venueExtraLabel(d),'от 30 000 ₽');
  assert.equal(venueExtraLabel({venue:{extras:[]}}),'Нужно уточнить');assert.equal(venueExtraLabel({venue:{extraFrom:0}}),'Включены');
  assert.equal(venueExtraLabel({venue:{extras:[{label:'Стул',amount:30000,unit:'guest',required:true}]}}),'Зависит от гостей');
  assert.equal(venueExtraLabel({venue:{extras:[{amount:null,required:true}]}}),'Нужно уточнить');
  assert.match(venueMapUrl(d),/^https:\/\/www.google.com\/maps\/search\//);
});
test('gallery keeps legacy cover and order; source drafts omit private agency notes',()=>{
  assert.deepEqual(venuePhotoIds({photoId:'old'}),['old']);assert.deepEqual(venuePhotoIds({photoId:'old',photoIds:[]}),[]);
  assert.throws(()=>normalizeVenuePhotos(['same','same']));assert.throws(()=>normalizeVenuePhotos(Array.from({length:17},(_,i)=>String(i))));
  const original={id:'catalog',data:{name:'Веранда',venue:example(),photoIds:['a','b'],photoId:'a',notes:'Внутреннее',agencyCommission:123}};
  const draft=vendorDraftFromCatalog(original);assert.equal(draft.notes,undefined);assert.equal(draft.agencyCommission,undefined);draft.venue.rentDays.mon=10;assert.equal(original.data.venue.rentDays.mon,5000000);
  assert.equal(vendorMatchesQuery(original,'лесная'),true);
});
test('venue snapshots preserve gallery and prices across later catalog updates, couple choice and reload',async t=>{
  const {db,u,project,member}=fixture(t),a=await uploadVendorPhoto(db,u,{content:await png(),field:'photoIds'}),b=await uploadVendorPhoto(db,u,{content:await png(),field:'photoIds'});
  const vendor=create(db,u,'vendor',{name:'Веранда',venue:example(),photoId:a.id,photoIds:[a.id,b.id],notes:'Только агентство',price:10000000});
  const selection=create(db,u,'selection',{title:'Веранда',vendorId:vendor.id,price:vendor.data.price,agencyCommission:12345},project.id);
  assert.deepEqual(selection.data.venue,vendor.data.venue);assert.deepEqual(selection.data.photoIds,[a.id,b.id]);
  edit(db,u,vendor,{venue:{...vendor.data.venue,menuFrom:1000000},photoIds:[a.id],photoId:a.id});
  assert.equal(entity(db,selection.id).data.venue.menuFrom,800000);assert.deepEqual(entity(db,selection.id).data.photoIds,[a.id,b.id]);
  const couple=member(),state=snapshot(db,couple,project.id),visible=state.entities.find(row=>row.id===selection.id);
  assert.equal(visible.data.agencyCommission,undefined);assert.equal(visible.data.notes,undefined);assert.deepEqual(state.catalog,[]);
  assert.equal(getVendorPhoto(db,couple,b.id,selection.id).mime,'image/webp');
  assert.throws(()=>edit(db,couple,visible,{venue:{menuFrom:1}}),e=>e.status===403);
  const chosen=edit(db,couple,visible,{selected:true});assert.equal(chosen.data.selected,true);assert.equal(chosen.data.venue.menuFrom,800000);
});
test('gallery authorization follows exact fields, references and live grants; removal retains other cards',async t=>{
  const {db,u,project,member}=fixture(t),a=await uploadVendorPhoto(db,u,{projectId:project.id,content:await png(),field:'photoIds'}),b=await uploadVendorPhoto(db,u,{projectId:project.id,content:await png(),field:'photoIds'});
  const row=create(db,u,'selection',{title:'Галерея',venue:example(),photoId:a.id,photoIds:[a.id,b.id]},project.id),reader=member('contractor');
  db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run(JSON.stringify({sections:['vendors'],rows:[row.id],fields:['photoId']}),reader.id);
  assert.equal(getVendorPhoto(db,reader,a.id,row.id).mime,'image/webp');assert.throws(()=>getVendorPhoto(db,reader,b.id,row.id),e=>e.status===403);
  db.prepare('UPDATE grants SET restrictions=? WHERE user_id=?').run(JSON.stringify({sections:['vendors'],rows:[row.id],fields:['photoIds']}),reader.id);
  assert.equal(getVendorPhoto(db,reader,a.id,row.id).mime,'image/webp');assert.equal(getVendorPhoto(db,reader,b.id,row.id).mime,'image/webp');
  const reordered=edit(db,u,row,{photoId:b.id,photoIds:[b.id,a.id]});assert.equal(reordered.data.photoId,b.id);
  edit(db,u,reordered,{photoId:a.id,photoIds:[a.id]});assert.throws(()=>getVendorPhoto(db,reader,b.id,row.id),e=>e.status===404);
  assert.throws(()=>edit(db,u,entity(db,row.id),{photoIds:[]}),e=>e.status===400);
  const other=run(db,u,'project.create',{data:{name:'Другая',date:''}});assert.throws(()=>create(db,u,'selection',{title:'Чужое',photoIds:[a.id]},other.id),e=>e.status===403);
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(reader.id);assert.throws(()=>getVendorPhoto(db,reader,a.id,row.id),e=>[401,403].includes(e.status));
});
test('creating a wedding venue automatically links the catalog without private notes or wedding override',async t=>{
  const {db,u,project,member}=fixture(t),a=await uploadVendorPhoto(db,u,{projectId:project.id,content:await png(),field:'photoIds'});
  const row=create(db,u,'selection',{title:'Сохранить в базу',venue:{...example(),rentOverride:6000000},photoIds:[a.id],photoId:a.id,price:23000000,notes:'Для пары',agencyCommission:100000},project.id);
  assert.ok(row.data.vendorId,'Creation must already save the venue');
  assert.throws(()=>run(db,member(),'venue.saveToCatalog',{projectId:project.id,entityId:row.id,version:row.version}),e=>e.status===403);
  const command={id:uid(),op:'venue.saveToCatalog',projectId:project.id,entityId:row.id,version:row.version},saved=execute(db,u,command);assert.deepEqual(execute(db,u,command),saved);
  assert.equal(entity(db,row.id).data.vendorId,saved.id);assert.equal(saved.data.venue.rentOverride,null);assert.equal(entity(db,row.id).data.venue.rentOverride,6000000);assert.equal(saved.data.notes,'');assert.equal(saved.data.agencyCommission,undefined);
  assert.equal(getVendorPhoto(db,u,a.id,saved.id).mime,'image/webp');
  assert.equal(saved.data.price,null);assert.equal(entity(db,row.id).data.price,23000000);
  const other=run(db,u,'project.create',{data:{name:'Следующая пара',date:''}}),copy=create(db,u,'selection',{title:'Сохранить в базу',vendorId:saved.id},other.id);assert.deepEqual(copy.data.photoIds,[a.id]);assert.equal(copy.data.venue.rentOverride,null);
  assert.equal(run(db,u,'venue.saveToCatalog',{projectId:project.id,entityId:row.id,version:entity(db,row.id).version}).id,saved.id);assert.equal(entities(db,u.agency_id,null,'vendor').filter(x=>x.id===saved.id).length,1);
});
test('gallery upload normalizes JPEG/PNG/WebP/AVIF and metadata for Safari display',async t=>{
  const {db,u}=fixture(t),image=sharp({create:{width:70,height:40,channels:3,background:'#232322'}});
  for(const format of ['png','jpeg','webp','avif']){const content=await image.clone().toFormat(format).toBuffer(),asset=await uploadVendorPhoto(db,u,{content,field:'photoIds'});assert.equal(asset.mime,'image/webp');assert.equal(asset.width,70);assert.equal((await sharp(getVendorPhoto(db,u,asset.id).content).metadata()).format,'webp')}
  const large=await sharp({create:{width:2500,height:1500,channels:3,background:'#fff'}}).png().toBuffer(),resized=await uploadVendorPhoto(db,u,{content:large,field:'photoIds'});assert.equal(resized.width,1600);assert.equal(resized.height,960);
});

test('automatic catalog links are idempotent, reuse the same venue across weddings and preserve independent snapshots',t=>{
  const {db,u,project}=fixture(t),command={id:uid(),op:'entity.create',projectId:project.id,kind:'selection',data:{title:'Общая веранда',venue:example(),price:23000000}};
  const first=execute(db,u,command);assert.deepEqual(execute(db,u,command),first);
  const vendor=entity(db,first.data.vendorId),other=run(db,u,'project.create',{data:{name:'Другая свадьба',date:''}});
  const next=create(db,u,'selection',{title:'  Общая   веранда ',venue:{...example(),menuFrom:900000,website:'https://example.test/venue/#gallery'}},other.id);
  assert.equal(next.data.vendorId,vendor.id);assert.equal(entity(db,vendor.id).data.venue.menuFrom,800000);assert.equal(next.data.venue.menuFrom,900000);
  assert.throws(()=>create(db,u,'selection',{title:'Общая веранда',venue:example()},project.id),e=>e.status===409);
  assert.equal(entities(db,u.agency_id,null,'vendor').filter(row=>row.data.name==='Общая веранда').length,1);
  const company=create(db,u,'vendor',{name:'Будущая площадка',portfolio:'https://example.test/other-venue'});
  const plain=create(db,u,'selection',{title:'Будущая площадка'},other.id),converted=edit(db,u,plain,{venue:{...example(),website:'https://example.test/other-venue'}});assert.ok(converted.data.vendorId);assert.notEqual(converted.data.vendorId,company.id,'A different contractor category must not be mistaken for a venue');
});
test('catalog permissions cannot be bypassed by creating a wedding venue and denied saves are atomic',t=>{
  const {db,u,project,member}=fixture(t),limited=member('organizer');
  const before=entities(db,u.agency_id,project.id,'selection').length;
  assert.throws(()=>create(db,limited,'selection',{title:'Без доступа к базе',venue:example()},project.id),e=>e.status===403);
  assert.equal(entities(db,u.agency_id,project.id,'selection').length,before);assert.equal(entities(db,u.agency_id,null,'vendor').length,0);
});
test('startup backfill saves existing venues once, preserves every wedding field and leaves finances and deleted records alone',t=>{
  const {db,u,project}=fixture(t),ob=insert(db,u,'obligation',{title:'Старая площадка',agreed:23000000,priceKind:'amount'},project.id);
  const data={title:'Старая площадка',venue:{...example(),rentOverride:6000000},price:23000000,notes:'Личная заметка',agencyCommission:100000,selected:true,obligationId:ob.id};
  const first=insert(db,u,'selection',data,project.id),second=insert(db,u,'selection',{...data,selected:false,obligationId:null},project.id);
  const deleted=insert(db,u,'selection',{...data,title:'Удалённая'},project.id);change(db,u,deleted,deleted.data,true,'delete');
  const contractor=insert(db,u,'selection',{title:'Фотограф',selected:false},project.id);
  const legacy=insert(db,u,'selection',{title:'Площадка старого формата',categoryName:'Площадка',terms:'Условия старой площадки'},project.id);
  assert.deepEqual(backfillVenueCatalog(db),{linked:3});
  assert.equal(entity(db,entity(db,legacy.id).data.vendorId).data.venue.details,'Условия старой площадки');
  const linked=entity(db,first.id),vendor=entity(db,linked.data.vendorId);
  assert.deepEqual(linked.data,{...data,vendorId:vendor.id});assert.equal(entity(db,second.id).data.vendorId,vendor.id);assert.deepEqual(entity(db,ob.id),ob);
  assert.equal(vendor.data.price,null);assert.equal(vendor.data.venue.rentOverride,null);assert.equal(vendor.data.notes,'');assert.equal(vendor.data.agencyCommission,undefined);
  assert.deepEqual(entity(db,contractor.id),contractor);assert.equal(entity(db,deleted.id).data.vendorId,undefined);
  const auditCount=db.prepare('SELECT count(*) n FROM audit').get().n;assert.deepEqual(backfillVenueCatalog(db),{linked:0});assert.equal(db.prepare('SELECT count(*) n FROM audit').get().n,auditCount);
});

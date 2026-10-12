import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVenue,normalizeVenuePhotos,venuePhotoIds,venueRent,venueRentLabel,venueExtraLabel,venueMapUrl,venuePublicDraft,VENUE_DAYS} from '../src/venue-profile.js';
import {normalizeVendorLinks,vendorLinks,vendorMatchesQuery,vendorDraftFromCatalog,vendorPhotoUrl} from '../src/vendor-profile.js';

for(const [name,changes] of [
  ['malformed object',[]],['numeric text',{address:42}],['long address',{address:'x'.repeat(1001)}],['long details',{details:'x'.repeat(30001)}],
  ['bad capacity',{capacity:0}],['fractional capacity',{capacity:1.5}],['excessive capacity',{capacity:100001}],
  ['negative rent',{rentMin:-1}],['fractional rent',{rentMin:.5}],['unsafe rent',{rentMin:1e12+1}],['NaN rent',{rentMin:NaN}],['string rent',{rentMin:'100'}],
  ['reverse range',{rentMin:2,rentMax:1}],['unknown rent mode',{rentMode:'fixed'}],['malformed daily tariffs',{rentDays:[]}],['negative daily tariff',{rentDays:{sat:-1}}],
  ['unknown deposit',{depositKind:'bad'}],['excessive service',{servicePercent:101}],['negative service',{servicePercent:-1}],['NaN service',{servicePercent:NaN}],
  ['excessive extras',{extras:Array(41).fill({label:'Extra'})}],['missing extra name',{extras:[{label:' '}]}],['invalid extra unit',{extras:[{label:'Extra',unit:'week'}]}],
  ['nonboolean required flag',{extras:[{label:'Extra',required:'false'}]}],['understated extras',{extraFrom:100,extras:[{label:'Extra',amount:200}]}],['false free extras',{extraFrom:0,extras:[{label:'Unknown',amount:null}]}],
  ['unsafe website',{website:'javascript:alert(1)'}],['URL credentials',{mapUrl:'https://user:secret@example.test/'}],['incomplete website',{website:'https://'}]
])test(`venue rejects ${name}`,()=>assert.throws(()=>normalizeVenue(changes)));
test('venue normalization is idempotent, discards unrelated data and copies nested tariffs and extras',()=>{
  const original={rentMode:'days',rentDays:{mon:0,sat:12000000},menuFrom:0,servicePercent:0,depositKind:'included',extras:[{label:' Chairs ',amount:30000,unit:'guest',required:false}],privateNotes:'must not escape'},before=structuredClone(original),normalized=normalizeVenue(original);
  assert.deepEqual(normalizeVenue(normalized),normalized);assert.equal(normalized.privateNotes,undefined);assert.equal(normalized.rentDays.mon,0);assert.equal(normalized.menuFrom,0);assert.equal(normalized.extras[0].label,'Chairs');assert.deepEqual(original,before);
  normalized.extras[0].label='Other';assert.equal(original.extras[0].label,' Chairs ');assert.equal(normalizeVenue(null),null);
});
test('all seven rental weekdays are matched correctly and unknown dates retain an explicit range',()=>{
  const rentDays=Object.fromEntries(VENUE_DAYS.map(([day],i)=>[day,(i+1)*100])),data={venue:{rentMode:'days',rentDays}};
  for(let i=0;i<7;i++){const day=`2027-06-${String(14+i).padStart(2,'0')}`;assert.deepEqual(venueRent(data,day),{min:(i+1)*100,max:(i+1)*100,source:'date'});}
  assert.deepEqual(venueRent(data),{min:100,max:700,source:'days',partial:false});
  assert.equal(venueRent({venue:{rentMode:'days',rentDays:{mon:0}}}).partial,true);
  assert.equal(venueRent({venue:{...data.venue,rentOverride:0}},'2027-06-19').source,'override');assert.equal(venueRent({venue:{rentOverride:0}}).min,0);
  assert.equal(venueRent({venue:{rentMode:'days',rentDays:{mon:100}}},'2027-06-15').min,null);
  assert.equal(venueRentLabel({venue:{rentMin:100}}),'от 1 ₽');assert.equal(venueRentLabel({venue:{rentMax:200}}),'до 2 ₽');assert.equal(venueRentLabel({}),'Нужно уточнить');
});
test('required extra charges distinguish unknown, guest-dependent, included and fixed amounts',()=>{
  assert.equal(venueExtraLabel({}),'Нужно уточнить');assert.equal(venueExtraLabel({venue:{extraFrom:0}}),'Включены');
  assert.equal(venueExtraLabel({venue:{extras:[{required:true,amount:null,unit:'fixed'}]}}),'Нужно уточнить');
  assert.equal(venueExtraLabel({venue:{extras:[{required:true,amount:30000,unit:'guest'}]}}),'Зависит от гостей');
  assert.equal(venueExtraLabel({venue:{extras:[{required:true,amount:100,unit:'fixed'},{required:false,amount:900,unit:'fixed'}]}}),'от 1 ₽');
  assert.equal(venueExtraLabel({venue:{extras:[{required:true,amount:0,unit:'fixed'}]}}),'Включены');
});
test('photo galleries are bounded, distinct and independent while legacy photo IDs remain readable',()=>{
  for(const value of [null,{},[''],['x','x'],[23],['x'.repeat(121)],Array.from({length:17},(_,i)=>String(i))])assert.throws(()=>normalizeVenuePhotos(value));
  const ids=['a','b'],copy=normalizeVenuePhotos(ids);copy.push('c');assert.deepEqual(ids,['a','b']);
  assert.deepEqual(venuePhotoIds({photoId:'a'}),['a']);assert.deepEqual(venuePhotoIds({photoIds:['a','a','b'],photoId:'old'}),['a','b']);
  assert.equal(vendorPhotoUrl(null,'e'),'');assert.equal(vendorPhotoUrl('a/b','e&1'),'/api/vendor-photos/a%2Fb?entityId=e%261');
});
for(const url of ['javascript:alert(1)','data:text/html,test','ftp://example.test/a','//example.test/','not a url','https://user@example.test/','https://user:secret@example.test/'])test(`vendor link rejects unsafe address ${url}`,()=>assert.throws(()=>normalizeVendorLinks([{url}])));
test('vendor links enforce counts and text limits, preserve labels and deduplicate legacy portfolio display',()=>{
  for(const value of [null,{},Array(21).fill({url:'https://example.test'})])assert.throws(()=>normalizeVendorLinks(value));
  assert.throws(()=>normalizeVendorLinks([{url:'https://example.test',title:'x'.repeat(161)}]));assert.throws(()=>normalizeVendorLinks([{url:'https://example.test',comment:'x'.repeat(1001)}]));
  assert.deepEqual(normalizeVendorLinks([{url:' https://example.test/ ',title:' Unit ',comment:' Note '}]),[{url:'https://example.test/',title:'Unit',comment:'Note'}]);
  assert.equal(vendorLinks({portfolio:'https://example.test',links:[{url:'https://example.test'}]}).length,1);assert.equal(vendorLinks({portfolio:'https://example.test',links:[]})[0].title,'Портфолио');
});
test('catalog search folds Cyrillic and phone formats, searches addresses and named links, and requires every text word',()=>{
  const vendor={id:'v',data:{name:'Шёрвуд',contact:'Мария +7 (999) 123-45-67',venue:{address:'Москва, Берёзовая 10'},links:[{title:'Фото зала',url:'https://example.test/gallery',comment:'Зимняя свадьба'}]}};
  for(const q of ['шерВУД','москва березовая','фото зимняя','8 (999) 123-45-67','1234567',''])assert.equal(vendorMatchesQuery(vendor,q),true,q);
  for(const q of ['москва море','Новый подрядчик','5555','phone 1234567'])assert.equal(vendorMatchesQuery(vendor,q),false,q);
});
test('catalog drafts retain public venue data with owned nested arrays and omit wedding-specific money and notes',()=>{
  const vendor={id:'v',data:{name:'Unit',price:0,photoIds:['a'],venue:{rentDays:{mon:100}},agencyCommission:999,notes:'private',agreed:800}},draft=vendorDraftFromCatalog(vendor);
  assert.equal(draft.price,0);assert.equal(draft.vendorId,'v');assert.equal(draft.agencyCommission,undefined);assert.equal(draft.notes,undefined);assert.equal(draft.agreed,undefined);
  draft.venue.rentDays.mon=500;draft.photoIds.push('b');assert.equal(vendor.data.venue.rentDays.mon,100);assert.deepEqual(vendor.data.photoIds,['a']);
  assert.deepEqual(venuePublicDraft({data:{}}),{});assert.equal(venueMapUrl({venue:{mapUrl:'https://maps.example.test/'}}),'https://maps.example.test/');
  assert.match(venueMapUrl({venue:{address:'Москва & лес'}}),/query=%D0/);assert.equal(venueMapUrl({}),'');
});

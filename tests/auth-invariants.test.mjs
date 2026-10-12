import test from 'node:test';
import assert from 'node:assert/strict';
import {can,canHoldFunds,canUseTeamTiming,grant,requireAccess,withAuthorizationRead,createSession,userSession,digest,rateLimit,passwordHash,checkPassword,publicUser} from '../server/auth.mjs';
import {insert} from '../server/db.mjs';
import {unitDb} from './fixtures/unit-db.mjs';

const cases=[
  ['matching action, scope, row and field',{},'edit','p','budget','row','amount',true],
  ['another action',{},'delete','p','budget','row','amount',false],
  ['another project',{},'edit','other','budget','row','amount',false],
  ['agency operation with a project grant',{},'edit',null,'budget','row','amount',false],
  ['another section',{sections:['files']},'edit','p','budget','row','amount',false],
  ['section allow-list and omitted section',{sections:['budget']},'edit','p',undefined,'row','amount',false],
  ['matching section',{sections:['budget']},'edit','p','budget','row','amount',true],
  ['matching row',{rows:['row']},'edit','p','budget','row','amount',true],
  ['another row',{rows:['other']},'edit','p','budget','row','amount',false],
  ['row allow-list cannot authorize a row-less mutation',{rows:['row']},'edit','p','budget',null,'amount',false],
  ['row allow-list permits container visibility',{rows:['row']},'read','p','budget',undefined,undefined,true],
  ['matching field',{fields:['amount']},'edit','p','budget','row','amount',true],
  ['another field',{fields:['amount']},'edit','p','budget','row','secret',false],
  ['field allow-list cannot authorize a field-less mutation',{fields:['amount']},'edit','p','budget','row',null,false],
  ['all changed fields must be granted',{fields:['amount']},'edit','p','budget','row',['amount','secret'],false],
  ['all granted changed fields',{fields:['amount','note']},'edit','p','budget','row',['amount','note'],true],
  ['empty field set cannot bypass restriction',{fields:['amount']},'edit','p','budget','row',[],false],
  ['restricted role cannot change schema',{fields:['amount']},'structure','p','budget','row','amount',false],
  ['restricted role cannot read whole history',{rows:['row']},'history','p','budget','row','amount',false],
  ['restricted role cannot invite broader access',{rows:['row']},'invite','p','budget','row','amount',false]
];
for(const [name,limits,action,p,section,row,field,expected] of cases)test(`one authorization grant must satisfy ${name}`,t=>{
  const {db,member,role}=unitDb(t),permissions=['read','edit','finance','structure','history','invite'];
  grant(db,member,role(permissions),'p',limits);
  assert.equal(can(db,member,action,p,section,row,field),expected);
  if(!expected)assert.throws(()=>requireAccess(db,member,action,p,section,row,field),e=>e.status===403);
});
test('different grants cannot be combined into a broader action or multi-field write',t=>{
  const {db,member,role}=unitDb(t);
  grant(db,member,role(['read','edit']),'p',{fields:['a']});
  grant(db,member,role(['read','finance']),'p',{fields:['b']});
  assert.equal(can(db,member,['edit','finance'],'p','budget','row','a'),false);
  assert.equal(can(db,member,'edit','p','budget','row',['a','b']),false);
  assert.equal(can(db,member,'read','p','budget','row','a'),true);
  assert.equal(can(db,member,'read','p','budget','row','b'),true);
});
test('global grants reach own weddings; foreign agency roles and disabled principals never do',t=>{
  const {db,member,role,admin}=unitDb(t);
  grant(db,member,role(['read','edit']),null);
  assert.equal(can(db,member,'edit','p','budget'),true);assert.equal(can(db,member,'edit',null,'budget'),true);
  db.prepare('DELETE FROM grants WHERE user_id=?').run(member.id);
  grant(db,member,role(['read','edit'],null,'agency-b'),null);
  assert.equal(can(db,member,'read','p'),false);
  assert.equal(can(db,null,'read'),false);
  assert.equal(can(db,{...admin,disabled:1},'edit'),false);
});
test('nested authorization reads retain a bounded cache, including when a reader throws',t=>{
  const {db,member,role}=unitDb(t);grant(db,member,role(['read']),'p');
  assert.throws(()=>withAuthorizationRead(db,()=>{
    assert.equal(can(db,member,'read','p'),true);
    withAuthorizationRead(db,()=>assert.equal(can(db,member,'read','p'),true));
    throw new Error('reader failed');
  }),/reader failed/);
  db.prepare('DELETE FROM grants WHERE user_id=?').run(member.id);
  assert.equal(can(db,member,'read','p'),false);
});
test('team timing is hidden from couple and contractor grants even when they can read other timing rows',t=>{
  const {db,admin,member,roles}=unitDb(t);
  const table=insert(db,admin,'table',{key:'timing'},'p');
  const team=insert(db,admin,'row',{audience:'Команда',title:'Приватно'},'p',table.id);
  const pair=insert(db,admin,'row',{audience:'Пара',title:'Общее'},'p',table.id);
  for(const key of ['couple','contractor']) {
    db.prepare('DELETE FROM grants WHERE user_id=?').run(member.id);grant(db,member,roles.find(r=>r.key===key).id,'p');
    assert.equal(can(db,member,'read','p',table.id,team.id),false);
    assert.equal(can(db,member,'read','p',table.id,pair.id),true);
  }
  db.prepare('DELETE FROM grants WHERE user_id=?').run(member.id);grant(db,member,roles.find(r=>r.key==='organizer').id,'p');
  assert.equal(canUseTeamTiming(db,member,'p'),true);assert.equal(can(db,member,'read','p',table.id,team.id),true);
  assert.equal(canUseTeamTiming(db,member,'other'),false);
});
test('fund custody requires unrestricted staff finance access in the same project',t=>{
  const {db,member,roles,role}=unitDb(t);
  for(const [roleId,scope,limits,expected] of [
    [roles.find(r=>r.key==='couple').id,'p',{},false],
    [role(['finance']),'p',{},true], [role(['finance']),'other',{},false],
    [role(['finance']),'p',{rows:['r']},false], [role(['finance']),'p',{fields:['amount']},false],
    [role(['finance']),'p',{sections:['files']},false], [role(['finance']),null,{sections:['budget']},true]
  ]) {
    db.prepare('DELETE FROM grants WHERE user_id=?').run(member.id);grant(db,member,roleId,scope,limits);
    assert.equal(canHoldFunds(db,member,'p'),expected);
  }
});
test('sessions store only digests and fail after expiry, disablement or registry revocation',t=>{
  const {db,member}=unitDb(t),raw=createSession(db,member),hash=digest(raw);
  assert.equal(db.prepare('SELECT digest FROM sessions').get().digest,hash);
  assert.equal(userSession(db,raw).id,member.id);assert.equal(userSession(db,'not-a-session'),null);assert.equal(userSession(db,''),null);
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(member.id);assert.equal(userSession(db,raw),null);
  db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(member.id);
  db.prepare('UPDATE sessions SET expires=? WHERE digest=?').run(Date.now()-1,hash);assert.equal(userSession(db,raw),null);
  db.prepare('UPDATE sessions SET expires=? WHERE digest=?').run(Date.now()+60000,hash);
  db.prepare('UPDATE orbit_session_registry SET revoked_at=? WHERE digest=?').run(new Date().toISOString(),hash);assert.equal(userSession(db,raw),null);
});
test('same-device replacement is scoped to identity, address and agent and requires complete metadata',t=>{
  const {db,member,admin}=unitDb(t),a={clientIp:'192.0.2.1',userAgent:'Unit Browser'};
  const old=createSession(db,member,a),otherDevice=createSession(db,member,{...a,userAgent:'Other Browser'}),otherUser=createSession(db,admin,a);
  const fresh=createSession(db,member,a);
  assert.equal(userSession(db,old),null);assert.equal(userSession(db,fresh).id,member.id);
  assert.equal(userSession(db,otherDevice).id,member.id);assert.equal(userSession(db,otherUser).id,admin.id);
  const noMetadata=createSession(db,member),another=createSession(db,member);assert(userSession(db,noMetadata));assert(userSession(db,another));
});
test('rate limiting rejects the first excessive attempt without extending the lock and expires deterministically',t=>{
  const {db}=unitDb(t);t.mock.method(Date,'now',()=>1000000);
  for(let i=0;i<3;i++)rateLimit(db,'test-ip',3);
  const before=db.prepare('SELECT * FROM attempts WHERE key=?').get('test-ip');
  assert.throws(()=>rateLimit(db,'test-ip',3),e=>e.status===429);
  assert.deepEqual(db.prepare('SELECT * FROM attempts WHERE key=?').get('test-ip'),before);
  rateLimit(db,'other-ip',3);
  t.mock.method(Date,'now',()=>1900001);rateLimit(db,'test-ip',3);
  assert.equal(db.prepare('SELECT count FROM attempts WHERE key=?').get('test-ip').count,1);
});
test('passwords are salted, bounded, checked without coercion and omitted from public identity',()=>{
  const password='unit-password-12345',one=passwordHash(password),two=passwordHash(password);
  assert.notEqual(one,two);assert.equal(checkPassword(password,one),true);assert.equal(checkPassword('other-password',one),false);
  assert.equal(checkPassword(null,one),false);assert.equal(checkPassword('a'.repeat(257),one),false);
  for(const p of ['short','a'.repeat(257),null])assert.throws(()=>passwordHash(p),e=>e.status===400);
  const user={id:'u',name:'Unit',password:one};assert.deepEqual(publicUser(user),{id:'u',name:'Unit'});assert.equal(user.password,one);
});

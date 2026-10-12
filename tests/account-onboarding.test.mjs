import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,entity,uid} from '../server/db.mjs';
import {grant,userSession} from '../server/auth.mjs';
import {bootstrap,register,authenticate,snapshot,execute} from '../server/service.mjs';
import {createHttpServer} from '../server/http.mjs';
import {questionnaireQuestions} from '../src/questionnaire.js';
import {registerTestUser} from './fixtures/account.mjs';

const password='onboarding-test-password';
const answers=Object.fromEntries(questionnaireQuestions.map(({id})=>[id,id==='images'?['свечи/огни']:'Ответ пары']));
const command=(db,user,op,data={})=>execute(db,user,{id:uid(),op,...data});
const fails=(fn,status)=>assert.throws(fn,error=>error.status===status);
function fixture(t,path=':memory:'){
  const db=openDatabase(path);t.after(()=>{if(db.isOpen)db.close();});
  const owner=bootstrap(db,{slug:'tie',agencyName:'Tie',name:'Owner',email:'owner@example.test',password}).user;
  const wedding=command(db,owner,'project.create',{data:{name:'Анна и Иван',date:'2027-06-12'}});
  const user=register(db,{name:'Анна',email:'anna@example.test',phone:'89991234567',password}).user;
  return{db,owner,wedding,user};
}
const approve=({db,owner,wedding,user})=>{
  const entry=snapshot(db,user).onboarding;
  return command(db,owner,'account.approve',{entityId:entry.id,version:entry.version,weddingId:wedding.id});
};

test('signup waits for administrator approval and cannot bypass either stage',t=>{
  const f=fixture(t),{db,owner,wedding,user}=f;
  const state=snapshot(db,user),entry=state.onboarding;
  assert.equal(entry.status,'pending');assert.equal(entry.project,null);
  assert.deepEqual(state.projects,[]);assert.deepEqual(state.grants,[]);assert.deepEqual(state.global,[]);
  assert.equal(state.canManageUsers,false);assert.equal(state.users,undefined);
  assert.equal(authenticate(db,{identifier:user.email,password}).user.id,user.id);
  assert.equal(authenticate(db,{identifier:'89991234567',password}).user.id,user.id);
  fails(()=>snapshot(db,user,wedding.id),403);fails(()=>snapshot(db,user,wedding.id,true),403);
  fails(()=>command(db,user,'account.questionnaire',{entityId:entry.id,version:entry.version,answers}),409);
  fails(()=>command(db,user,'account.approve',{entityId:entry.id,version:entry.version,weddingId:wedding.id}),403);
  fails(()=>command(db,user,'application.create',{data:{name:'Skip',date:'2027-06-12',contact:user.email}}),403);
  fails(()=>command(db,user,'entity.edit',{entityId:entry.id,version:entry.version,data:{status:'complete'}}),403);
  fails(()=>command(db,owner,'entity.edit',{entityId:entry.id,version:entry.version,data:{status:'complete'}}),400);
  const role=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='couple'").get(user.agency_id);
  fails(()=>command(db,owner,'grants.save',{userId:user.id,grants:[{roleId:role.id,projectId:wedding.id}]}),409);
  const visible=snapshot(db,owner).users.find(row=>row.id===user.id);
  assert.equal(visible.onboarding.id,entry.id);assert.equal(visible.manageable,true);
});

test('approval assigns an existing wedding but grants no private access before complete answers',t=>{
  const f=fixture(t),{db,owner,wedding,user}=f;
  const other=command(db,owner,'project.create',{data:{name:'Другие',date:'2027-07-12'}});
  const before=db.prepare("SELECT count(*) AS n FROM entities WHERE kind='project'").get().n;
  const approved=approve(f);
  assert.equal(approved.data.status,'questionnaire');assert.equal(approved.data.approvedBy,owner.id);
  assert.equal(db.prepare("SELECT count(*) AS n FROM entities WHERE kind='project'").get().n,before);
  const state=snapshot(db,user);
  assert.deepEqual(state.onboarding.project,{id:wedding.id,version:wedding.version,name:'Анна и Иван',date:'2027-06-12'});
  assert.deepEqual(state.projects,[]);assert.deepEqual(state.grants,[]);
  fails(()=>snapshot(db,user,wedding.id),403);
  fails(()=>command(db,user,'account.questionnaire',{entityId:approved.id,version:approved.version,answers:{names:'Only names'}}),400);
  assert.equal(entity(db,approved.id).data.status,'questionnaire');
  fails(()=>command(db,user,'account.questionnaire',{entityId:approved.id,version:approved.version,answers:{...answers,images:[]}}),400);
  const body={id:uid(),op:'account.questionnaire',entityId:approved.id,version:approved.version,answers};
  const completed=execute(db,user,body);
  assert.equal(completed.data.status,'complete');assert.deepEqual(completed.data.questionnaire,answers);
  assert.ok(completed.data.questionnaireSubmittedAt);
  assert.deepEqual(execute(db,user,body),completed,'retrying the same submission is idempotent');
  assert.deepEqual(snapshot(db,user).projects.map(row=>row.id),[wedding.id]);
  assert.equal(snapshot(db,user,wedding.id).project.id,wedding.id);
  assert.equal(snapshot(db,user).grants[0].role_key,'couple');
  assert.deepEqual(snapshot(db,owner).users.find(row=>row.id===user.id).onboarding.questionnaire,answers);
  fails(()=>snapshot(db,user,other.id),403);
  fails(()=>command(db,user,'account.questionnaire',{entityId:completed.id,version:completed.version,answers}),409);
});

test('approval validates permissions, tenant, existing wedding, disabled account and versions atomically',t=>{
  const f=fixture(t),{db,owner,wedding,user}=f;
  const entry=snapshot(db,user).onboarding;
  const base={entityId:entry.id,version:entry.version,weddingId:wedding.id};
  const outsider=registerTestUser(db,{name:'Organizer',email:'organizer@example.test',password}).user;
  const role=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='organizer'").get(owner.agency_id);
  grant(db,outsider,role.id);
  fails(()=>command(db,outsider,'account.approve',base),403);
  const limitedRole=uid();db.prepare('INSERT INTO roles(id,agency_id,name,permissions,key) VALUES(?,?,?,?,?)').run(limitedRole,owner.agency_id,'Limited administrator','["read","access"]','limited-admin');
  db.prepare('DELETE FROM grants WHERE user_id=?').run(outsider.id);grant(db,outsider,limitedRole);
  fails(()=>command(db,outsider,'account.approve',base),403,'access permission cannot assign a role exceeding the administrator permissions');
  fails(()=>command(db,owner,'account.approve',{...base,weddingId:'missing'}),404);
  const otherAgency=uid();db.prepare("INSERT INTO agencies(id,slug,name,settings) VALUES(?,?,?,?)").run(otherAgency,'other','Other','{}');
  const foreignWedding=uid();
  db.prepare("INSERT INTO entities(id,agency_id,kind,data,updated_at) VALUES(?,?,?,?,?)").run(foreignWedding,otherAgency,'project',JSON.stringify({name:'Other',date:'2027-06-12'}),new Date().toISOString());
  fails(()=>command(db,owner,'account.approve',{...base,weddingId:foreignWedding}),404);
  fails(()=>command(db,owner,'account.approve',{...base,version:0}),409);
  db.prepare('UPDATE entities SET deleted=1 WHERE id=?').run(wedding.id);
  fails(()=>command(db,owner,'account.approve',base),409);
  db.prepare('UPDATE entities SET deleted=0 WHERE id=?').run(wedding.id);
  db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(user.id);
  fails(()=>command(db,owner,'account.approve',base),409);
  db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(user.id);
  assert.equal(entity(db,entry.id).data.status,'pending');
  assert.equal(db.prepare('SELECT count(*) AS n FROM grants WHERE user_id=?').get(user.id).n,0);
  approve(f);
  fails(()=>command(db,owner,'account.approve',base),409);
});

test('questionnaire ownership and revoked or deleted assignments are enforced',t=>{
  const f=fixture(t),{db,owner,wedding,user}=f,approved=approve(f);
  const second=register(db,{name:'Other',email:'other@example.test',phone:'+79991234568',password}).user;
  const submit={entityId:approved.id,version:approved.version,answers};
  fails(()=>command(db,second,'account.questionnaire',submit),403);
  fails(()=>command(db,owner,'account.questionnaire',submit),403);
  db.prepare('UPDATE entities SET deleted=1 WHERE id=?').run(wedding.id);
  fails(()=>command(db,user,'account.questionnaire',submit),409);
  assert.equal(snapshot(db,user).onboarding.project,null);
  db.prepare('UPDATE entities SET deleted=0 WHERE id=?').run(wedding.id);
  db.prepare('DELETE FROM grants WHERE user_id=?').run(user.id);
  fails(()=>command(db,user,'account.questionnaire',submit),409);
  assert.equal(entity(db,approved.id).data.status,'questionnaire');
});

test('couple invitations wait for approval while employee invitations and legacy accounts retain access',t=>{
  const f=fixture(t),{db,owner,wedding}=f;
  const invite=command(db,owner,'invite.create',{projectId:wedding.id,email:'invited@example.test'});
  const invited=register(db,{name:'Invited',email:'invited@example.test',phone:'+79991234568',password,invitation:invite.token}).user;
  assert.equal(snapshot(db,invited).onboarding.status,'pending');
  assert.deepEqual(snapshot(db,invited).grants,[]);fails(()=>snapshot(db,invited,wedding.id),403);
  const legacy=registerTestUser(db,{name:'Legacy',email:'legacy@example.test',password}).user;
  const role=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='couple'").get(owner.agency_id);grant(db,legacy,role.id,wedding.id);
  assert.equal(snapshot(db,legacy).onboarding,null);assert.equal(snapshot(db,legacy,wedding.id).project.id,wedding.id);
  const staffRole=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='organizer'").get(owner.agency_id);
  const staffInvite=command(db,owner,'invite.create',{projectId:wedding.id,email:'staff@example.test',roleId:staffRole.id});
  const staff=register(db,{name:'Staff',email:'staff@example.test',phone:'+79991234569',password,invitation:staffInvite.token}).user;
  assert.equal(snapshot(db,staff).onboarding,null);assert.equal(snapshot(db,staff,wedding.id).project.id,wedding.id);
});

test('approval and session survive reopening the database before questionnaire completion',t=>{
  const path=join(mkdtempSync(join(tmpdir(),'tie-onboarding-persistence-')),'state.sqlite');
  const f=fixture(t,path),approved=approve(f);
  const login=authenticate(f.db,{identifier:f.user.phone,password});f.db.close();
  const reopened=openDatabase(path);t.after(()=>reopened.close());
  const user=userSession(reopened,login.token);
  assert.equal(user.id,f.user.id);assert.equal(snapshot(reopened,user).onboarding.status,'questionnaire');
  fails(()=>snapshot(reopened,user,f.wedding.id),403);
  command(reopened,user,'account.questionnaire',{entityId:approved.id,version:approved.version,answers});
  assert.equal(snapshot(reopened,user,f.wedding.id).project.id,f.wedding.id);
});

test('HTTP signup, administrator approval, questionnaire and personal account enforce the same sequence',async t=>{
  const root=mkdtempSync(join(tmpdir(),'tie-onboarding-http-')),dist=join(root,'dist');mkdirSync(dist);writeFileSync(join(dist,'index.html'),'<main>tie</main>');
  const server=createHttpServer({dbPath:':memory:',distDir:dist});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const client=()=>{const jar=new Map();return async(path,body,csrf=true)=>{
    const headers={'cookie':[...jar].map(([k,v])=>`${k}=${v}`).join('; ')};
    if(body){headers['content-type']='application/json';if(csrf)headers['x-csrf-token']=jar.get('tie_csrf')||'';}
    const response=await fetch(base+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
    for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';');const i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
    return{status:response.status,data:await response.json()};
  };};
  const admin=client(),user=client();await admin('/api/public');await user('/api/public');
  assert.equal((await admin('/api/setup',{slug:'tie',agencyName:'Tie',name:'Owner',email:'owner@example.test',password})).status,201);
  const wedding=(await admin('/api/command',{id:uid(),op:'project.create',data:{name:'Wedding',date:'2027-06-12'}})).data;
  assert.equal((await user('/api/register',{name:'Anna',email:'anna@example.test',phone:'89991234567',password})).status,201);
  let entry=(await user('/api/state')).data.onboarding;assert.equal(entry.status,'pending');
  const inbox=(await admin('/api/state')).data.accountRegistrations;
  assert.equal(inbox.length,1);assert.equal(inbox[0].id,entry.id);assert.equal(inbox[0].canApprove,true);
  const notification=(await admin('/api/v2/notifications?type=account.registered')).data;
  assert.equal(notification.total,1);assert.equal(notification.unread,1);
  assert.equal(notification.items[0].data.actionUrl,`/app/applications?registration=${entry.id}`);
  assert.equal((await user(`/api/state?project=${wedding.id}`)).status,403);
  assert.equal((await user(`/api/offline?project=${wedding.id}`)).status,403);
  assert.equal((await user('/api/command',{id:uid(),op:'account.questionnaire',entityId:entry.id,version:entry.version,answers})).status,409);
  assert.equal((await admin('/api/command',{id:uid(),op:'account.approve',entityId:entry.id,version:entry.version,weddingId:wedding.id},false)).status,403);
  assert.equal((await admin('/api/command',{id:uid(),op:'account.approve',entityId:entry.id,version:entry.version,weddingId:wedding.id})).status,200);
  entry=(await user('/api/state')).data.onboarding;assert.equal(entry.status,'questionnaire');
  assert.equal((await user(`/api/state?project=${wedding.id}`)).status,403);
  assert.equal((await user('/api/command',{id:uid(),op:'account.questionnaire',entityId:entry.id,version:entry.version,answers})).status,200);
  assert.equal((await user(`/api/state?project=${wedding.id}`)).data.project.id,wedding.id);
  await user('/api/logout',{});
  assert.equal((await user('/api/login',{identifier:'anna@example.test',password})).status,200);
  assert.equal((await user('/api/state')).data.onboarding.status,'complete');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,uid,insert,entities} from '../server/db.mjs';
import {bootstrap,execute,snapshot} from '../server/service.mjs';
import {grant,can,withAuthorizationRead} from '../server/auth.mjs';
import {registerTestUser} from './fixtures/account.mjs';
import {calendar} from '../server/v2/calendar/index.mjs';
import {dashboard} from '../server/v2/calendar/readiness.mjs';

function fixture(t) {
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const admin=bootstrap(db,{slug:'speed',agencyName:'Тест',name:'Администратор',email:'admin@example.test',password:'test-password'}).user;
  const user=registerTestUser(db,{slug:'speed',name:'Организатор',email:'organizer@example.test',password:'test-password'}).user;
  const role=db.prepare("SELECT id FROM roles WHERE key='organizer'").get();
  grant(db,user,role.id);
  const projects=[];
  for(let i=0;i<4;i++) {
    const project=execute(db,admin,{id:uid(),op:'project.create',data:{name:`Свадьба ${i}`,date:'2027-06-12'}});
    projects.push(project);
    const table=entities(db,admin.agency_id,project.id,'table').find(row=>row.data.key==='guests');
    for(let j=0;j<30;j++)insert(db,admin,'row',{name:`Гость ${j}`,audience:'Пара'},project.id,table.id);
  }
  let permissionQueries=0;
  const counted=new Proxy(db,{get(target,key){
    if(key==='prepare')return sql=>{
      if(sql.includes('FROM grants g JOIN roles r'))permissionQueries++;
      return target.prepare(sql);
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  return {db,counted,admin,user,projects,queries:()=>permissionQueries,reset:()=>{permissionQueries=0}};
}

test('populated staff state reads each person’s grants once per response, not once per field',t=>{
  const f=fixture(t);
  const state=snapshot(f.counted,f.user);
  assert.equal(state.projects.length,4);
  assert.ok(f.queries()<=2,`Agency snapshot repeated ${f.queries()} permission queries`);
  f.reset();
  const wedding=snapshot(f.counted,f.user,f.projects[0].id);
  assert.ok(wedding.entities.filter(row=>row.kind==='row').length>=30);
  assert.ok(f.queries()<=2,`Wedding snapshot repeated ${f.queries()} permission queries`);
  f.reset();
  const day='2027-06-12';
  assert.equal(calendar(f.counted,f.user,{from:day,to:day}).items.filter(row=>row.sourceKind==='project').length,4);
  assert.ok(f.queries()<=2);
  f.reset();
  assert.equal(dashboard(f.counted,f.user,{at:Date.parse(day)}).metrics.activeProjects,4);
  assert.ok(f.queries()<=2,`Dashboard repeated ${f.queries()} permission queries`);
});

test('read permission reuse ends on success and failure; revocations and other principals are fresh',t=>{
  const f=fixture(t);
  assert.equal(withAuthorizationRead(f.counted,()=>can(f.counted,f.user,'projects')),true);
  f.db.prepare('DELETE FROM grants WHERE user_id=?').run(f.user.id);
  assert.equal(can(f.counted,f.user,'projects'),false);
  assert.equal(snapshot(f.counted,f.user).projects.length,0);
  assert.equal(snapshot(f.counted,f.admin).projects.length,4);
  const role=f.db.prepare("SELECT id FROM roles WHERE key='organizer'").get();
  grant(f.db,f.user,role.id);
  assert.throws(()=>withAuthorizationRead(f.counted,()=>{
    assert.equal(can(f.counted,f.user,'projects'),true);
    throw new Error('read failed');
  }),/read failed/);
  f.db.prepare('DELETE FROM grants WHERE user_id=?').run(f.user.id);
  assert.equal(withAuthorizationRead(f.counted,()=>can(f.counted,f.user,'projects')),false);
  assert.throws(()=>execute(f.db,f.user,{id:uid(),op:'project.control.save',projectId:f.projects[0].id,version:f.projects[0].version,stage:{id:'venue',status:'done',comment:'',notRequired:false}}),/недоступен|прав/);
});

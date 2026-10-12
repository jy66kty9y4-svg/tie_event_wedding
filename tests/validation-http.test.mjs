import test from 'node:test';
import assert from 'node:assert/strict';
import {createHttpServer} from '../server/http.mjs';
import {bootstrap,execute} from '../server/service.mjs';
import {createSession,token} from '../server/auth.mjs';
import {entity,entities,uid} from '../server/db.mjs';

test('invalid dates and schemas return HTTP400 atomically and leave the wedding usable after rejection',async t=>{
  const server=createHttpServer({dbPath:':memory:'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const db=server.db,user=bootstrap(db,{agencyName:'Validation Unit',slug:'tie',name:'Fictional Owner',email:'owner@example.test',password:'unit-validation-password'}).user;
  const project=execute(db,user,{id:uid(),op:'project.create',data:{name:'Unit Wedding',date:''}}),table=entities(db,user.agency_id,project.id,'table').find(row=>row.data.key==='guests');
  const origin=`http://127.0.0.1:${server.address().port}`,session=createSession(db,user),csrf=token();
  const post=async cmd=>{
    const response=await fetch(origin+'/api/command',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:`tie_session=${session}; tie_csrf=${csrf}`,'X-CSRF-Token':csrf},body:JSON.stringify({id:uid(),...cmd})});
    return {status:response.status,body:await response.json()};
  };
  const before=entity(db,table.id),auditCount=db.prepare('SELECT count(*) n FROM audit').get().n,commandCount=db.prepare('SELECT count(*) n FROM commands').get().n;
  for(const columns of [[null],[{name:'Missing id',type:'text'}],[{id:'a',name:'Unknown type',type:'constructor'}],[{id:'a',name:'Bad formula',type:'formula',formula:'process.exit()'}]]) {
    const result=await post({op:'entity.edit',projectId:project.id,entityId:table.id,version:table.version,data:{columns}});
    assert.equal(result.status,400);assert.notEqual(result.body.error,'Внутренняя ошибка сервера');assert.deepEqual(entity(db,table.id),before);
  }
  for(const date of ['2027-13-01','2027-01-32','2027-02-30']) {
    const result=await post({op:'project.create',data:{name:'Invalid wedding',date}});assert.equal(result.status,400);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM audit').get().n,auditCount);assert.equal(db.prepare('SELECT count(*) n FROM commands').get().n,commandCount);
  assert.equal(entities(db,user.agency_id,null,'project').length,1);
  const good=await post({op:'entity.create',projectId:project.id,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'Valid guest'}});
  assert.equal(good.status,200);assert.equal(good.body.data.name,'Valid guest');
});

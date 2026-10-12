import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,uid} from '../server/db.mjs';
import {grant} from '../server/auth.mjs';
import {bootstrap,execute,snapshot} from '../server/service.mjs';
import {registerTestUser} from './fixtures/account.mjs';

function fixture(t){
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const owner=bootstrap(db,{slug:'tie',agencyName:'Fixture',name:'Owner',email:'owner@example.test',password:'fixture-finance-password'}).user;
  const run=(user,op,data={})=>execute(db,user,{id:uid(),op,...data});
  const wedding=run(owner,'project.create',{data:{name:'Fixture wedding',date:'2027-06-12'}});
  return{db,owner,run,wedding};
}

test('wedding estimate fee and advances refresh agency totals, without double counting legacy fees or creating movements',t=>{
  const{db,owner,run,wedding}=fixture(t),projectId=wedding.id;
  const legacy=run(owner,'entity.create',{projectId,kind:'obligation',data:{title:'Гонорар агентства',priceKind:'amount',agreed:100000,planned:null,fee:true,dueDate:''}});
  run(owner,'movement.save',{projectId,obligationVersion:legacy.version,data:{type:'fee',amount:20000,date:'2026-10-10',description:'Legacy fee advance',source:'direct',obligationId:legacy.id}});
  run(owner,'entity.create',{projectId,kind:'obligation',data:{title:'Комиссия',priceKind:'amount',agreed:50000,planned:null,agencyCommission:10001,fee:false,dueDate:''}});
  let state=snapshot(db,owner),card=state.agencyRevenue.projects[0];
  assert.equal(card.feeExpected,100000);assert.equal(card.feePrepaid,20000);assert.equal(card.feeSource,'ledger');
  const cashBefore=state.financials.income,movesBefore=db.prepare("SELECT count(*) AS n FROM entities WHERE kind='movement'").get().n;
  for(const [row,field,value] of [[29,'estimated',150000],[29,'actual',120001],[30,'estimated',50002],[29,'prepaid',20003],[30,'prepaid',10004],[9,'prepaid',99999],[134,'prepaid',88888]])run(owner,'coupleBudget.cell',{projectId,row,field,value});
  state=snapshot(db,owner);card=state.agencyRevenue.projects[0];
  assert.equal(card.feeExpected,170003);assert.equal(card.feePrepaid,30007);assert.equal(card.feeRemaining,139996);
  assert.equal(card.totalExpected,180004);assert.equal(card.feeSource,'coupleBudget');assert.equal(card.prepaidSource,'coupleBudget');
  assert.equal(card.items.filter(item=>item.type==='fee').length,2);
  assert.equal(state.agencyRevenue.feeExpected,170003);assert.equal(state.agencyRevenue.feePrepaid,30007);
  assert.equal(state.financials.income,cashBefore);assert.equal(db.prepare("SELECT count(*) AS n FROM entities WHERE kind='movement'").get().n,movesBefore);
  run(owner,'coupleBudget.cell',{projectId,row:29,field:'actual',value:0});
  run(owner,'coupleBudget.cell',{projectId,row:30,field:'estimated',value:0});
  run(owner,'coupleBudget.cell',{projectId,row:29,field:'prepaid',value:0});
  run(owner,'coupleBudget.cell',{projectId,row:30,field:'prepaid',value:0});
  card=snapshot(db,owner).agencyRevenue.projects[0];assert.equal(card.feeExpected,0);assert.equal(card.feePrepaid,0);
  for(const [row,field] of [[29,'estimated'],[29,'actual'],[30,'estimated'],[29,'prepaid'],[30,'prepaid']])run(owner,'coupleBudget.cell',{projectId,row,field,value:null});
  card=snapshot(db,owner).agencyRevenue.projects[0];assert.equal(card.feeExpected,100000);assert.equal(card.feePrepaid,20000);
});

test('agency projection follows field permissions and cannot expose other agencies or couple-only access',t=>{
  const{db,owner,run,wedding}=fixture(t),projectId=wedding.id;
  run(owner,'coupleBudget.cell',{projectId,row:29,field:'actual',value:12345});
  run(owner,'coupleBudget.cell',{projectId,row:29,field:'prepaid',value:2345});
  const user=registerTestUser(db,{name:'Scoped',email:'scoped@example.test',password:'fixture-finance-password'}).user;
  const cashRole=run(owner,'role.save',{name:'Cash read',permissions:['read','agencyFinance']});
  const budgetRole=run(owner,'role.save',{name:'Amount read',permissions:['read','finance']});
  grant(db,user,cashRole.id,null);
  grant(db,user,budgetRole.id,projectId,{sections:['budget'],fields:['actual']});
  const scoped=snapshot(db,user).agencyRevenue.projects.find(card=>card.projectId===projectId);
  assert.equal(scoped.feeExpected,12345);assert.equal(scoped.feePrepaid,0);
  const couple=registerTestUser(db,{name:'Couple',email:'couple@example.test',password:'fixture-finance-password'}).user;
  grant(db,couple,db.prepare("SELECT id FROM roles WHERE key='couple'").get().id,projectId);
  assert.equal(Object.hasOwn(snapshot(db,couple),'agencyRevenue'),false);
  db.prepare('INSERT INTO agencies(id,slug,name,settings) VALUES(?,?,?,?)').run('other','other','Other','{}');
  db.prepare("INSERT INTO entities(id,agency_id,project_id,kind,data,updated_at) VALUES(?,?,NULL,'project',?,?)").run('other-wedding','other',JSON.stringify({name:'Other',date:'2027-06-12'}),new Date().toISOString());
  assert.equal(snapshot(db,owner).agencyRevenue.projects.some(card=>card.projectId==='other-wedding'),false);
});

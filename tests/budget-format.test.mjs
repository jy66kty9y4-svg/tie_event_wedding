import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBudgetFormat,budgetFormatSegments,budgetSelectionStyle,normalizeBudgetFormat,rebaseBudgetFormat,trimBudgetText,displayBudgetAmount,parseBudgetAmount} from '../src/budget-format.js';
import {openDatabase,uid} from '../server/db.mjs';
import {grant} from '../server/auth.mjs';
import {bootstrap,execute,snapshot} from '../server/service.mjs';
import {registerTestUser} from './fixtures/account.mjs';
import {coupleBudgetTotals} from '../src/couple-budget.js';

test('selected text formatting combines marks without changing plain text',()=>{
  const text='Банкет и декор';
  let format=applyBudgetFormat(null,text,0,6,{bold:true});
  format=applyBudgetFormat(format,text,3,9,{italic:true,color:'#B93646',highlight:'#fff0a6',fontSize:20});
  assert.deepEqual(budgetSelectionStyle(format,text,3,6),{bold:true,italic:true,color:'#b93646',highlight:'#fff0a6',fontSize:20});
  assert.equal(budgetSelectionStyle(format,text,10,14).bold,undefined);
  assert.equal(budgetFormatSegments(text,format).map(segment=>segment.text).join(''),text);
  format=applyBudgetFormat(format,text,0,0,{bold:false});
  assert.equal(budgetSelectionStyle(format,text,3,6).bold,false);
  assert.equal(budgetSelectionStyle(format,text,3,6).italic,true);
  assert.equal(applyBudgetFormat(format,text,0,0,null),null);
  assert.equal(applyBudgetFormat(format,text,0,text.length,null),null);
});

test('editing, trimming and removing selected formatting preserve other marked fragments',()=>{
  let format=applyBudgetFormat(null,'  Свет и декор  ',2,6,{bold:true});
  format=applyBudgetFormat(format,'  Свет и декор  ',9,14,{italic:true});
  const trimmed=trimBudgetText('  Свет и декор  ',format);
  assert.equal(trimmed.text,'Свет и декор');assert.deepEqual(trimmed.format.ranges,[{from:0,to:4,style:{bold:true}},{from:7,to:12,style:{italic:true}}]);
  const edited=rebaseBudgetFormat(trimmed.format,trimmed.text,'Свет, цветы и декор');
  assert.equal(budgetSelectionStyle(edited,'Свет, цветы и декор',14,19).italic,true);
  const clear=applyBudgetFormat(edited,'Свет, цветы и декор',0,4,null);
  assert.equal(budgetSelectionStyle(clear,'Свет, цветы и декор',0,4).bold,false);
  assert.equal(budgetSelectionStyle(clear,'Свет, цветы и декор',14,19).italic,true);
});

test('unsafe style keys, CSS/HTML injection, invalid offsets and text spans on money are rejected',()=>{
  for(const value of[
    {style:{color:'url(javascript:alert(1))'}},{style:{fontSize:1000}},{style:{position:'fixed'}},
    {style:{bold:'yes'}},{html:'<script>alert(1)</script>'},{ranges:[{from:-1,to:3,style:{bold:true}}]},
    {ranges:[{from:0,to:20,style:{bold:true}}]},{ranges:[{from:1,to:1,style:{bold:true}}]}
  ])assert.throws(()=>normalizeBudgetFormat(value,'Текст'));
  assert.throws(()=>normalizeBudgetFormat({ranges:[{from:0,to:1,style:{bold:true}}]},'100',false));
  assert.deepEqual(normalizeBudgetFormat({style:{color:'#AABBCC'},ranges:[]},'',false),{style:{color:'#aabbcc'},ranges:[]});
});

test('money grouping accepts ordinary/nonbreaking/narrow spaces and retains exact kopecks',()=>{
  assert.equal(displayBudgetAmount(10000000),'100 000');assert.equal(displayBudgetAmount(125000000),'1 250 000');
  assert.equal(displayBudgetAmount(125000025),'1 250 000,25');
  for(const text of['1 250 000,25','1\u00a0250\u00a0000.25','1\u202f250\u202f000,25'])assert.equal(parseBudgetAmount(text),125000025);
  assert.equal(parseBudgetAmount(''),null);assert.equal(parseBudgetAmount('0'),0);
  for(const text of['-1','1,001','1e6','no','99999999999999999'])assert.throws(()=>parseBudgetAmount(text));
});

const run=(db,user,op,data)=>execute(db,user,{id:uid(),op,...data});
function fixture(t){
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const admin=bootstrap(db,{slug:'tie',agencyName:'Тест',name:'Owner',email:'owner@example.test',password:'format-test-password'}).user;
  const wedding=run(db,admin,'project.create',{data:{name:'Wedding',date:'2027-06-12'}});
  const user=registerTestUser(db,{name:'Couple',email:'couple@example.test',password:'format-test-password'}).user;
  grant(db,user,db.prepare("SELECT id FROM roles WHERE key='couple'").get().id,wedding.id);
  return{db,admin,user,wedding};
}
const sheet=(db,user,id)=>snapshot(db,user,id).entities.find(row=>row.kind==='coupleBudget');

test('cell text and formatting save atomically, computed formatting cannot change finances, and clear survives readback',t=>{
  const{db,user,wedding}=fixture(t),projectId=wedding.id;
  run(db,user,'coupleBudget.cell',{projectId,row:9,field:'name',value:'Площадка',format:{ranges:[{from:0,to:4,style:{bold:true,fontSize:20,highlight:'#fff0a6'}}]}});
  run(db,user,'coupleBudget.cell',{projectId,row:9,field:'actual',value:125000025,format:{style:{color:'#b93646'}}});
  run(db,user,'coupleBudget.cell',{projectId,row:9,field:'prepaid',value:25000025});
  const before=coupleBudgetTotals(sheet(db,user,projectId).data);
  run(db,user,'coupleBudget.format',{projectId,row:9,field:'remaining',value:1,format:{style:{bold:true}}});
  assert.deepEqual(coupleBudgetTotals(sheet(db,user,projectId).data),before);
  assert.equal(sheet(db,user,projectId).data.cellFormats.name[9].ranges[0].to,4);
  assert.equal(sheet(db,user,projectId).data.actual[9],125000025);
  run(db,user,'coupleBudget.format',{projectId,row:9,field:'name',value:'Площадка',format:null});
  assert.equal(sheet(db,user,projectId).data.cellFormats.name,undefined);
  assert.equal(sheet(db,user,projectId).data.names[9],'Площадка');
  assert.throws(()=>run(db,user,'coupleBudget.format',{projectId,row:9,field:'name',value:'Old text',format:{style:{bold:true}}}),error=>error.status===409);
});

test('formatting validates field scope, tenant/project access and malicious payloads before mutation',t=>{
  const{db,admin,user,wedding}=fixture(t),projectId=wedding.id;
  const limited=registerTestUser(db,{name:'Limited',email:'limited@example.test',password:'format-test-password'}).user;
  const role=run(db,admin,'role.save',{name:'Plan only',permissions:['read','edit','finance']});
  grant(db,limited,role.id,projectId,{sections:['budget'],fields:['estimated']});
  run(db,user,'coupleBudget.cell',{projectId,row:9,field:'name',value:'Площадка',format:{style:{bold:true}}});
  const result=run(db,limited,'coupleBudget.cell',{projectId,row:9,field:'estimated',value:10000000,format:{style:{color:'#665269'}}});
  assert.deepEqual(Object.keys(result.data.cellFormats),['estimated']);
  assert.deepEqual(Object.keys(sheet(db,limited,projectId).data.cellFormats),['estimated']);
  assert.throws(()=>run(db,limited,'coupleBudget.format',{projectId,row:9,field:'name',format:{style:{bold:true}}}),e=>e.status===403);
  const other=run(db,admin,'project.create',{data:{name:'Other',date:'2027-07-12'}});
  assert.throws(()=>run(db,user,'coupleBudget.format',{projectId:other.id,row:9,field:'name',format:null}),e=>e.status===403);
  const before=sheet(db,user,projectId);
  for(const payload of[
    {row:9,field:'actual',value:1,format:{style:{color:'red;display:none'}}},
    {row:9,field:'name',value:'Название',format:{ranges:[{from:0,to:500,style:{italic:true}}]}},
    {row:8,field:'actual',value:1,format:{style:{bold:true}}},
    {row:9,field:'organizer',value:true,format:{style:{bold:true}}}
  ])assert.throws(()=>run(db,user,'coupleBudget.cell',{projectId,...payload}),e=>e.status===400);
  assert.deepEqual(sheet(db,user,projectId),before);
});

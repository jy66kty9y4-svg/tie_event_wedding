import test from 'node:test';
import assert from 'node:assert/strict';
import {validateColumns,validateRow} from '../server/model.mjs';
import {insert,change} from '../server/db.mjs';
import {grant} from '../server/auth.mjs';
import {unitDb} from './fixtures/unit-db.mjs';

const column=(changes={})=>({id:'value',name:'Value',type:'text',...changes});
for(const [name,columns] of [
  ['null collection',null],['object collection',{}],['over 80 columns',Array.from({length:81},(_,i)=>column({id:`c${i}`}))],
  ['null column',[null]],['primitive column',[1]],['missing ID',[{name:'Value',type:'text'}]],['numeric ID',[column({id:1})]],
  ['duplicate IDs',[column(),column()]],['prototype ID',[column({id:'__proto__'})]],['reserved formats ID',[column({id:'cellFormats'})]],
  ['invalid ID characters',[column({id:'a.b'})]],['excessive ID',[column({id:'a'.repeat(81)})]],['empty label',[column({name:''})]],
  ['unknown type',[column({type:'unknown'})]],['inherited constructor type',[column({type:'constructor'})]],['inherited toString type',[column({type:'toString'})]],['inherited prototype type',[column({type:'__proto__'})]],
  ['missing select options',[column({type:'select'})]],['nonstring select option',[column({type:'select',options:[1]})]],['over 100 options',[column({type:'select',options:Array(101).fill('x')})]],
  ['excessive option text',[column({type:'select',options:['x'.repeat(121)]})]],['foreign relation kind',[column({type:'relation',targetKind:'project'})]],
  ['unsafe formula',[column({type:'formula',formula:'process.exit()'})]],['missing formula dependency',[column({type:'formula',formula:'{missing}+1'})]],
  ['self reference',[column({type:'formula',formula:'{value}+1'})]],['unsupported formula result',[column({type:'formula',formula:'1+2',resultType:'text'})]]
])test(`schema rejects ${name} with a validation error`,()=>assert.throws(()=>validateColumns(columns),e=>e.status===400));
test('schema accepts stable types and bounded options while leaving the original metadata intact',()=>{
  const columns=[column(),column({id:'amount',type:'money'}),column({id:'calc',type:'formula',formula:'{amount}*2',resultType:'money'}),column({id:'reply',type:'select',options:['','Да','Нет']}),column({id:'link',type:'relation',targetKind:'seatingTable'})],before=structuredClone(columns);
  assert.equal(validateColumns(columns),columns);assert.deepEqual(columns,before);assert.deepEqual(validateColumns([]),[]);
  assert.throws(()=>validateColumns([column({id:'first',type:'formula',formula:'1+2'}),column({id:'second',type:'formula',formula:'{first}*2'})]),e=>e.status===400);
});
for(const [type,value] of [['text','Text'],['number',0],['number',-1.5],['money',1],['date','2024-02-29'],['time','00:00'],['time','23:59'],['boolean',false],['select','Да'],['url','https://example.test/a']]) {
  test(`row validation accepts typed ${type} value ${JSON.stringify(value)}`,t=>{
    const {db,admin}=unitDb(t),table={project_id:'p',data:{columns:[column({type,options:['Да','Нет']})]}};
    assert.doesNotThrow(()=>validateRow(db,admin,table,{value}));assert.doesNotThrow(()=>validateRow(db,admin,table,{value:null}));assert.doesNotThrow(()=>validateRow(db,admin,table,{value:''}));
  });
}
for(const [type,value,status=400] of [['text',42],['text','x'.repeat(8001)],['number','12'],['number',Infinity],['money',1.5],['money',-1],['date','2027-13-01'],['time','24:00'],['boolean','false'],['select','Other'],['url','javascript:alert(1)'],['formula',12],['users',['missing'],409],['users',['same','same']]]) {
  test(`row validation rejects malformed ${type} value`,t=>{
    const {db,admin}=unitDb(t),table={project_id:'p',data:{columns:[column({type,options:['Да','Нет'],formula:'2+2'})]}};
    assert.throws(()=>validateRow(db,admin,table,{value}),e=>e.status===status);
  });
}
test('malformed rows and removed schema fields produce controlled validation/version errors',t=>{
  const {db,admin}=unitDb(t),table={project_id:'p',data:{columns:[column()]}};
  for(const values of [null,[],true])assert.throws(()=>validateRow(db,admin,table,values),e=>e.status===400);
  assert.throws(()=>validateRow(db,admin,table,{missing:'Value'}),e=>e.status===409&&e.details.table===table);
});
test('typed links reject cross-wedding or deleted records; users must be current project members',t=>{
  const {db,admin,member,roles}=unitDb(t),p=insert(db,admin,'project',{name:'Unit'});
  grant(db,member,roles.find(r=>r.key==='coordinator').id,p.id);
  const row=insert(db,admin,'row',{name:'Unit'},p.id),foreign=insert(db,admin,'row',{name:'Other'},'other'),file=insert(db,admin,'file',{name:'Contract'},p.id);
  const table={project_id:p.id,data:{columns:[column({id:'link',type:'relation'}),column({id:'file',type:'file'}),column({id:'users',type:'users'})]}};
  validateRow(db,admin,table,{link:row.id,file:file.id,users:[member.id]});
  assert.throws(()=>validateRow(db,admin,table,{link:foreign.id}),e=>e.status===404);
  assert.throws(()=>validateRow(db,admin,table,{file:row.id}),e=>e.status===404);
  change(db,admin,row,row.data,true);assert.throws(()=>validateRow(db,admin,table,{link:row.id}),e=>e.status===400);
  db.prepare('DELETE FROM grants WHERE user_id=?').run(member.id);assert.throws(()=>validateRow(db,admin,table,{users:[member.id]}),e=>e.status===409);
});

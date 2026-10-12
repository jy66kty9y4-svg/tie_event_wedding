import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,uid,entity,entities} from '../server/db.mjs';
import {grant} from '../server/auth.mjs';
import {bootstrap,execute,snapshot} from '../server/service.mjs';
import {registerTestUser} from './fixtures/account.mjs';
import {parseListOptions,normalizeSheetLayout} from '../src/sheet.js';
import {coupleBudgetBaseColumns,coupleBudgetTotals,coupleBudgetAgencyFee} from '../src/couple-budget.js';
import {financeSheetColumns,obligationSheetColumns} from '../src/finance-sheet.js';
import {tableWorkbook,coupleBudgetWorkbook,financeSheetWorkbook,obligationSheetWorkbook} from '../src/export-workbooks.js';
import {buildXlsx} from '../src/xlsx.js';
const run=(db,user,op,data={})=>execute(db,user,{id:uid(),op,...data});
function fixture(t){const db=openDatabase(':memory:');t.after(()=>db.close());const admin=bootstrap(db,{agencyName:'Тест таблиц',slug:'tie',name:'Owner',email:'owner@example.test',password:'sheet-test-password'}).user;const wedding=run(db,admin,'project.create',{data:{name:'Анна и Иван',date:'2027-06-12'}});const table=entities(db,admin.agency_id,wedding.id,'table').find(t=>t.data.key==='guests');return{db,admin,wedding,table}}
const budget=(db,user,p)=>snapshot(db,user,p).entities.find(row=>row.kind==='coupleBudget').data;
const entries=bytes=>{let offset=0;const result=new Map(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),length=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+length+extra;result.set(decoder.decode(bytes.slice(offset+30,offset+30+length)),decoder.decode(bytes.slice(start,start+size)));offset=start+size}return result};

test('new estimate rows save typed values and formats atomically and roll back invalid drafts',t=>{
  const {db,admin,wedding}=fixture(t),projectId=wedding.id;
  run(db,admin,'coupleBudget.structure',{projectId,action:'columns',columns:[...coupleBudgetBaseColumns,{id:'contract',name:'Договор',type:'select',options:['Подписан','Не подписан']}],hiddenColumns:[]});
  const added=run(db,admin,'coupleBudget.item.add',{projectId,sectionId:121,name:'Доставка',note:'Проверка',organizer:true,values:{name:'Доставка',actual:125000025,prepaid:25000025,contract:'Подписан'},formats:{name:{style:{bold:true,color:'#665269'}},actual:{style:{fontSize:20}}}});
  const data=budget(db,admin,projectId),id=added.createdId;
  assert.equal(data.actual[id],125000025);assert.equal(data.extraValues.contract[id],'Подписан');assert.equal(data.cellFormats.name[id].style.bold,true);
  assert.equal(coupleBudgetTotals(data).overall.remaining,100000000);assert.equal(coupleBudgetTotals(data).organizer.actual,125000025);
  const before=JSON.stringify(entity(db,added.id));
  assert.throws(()=>run(db,admin,'coupleBudget.item.add',{projectId,sectionId:121,name:'Ошибка',organizer:true,values:{actual:100,contract:'Несуществующий вариант'}}));
  assert.equal(JSON.stringify(entity(db,added.id)),before);
  assert.throws(()=>run(db,admin,'coupleBudget.item.add',{projectId,sectionId:121,name:'Ошибка',organizer:true,formats:{name:{style:{color:'url(evil)'}}}}));
  assert.equal(JSON.stringify(entity(db,added.id)),before);
});

test('new estimate draft cannot write a field outside its create grant',t=>{
  const {db,admin,wedding}=fixture(t),projectId=wedding.id;
  const user=registerTestUser(db,{agency:'tie',name:'Ограниченный',email:'draft@example.test',password:'draft-test-password'}).user;
  const role=run(db,admin,'role.save',{name:'Draft names only',permissions:['read','create','finance']});grant(db,user,role.id,projectId,{sections:['budget'],fields:['extraItems','name']});
  const before=entities(db,admin.agency_id,projectId,'coupleBudget');
  assert.throws(()=>run(db,user,'coupleBudget.item.add',{projectId,sectionId:121,name:'Ошибка',organizer:true,values:{name:'Ошибка',actual:100}}),e=>e.status===403);
  assert.deepEqual(entities(db,admin.agency_id,projectId,'coupleBudget'),before);
});

test('financial row creation validates formatting in the ledger transaction',t=>{
  const {db,admin}=fixture(t);
  const row=run(db,admin,'movement.save',{projectId:null,data:{type:'income',description:'Кириллица',date:'2026-10-11',amount:10000000},formats:{description:{ranges:[{from:0,to:9,style:{bold:true}}]},amount:{style:{color:'#287354'}}}});
  assert.equal(row.data.cellFormats.description.ranges[0].style.bold,true);assert.equal(snapshot(db,admin).financials.own,10000000);
  assert.throws(()=>run(db,admin,'movement.save',{projectId:null,data:{type:'income',description:'Ошибка',date:'2026-10-11',amount:100},formats:{amount:{style:{fontSize:99}}}}));
  assert.equal(snapshot(db,admin).financials.own,10000000);
  const user=registerTestUser(db,{agency:'tie',name:'Движения',email:'draft-ledger@example.test',password:'draft-test-password'}).user;
  const role=run(db,admin,'role.save',{name:'Draft ledger only',permissions:['read','create','agencyFinance']});grant(db,user,role.id,null,{sections:['agencyFinance'],fields:['type','description','date','amount']});
  assert.throws(()=>run(db,user,'movement.save',{projectId:null,data:{type:'income',description:'Ошибка',date:'2026-10-11',amount:100},formats:{method:{style:{bold:true}}}}),e=>e.status===403);
  assert.equal(snapshot(db,admin).financials.own,10000000);
});

test('financial drafts retain custom list cells in creation, edits and Excel; stale schemas roll back',t=>{
  const {db,admin,wedding}=fixture(t),projectId=wedding.id;
  const column={id:'contract',name:'Договор',type:'select',options:['Подписан','Не подписан']};
  let config=run(db,admin,'financeSheet.structure',{projectId:null,columns:[...financeSheetColumns(true),column],hiddenColumns:[]});
  let row=run(db,admin,'movement.save',{projectId:null,data:{type:'income',description:'Новая строка',amount:10000,date:'2026-10-11'},sheetVersion:config.version,sheetValues:{contract:'Подписан'},formats:{contract:{style:{bold:true}}}});
  assert.equal(row.data.sheetValues.contract,'Подписан');assert.equal(row.data.cellFormats.contract.style.bold,true);
  row=run(db,admin,'movement.save',{projectId:null,entityId:row.id,version:row.version,data:Object.fromEntries(Object.entries(row.data).filter(([key])=>!['cellFormats','sheetValues'].includes(key))),sheetVersion:config.version,sheetValues:{contract:'Не подписан'}});
  assert.equal(row.data.sheetValues.contract,'Не подписан');
  const exported=financeSheetWorkbook(snapshot(db,admin),true);assert.equal(exported.sheets[0].rows[0].contract.value,'Не подписан');
  config=run(db,admin,'financeSheet.structure',{projectId:null,columns:[...financeSheetColumns(true),column],hiddenColumns:[]});
  const before=entities(db,admin.agency_id,null,'movement');
  assert.throws(()=>run(db,admin,'movement.save',{projectId:null,data:{type:'income',description:'Конфликт',amount:100,date:'2026-10-11'},sheetVersion:config.version-1,sheetValues:{contract:'Подписан'}}),e=>e.status===409);
  assert.deepEqual(entities(db,admin.agency_id,null,'movement'),before);
  const obligationColumns=[...obligationSheetColumns(),column];
  config=run(db,admin,'financeSheet.structure',{projectId,target:'obligation',columns:obligationColumns,hiddenColumns:[]});
  const obligation=run(db,admin,'entity.create',{projectId,kind:'obligation',data:{title:'Подрядчик',priceKind:'amount',agreed:10000,planned:null},sheetVersion:config.version,sheetValues:{contract:'Подписан'},formats:{contract:{style:{color:'#287354'}}}});
  assert.equal(obligation.data.sheetValues.contract,'Подписан');assert.equal(obligation.data.cellFormats.contract.style.color,'#287354');
});

test('comma separated options preserve words, trim blanks and remove duplicates',()=>{assert.deepEqual(parseListOptions('вариант 1, вариант 2, вариант 3, , вариант 1'),['вариант 1','вариант 2','вариант 3']);assert.deepEqual(parseListOptions(''),[]);assert.throws(()=>normalizeSheetLayout({columnWidths:{missing:200}},['name'],[]));assert.throws(()=>normalizeSheetLayout({rowHeights:{r:501}},[],['r']));});

test('table cell formatting is atomic, scoped and retained after plain text edits',t=>{
  const{db,admin,wedding,table}=fixture(t),projectId=wedding.id;
  let row=run(db,admin,'entity.create',{projectId,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'Анна'}});
  row=run(db,admin,'entity.edit',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,data:{name:'Анна Петрова'},formats:{name:{ranges:[{from:0,to:4,style:{bold:true,color:'#665269'}}]}}});
  assert.equal(row.data.cellFormats.name.ranges[0].to,4);
  const before=entity(db,row.id);
  assert.throws(()=>run(db,admin,'entity.edit',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,data:{name:'Ошибка'},formats:{name:{style:{color:'url(evil)'}}}}));assert.deepEqual(entity(db,row.id),before);
  row=run(db,admin,'entity.edit',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,data:{name:'Анна Иванова'}});assert(row.data.cellFormats.name);
  assert.throws(()=>run(db,admin,'entity.edit',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,data:{},formats:{name:{style:{bold:true}}},formatOnly:true,expectedValue:'Старое имя'}),e=>e.status===409);
  const limited=registerTestUser(db,{name:'Limited',email:'limited@example.test',password:'sheet-test-password'}).user,role=run(db,admin,'role.save',{name:'Only contact',permissions:['read','edit']});grant(db,limited,role.id,projectId,{sections:[table.id],fields:['contact']});
  assert.throws(()=>run(db,limited,'entity.edit',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,data:{},formats:{name:{style:{bold:true}}}}),e=>e.status===403);
  const snapshotRow=snapshot(db,limited,projectId).entities.find(r=>r.id===row.id);assert.equal(snapshotRow?.data.cellFormats?.name,undefined);
});

test('column and row dimensions persist and reject foreign rows and unbounded sizes',t=>{
 const{db,admin,wedding,table}=fixture(t),projectId=wedding.id,row=run(db,admin,'entity.create',{projectId,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'Анна'}});
 run(db,admin,'sheet.layout',{projectId,entityId:table.id,axis:'columnWidths',key:'name',value:320});run(db,admin,'sheet.layout',{projectId,entityId:table.id,axis:'rowHeights',key:row.id,value:96});
 assert.deepEqual(entity(db,table.id).data.sheetLayout,{columnWidths:{name:320},rowHeights:{[row.id]:96}});
 for(const patch of [{axis:'columnWidths',key:'name',value:900},{axis:'rowHeights',key:uid(),value:96},{axis:'rowHeights',key:row.id,value:1}])assert.throws(()=>run(db,admin,'sheet.layout',{projectId,entityId:table.id,...patch}));
});

test('budget custom list columns save values; deletion changes totals and agency fees with history',t=>{
 const{db,admin,wedding}=fixture(t),projectId=wedding.id;
 run(db,admin,'coupleBudget.structure',{projectId,action:'columns',columns:[...coupleBudgetBaseColumns,{id:'contract',name:'Договор',type:'select',options:parseListOptions('Не подписан, Подписан, Оплачен')}],hiddenColumns:['estimated']});
 run(db,admin,'coupleBudget.cell',{projectId,row:9,field:'contract',value:'Подписан',format:{style:{bold:true}}});run(db,admin,'coupleBudget.cell',{projectId,row:9,field:'actual',value:10000000});run(db,admin,'coupleBudget.cell',{projectId,row:29,field:'actual',value:12000000});
 const before=budget(db,admin,projectId);assert.equal(before.extraValues.contract[9],'Подписан');assert.equal(coupleBudgetTotals(before).overall.actual,22000000);
 run(db,admin,'coupleBudget.structure',{projectId,action:'delete',row:9});const next=budget(db,admin,projectId);assert.equal(coupleBudgetTotals(next).overall.actual,12000000);assert.equal(next.actual[9],10000000);
 run(db,admin,'coupleBudget.structure',{projectId,action:'delete',row:29});assert.equal(coupleBudgetAgencyFee(budget(db,admin,projectId)).feeExpected,0);assert.equal(coupleBudgetAgencyFee(budget(db,admin,projectId)).amountConfigured,true);
 assert(db.prepare("SELECT count(*) n FROM audit WHERE kind='coupleBudget'").get().n>=6);
});

test('finance custom columns and styles do not create movements or inflate balances',t=>{
 const{db,admin}=fixture(t),columns=[...financeSheetColumns(true),{id:'status',name:'Проверка',type:'select',options:['Да','Нет']}];
 run(db,admin,'financeSheet.structure',{projectId:null,columns});
 let movement=run(db,admin,'movement.save',{projectId:null,data:{type:'income',amount:10000000,date:'2027-06-01',description:'Тестовый доход',source:'direct'}});
 movement=run(db,admin,'financeSheet.cell',{projectId:null,entityId:movement.id,version:movement.version,field:'status',value:'Да',format:{style:{bold:true}}});
 const cash=snapshot(db,admin).financials.own;assert.equal(cash,10000000);
 movement=run(db,admin,'financeSheet.cell',{projectId:null,entityId:movement.id,version:movement.version,field:'amount',value:12000000,format:{style:{color:'#287354'}}});assert.equal(snapshot(db,admin).financials.own,12000000);assert.equal(movement.data.sheetValues.status,'Да');
 movement=run(db,admin,'movement.save',{projectId:null,entityId:movement.id,version:movement.version,data:{type:'income',amount:12000000,date:'2027-06-01',description:'Новое описание',source:'direct'}});assert.equal(movement.data.sheetValues.status,'Да');assert.equal(movement.data.cellFormats.amount.style.color,'#287354');
 const rows=entities(db,admin.agency_id,null,'movement');assert.equal(rows.length,1);
 const exportSheet=financeSheetWorkbook(snapshot(db,admin),true).sheets[0];assert.equal(exportSheet.rows[0].status.value,'Да');
});

test('table XLSX retains decimal numbers, safe formulas, formatting, column widths and row height',()=>{
 const table={data:{name:'Кириллица',columns:[{id:'name',name:'Имя',type:'text'},{id:'amount',name:'Сумма',type:'money'},{id:'count',name:'Количество',type:'number'},{id:'total',name:'Итого',type:'formula',resultType:'money',formula:'{amount} * {count}'}],sheetLayout:{columnWidths:{name:350},rowHeights:{r:96}}}},rows=[{id:'r',data:{name:'Анна Иванова',amount:125000025,count:1.5,cellFormats:{name:{style:{fontSize:20,color:'#665269'},ranges:[{from:0,to:4,style:{bold:true,italic:true}}]}}}}];
 const workbook=tableWorkbook({project:'Свадьба',table,rows}),files=entries(buildXlsx(workbook)),sheet=files.get('xl/worksheets/sheet1.xml');
 assert.match(sheet,/width="50"/);assert.match(sheet,/ht="72"/);assert.match(sheet,/<v>1250000.25<\/v>/);assert.match(sheet,/<f>IFERROR/);assert.match(sheet,/B3\*100/);assert.match(sheet,/Анна/);assert.match(sheet,/<b\/><i\/>/);assert.match(files.get('xl/styles.xml'),/#,##0.##########/);
 const literal=entries(buildXlsx({sheets:[{name:'Safe',columns:[{key:'a'}],rows:[{a:'=WEBSERVICE("evil")'}]}]})).get('xl/worksheets/sheet1.xml');assert(!literal.includes('<f>'));assert.match(literal,/inlineStr/);
});

test('budget export includes all articles, exact cached formula totals and hidden dependencies',()=>{
 const state={project:{data:{name:'Анна и Иван'}},entities:[{kind:'coupleBudget',data:{actual:{9:125000025,123:500000},prepaid:{9:25000025},hiddenColumns:['prepaid'],extraColumns:[{id:'custom',name:'Статус',type:'text'}],extraValues:{custom:{9:'Договор подписан'}}}}]};
 const workbook=coupleBudgetWorkbook(state),sheet=workbook.sheets[0];assert.equal(sheet.columns.at(-1).key,'prepaid');assert.equal(sheet.columns.at(-1).hidden,true);assert.equal(sheet.rows[0].actual.value,125500025);assert(sheet.rows[0].actual.formula.startsWith('SUM('));assert.equal(sheet.rows[3].custom.value,'Договор подписан');
 const files=entries(buildXlsx(workbook));assert.match(files.get('xl/worksheets/sheet1.xml'),/hidden="1"/);assert.match(files.get('xl/worksheets/sheet1.xml'),/<v>1255000.25<\/v>/);
});

test('obligation cells retain ledger formulas, custom data, exact permissions and dimensions',t=>{
 const{db,admin,wedding}=fixture(t),projectId=wedding.id;
 let obligation=run(db,admin,'entity.create',{projectId,kind:'obligation',data:{title:'Проверка договора',priceKind:'unknown',agreed:null,planned:null,fee:false}});
 obligation=run(db,admin,'financeSheet.cell',{projectId,target:'obligation',entityId:obligation.id,version:obligation.version,field:'agreed',value:10000000,format:{style:{bold:true}}});assert.equal(obligation.data.priceKind,'amount');assert.equal(obligation.data.agreed,10000000);
 obligation=run(db,admin,'financeSheet.cell',{projectId,target:'obligation',entityId:obligation.id,version:obligation.version,field:'paid',value:0,formatOnly:true,format:{style:{color:'#287354'}}});assert.equal(obligation.data.paid,undefined);assert.equal(obligation.data.cellFormats.paid.style.color,'#287354');
 assert.throws(()=>run(db,admin,'financeSheet.cell',{projectId,target:'obligation',entityId:obligation.id,version:obligation.version,field:'paid',value:1}),e=>e.status===400);
 run(db,admin,'financeSheet.layout',{projectId,target:'obligation',axis:'rowHeights',key:obligation.id,value:80});assert.equal(snapshot(db,admin,projectId).entities.find(row=>row.kind==='financeSheet').data.obligationLayout.rowHeights[obligation.id],80);
 const user=registerTestUser(db,{name:'Couple',email:'couple-obligation@example.test',password:'sheet-test-password'}).user;grant(db,user,db.prepare("SELECT id FROM roles WHERE key='couple'").get().id,projectId);
 assert.throws(()=>run(db,user,'financeSheet.cell',{projectId,target:'obligation',entityId:obligation.id,version:obligation.version,field:'agencyCommission',value:100}),e=>e.status===403);
});

test('empty text can be formatted and editing retains stable snapshot order',t=>{
 const{db,admin,wedding,table}=fixture(t),projectId=wedding.id;
 let first=run(db,admin,'entity.create',{projectId,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'Первый'}}),second=run(db,admin,'entity.create',{projectId,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'Второй'}});
 first=run(db,admin,'entity.edit',{projectId,entityId:first.id,version:first.version,schemaVersion:table.version,data:{},formats:{contact:{style:{fontSize:20}}},formatOnly:true,expectedValue:null});
 const rows=snapshot(db,admin,projectId).entities.filter(row=>row.parent_id===table.id);assert(rows.find(row=>row.id===first.id).sheetOrder<rows.find(row=>row.id===second.id).sheetOrder);
 assert.equal(tableWorkbook({table,rows}).sheets[0].rows[0].name,'Первый');
});

test('budget soft deletion and past formatting can be recovered through product history',t=>{
 const{db,admin,wedding,table}=fixture(t),projectId=wedding.id;
 run(db,admin,'coupleBudget.cell',{projectId,row:9,field:'actual',value:10000000});run(db,admin,'sheet.layout',{projectId,axis:'rowHeights',key:'9',value:72});run(db,admin,'coupleBudget.structure',{projectId,action:'delete',row:9});assert.equal(coupleBudgetTotals(budget(db,admin,projectId)).overall.actual,0);
 run(db,admin,'sheet.layout',{projectId,axis:'rowHeights',key:'10',value:80});run(db,admin,'coupleBudget.structure',{projectId,action:'restore',row:9});assert.equal(budget(db,admin,projectId).sheetLayout.rowHeights[9],72);assert.equal(coupleBudgetTotals(budget(db,admin,projectId)).overall.actual,10000000);
 const sheet=snapshot(db,admin,projectId).entities.find(row=>row.kind==='coupleBudget');run(db,admin,'coupleBudget.structure',{projectId,action:'delete',row:9});const audit=db.prepare("SELECT * FROM audit WHERE entity_id=? AND action='structure' ORDER BY rowid DESC LIMIT 1").get(sheet.id),current=entity(db,sheet.id);run(db,admin,'entity.restore',{projectId,entityId:sheet.id,version:current.version,auditId:audit.id});assert.equal(coupleBudgetTotals(budget(db,admin,projectId)).overall.actual,10000000);
 let row=run(db,admin,'entity.create',{projectId,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'Анна'}});row=run(db,admin,'entity.edit',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,data:{},formats:{name:{style:{bold:true}}},formatOnly:true,expectedValue:'Анна'});const styled=row;
 row=run(db,admin,'entity.edit',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,data:{},formats:{name:null},formatOnly:true,expectedValue:'Анна'});const change=db.prepare("SELECT * FROM audit WHERE entity_id=? ORDER BY rowid DESC LIMIT 1").get(row.id);row=run(db,admin,'entity.restore',{projectId,entityId:row.id,version:row.version,schemaVersion:table.version,auditId:change.id});assert.deepEqual(row.data.cellFormats,styled.data.cellFormats);
});

test('deleted cash operations and custom column definitions can be restored without double counting',t=>{
 const{db,admin}=fixture(t);
 run(db,admin,'financeSheet.structure',{columns:[...financeSheetColumns(true),{id:'comment',name:'Комментарий',type:'text'}]});
 let row=run(db,admin,'movement.save',{data:{type:'income',amount:10000000,date:'2027-06-01',description:'Проверка восстановления',source:'direct'}});
 row=run(db,admin,'financeSheet.cell',{entityId:row.id,version:row.version,field:'comment',value:'Кириллица',format:{style:{italic:true}}});
 row=run(db,admin,'movement.delete',{entityId:row.id,version:row.version});assert.equal(snapshot(db,admin).financials.own,0);assert(snapshot(db,admin).deletedFinanceRows.some(item=>item.id===row.id));
 row=run(db,admin,'movement.restore',{entityId:row.id,version:row.version});assert.equal(snapshot(db,admin).financials.own,10000000);assert.equal(row.data.sheetValues.comment,'Кириллица');assert.equal(row.data.cellFormats.comment.style.italic,true);
 assert.throws(()=>run(db,admin,'movement.restore',{entityId:row.id,version:row.version}),e=>e.status===409);
 run(db,admin,'financeSheet.structure',{columns:financeSheetColumns(true)});let config=entities(db,admin.agency_id,null,'financeSheet')[0];assert.equal(config.data.deletedColumns[0].id,'comment');run(db,admin,'financeSheet.structure',{columns:[...config.data.columns,...config.data.deletedColumns]});assert.equal(financeSheetWorkbook(snapshot(db,admin),true).sheets[0].rows[0].comment.value,'Кириллица');
});

test('limited financial access still gets correct per-row paid and due without private columns',t=>{
 const{db,admin,wedding}=fixture(t),projectId=wedding.id;
 const obligation=run(db,admin,'entity.create',{projectId,kind:'obligation',data:{title:'Проверка доступа',priceKind:'amount',agreed:10000000,agencyCommission:1500000,fee:false}});
 run(db,admin,'movement.save',{projectId,obligationVersion:obligation.version,data:{type:'payment',amount:2500000,date:'2027-06-01',description:'Аванс',source:'direct',obligationId:obligation.id}});
 const user=registerTestUser(db,{name:'Limited',email:'limited-sheet@example.test',password:'sheet-test-password'}).user;
 grant(db,user,db.prepare("SELECT id FROM roles WHERE key='couple'").get().id,projectId,{sections:['budget'],rows:[obligation.id],fields:['title','paid','due']});
 const view=snapshot(db,user,projectId),row=view.entities.find(row=>row.id===obligation.id);assert.equal(view.financials,undefined);assert.equal(row.data.paid,2500000);assert.equal(row.data.due,7500000);assert.equal(row.data.agencyCommission,undefined);assert.equal(row.data.agreed,undefined);const exported=obligationSheetWorkbook(view).sheets[0];assert(!exported.columns.some(column=>column.key==='agreed'));assert.equal(exported.rows[0].due,7500000);
 const current=entity(db,obligation.id);assert.throws(()=>run(db,admin,'entity.edit',{projectId,entityId:current.id,version:current.version,data:{sheetValues:{arbitrary:1}}}),e=>e.status===400);
});

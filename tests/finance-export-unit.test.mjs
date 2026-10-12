import test from 'node:test';
import assert from 'node:assert/strict';
import {financialColumnsForState,financeSheetColumns,obligationColumnsForState} from '../src/finance-sheet.js';
import {tableWorkbook,excelColumn,excelFormula,coupleBudgetWorkbook,obligationSheetWorkbook,financeSheetWorkbook,budgetWorkbook,seatingWorkbook,downloadTableXlsx,downloadGuestsXlsx,downloadBudgetXlsx,downloadSeatingXlsx,downloadFinanceSheetXlsx} from '../src/export-workbooks.js';
import {coupleBudgetTotals} from '../src/couple-budget.js';
import {buildXlsx,downloadXlsx} from '../src/xlsx.js';

const grant=(permissions,restrictions={},project_id='p')=>({permissions,restrictions,project_id});
const state=(grants=[])=>({user:{id:'u'},project:{id:'p',data:{name:'Unit Wedding'}},grants,entities:[]});
const columns=[{id:'amount',type:'money'},{id:'secret',type:'money'},{id:'calc',type:'formula',formula:'{amount}*2'}];
for(const [name,grants,agency,expected] of [
  ['no grant',[],false,[]],
  ['read alone',[grant(['read'])],false,[]],
  ['finance alone',[grant(['finance'])],false,[]],
  ['complete wedding grant',[grant(['read','finance'])],false,['amount','secret','calc']],
  ['other wedding',[grant(['read','finance'],{},'other')],false,[]],
  ['other section',[grant(['read','finance'],{sections:['files']})],false,[]],
  ['field without formula permission',[grant(['read','finance'],{fields:['amount']})],false,['amount']],
  ['formula without operand',[grant(['read','finance'],{fields:['calc']})],false,[]],
  ['formula with operand',[grant(['read','finance'],{fields:['amount','calc']})],false,['amount','calc']],
  ['two roles cannot supply half of the required verbs',[grant(['read']),grant(['finance'])],false,[]],
  ['wedding finance does not imply agency finance',[grant(['read','finance'],{},null)],true,[]],
  ['project grant cannot authorize agency data',[grant(['read','agencyFinance'])],true,[]],
  ['global agency finance',[grant(['read','agencyFinance'],{sections:['agencyFinance']},null)],true,['amount','secret','calc']]
])test(`finance columns respect ${name}`,()=>{
  const before=structuredClone(columns);
  assert.deepEqual(financialColumnsForState(state(grants),columns,agency).map(c=>c.id),expected);assert.deepEqual(columns,before);
});
test('obligation columns never expose commission to couples and resolve only active category labels',()=>{
  const view=state([grant(['read','finance'])]);view.canViewAgencyCommission=false;
  view.entities=[{id:'cat',kind:'category',data:{name:'Venue'}},{id:'deleted',kind:'category',deleted:true,data:{name:'Deleted'}}];
  view.assignableMembers=[{id:'member',name:'Unit Member'}];
  const list=obligationColumnsForState(view);assert(!list.some(c=>c.id==='agencyCommission'));
  assert.deepEqual(list.find(c=>c.id==='categoryId').options,['cat']);assert.equal(list.find(c=>c.id==='responsible').optionLabels.member,'Unit Member');
  assert.equal(list.find(c=>c.id==='paid').computed,true);assert.equal(list.find(c=>c.id==='due').computed,true);
});
for(const [index,expected] of [[0,'A'],[25,'Z'],[26,'AA'],[51,'AZ'],[52,'BA'],[701,'ZZ'],[702,'AAA'],[16383,'XFD']])test(`Excel column references cross alphabet boundaries: ${index}`,()=>assert.equal(excelColumn(index),expected));
test('Excel formulas preserve money units, blank guards, missing dependencies and column reordering',()=>{
  const cols=[{id:'price',type:'money'},{id:'qty',type:'number'}],formula={formula:'{price}*{qty}',resultType:'money'};
  assert.equal(excelFormula(formula,cols,3),'IFERROR(IF(AND(ISNUMBER(A3),ISNUMBER(B3)),((A3*100)*B3)/100,""),"")');
  assert.match(excelFormula(formula,[cols[1],cols[0]],4),/\(B4\*100\)\*A4/);
  assert.equal(excelFormula({formula:'{missing}+1'},cols,3),null);
  assert.equal(excelFormula({formula:'2+3'},cols,3),'IFERROR(2+3,"")');
  assert.throws(()=>excelFormula({formula:'HYPERLINK("https://evil.test")'},cols,3));
});
test('table export resolves select, relation, file and users values and preserves dimensions and row order',()=>{
  const table={data:{name:'Unit',columns:[{id:'reply',type:'select',options:['yes','no'],optionLabels:{yes:'Да',no:'Нет'}},{id:'table',type:'relation'},{id:'doc',type:'file'},{id:'staff',type:'users'},{id:'text',type:'text'}],rowOrder:['b','a'],hiddenColumns:['doc'],sheetLayout:{columnWidths:{text:350},rowHeights:{b:64}}}};
  const rows=[{id:'a',data:{text:'A',staff:['u','missing']}},{id:'b',data:{text:'B',reply:'yes',table:'t',doc:'f',staff:'u'}}];
  const input=structuredClone({table,rows}),sheet=tableWorkbook({table,rows,relationRows:[{id:'t',data:{label:'Стол 1'}}],files:[{id:'f',data:{name:'Contract.pdf'}}],members:[{id:'u',name:'Unit Staff'}]}).sheets[0];
  assert.equal(sheet.rows[0].text,'B');assert.equal(sheet.rows[0].reply,'Да');assert.equal(sheet.rows[0].table,'Стол 1');assert.equal(sheet.rows[0].doc,'Contract.pdf');assert.equal(sheet.rows[1].staff,'Unit Staff, missing');
  assert.deepEqual(sheet.columns[0].options,['Да','Нет']);assert.equal(sheet.columns[2].hidden,true);assert.equal(sheet.columns[4].width,50);assert.deepEqual(sheet.rowHeights,[64,44]);
  assert.deepEqual({table,rows},input);
});
test('budget exports keep every cached total equal to integer-kopek domain totals with custom and deleted rows',()=>{
  const data={actual:{9:123456,10:78901,1001:1},prepaid:{9:456,10:100000},estimated:{9:500000},deletedRows:[10],extraItems:{121:[{row:1001,name:'Custom'}]},hiddenColumns:['prepaid'],cellFormats:{name:{9:{style:{bold:true}}}}};
  const view=state();view.user.protected=true;view.entities=[{kind:'coupleBudget',data}];
  const totals=coupleBudgetTotals(data),sheet=coupleBudgetWorkbook(view).sheets[0];
  for(const key of ['actual','prepaid','estimated','remaining'])assert.equal(sheet.rows[0][key].value,totals.overall[key]);
  assert.equal(sheet.rows.filter(r=>r.name?.value==='Custom').length,1);
  assert.equal(sheet.columns.find(c=>c.key==='prepaid').hidden,true);
  assert.match(sheet.rows[0].actual.formula,/^SUM\(/);assert.equal(budgetWorkbook(view).sheets.length,3);
  assert.equal(budgetWorkbook({...view,entities:[]}).sheets.length,2);
});
test('obligation exports honor explicit zero and overpayment and use derived amounts only when absent',()=>{
  const view=state([grant(['read','finance'])]);view.entities=[{id:'a',kind:'obligation',data:{title:'A',agreed:1000,paid:0,due:0}},{id:'b',kind:'obligation',data:{title:'B',agreed:1000}}];view.financials={paid:{a:999,b:2000}};
  const sheet=obligationSheetWorkbook(view).sheets[0];assert.equal(sheet.rows[0].paid,0);assert.equal(sheet.rows[0].due.value,0);assert.equal(sheet.rows[1].paid,2000);assert.equal(sheet.rows[1].due.value,0);
  assert.equal(financeSheetWorkbook({...view,entities:[{kind:'movement',data:{amount:1,description:'Small',sheetValues:{method:'Cash'}}}]}).sheets[0].rows[0].method,'Cash');
});

// Independently decode ZIP headers, then verify content and central-directory CRCs.
function entries(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),items=new Map(),decoder=new TextDecoder();let offset=0;
  while(view.getUint32(offset,true)===0x04034b50) {
    assert.equal(view.getUint16(offset+8,true),0);
    const size=view.getUint32(offset+18,true),length=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+length+extra;
    const name=decoder.decode(bytes.slice(offset+30,offset+30+length)),data=bytes.slice(start,start+size);
    let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
    assert.equal((crc^0xffffffff)>>>0,view.getUint32(offset+14,true),`CRC ${name}`);
    items.set(name,decoder.decode(data));offset=start+size;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);
  const end=bytes.byteLength-22;assert.equal(view.getUint32(end,true),0x06054b50);assert.equal(view.getUint16(end+10,true),items.size);assert.equal(view.getUint32(end+16,true),offset);
  return items;
}
test('Excel text cannot become a formula; XML metacharacters and forbidden controls are sanitized',()=>{
  const payload='=HYPERLINK("https://evil.test", "x")<&>\u0000\u0001';
  const files=entries(buildXlsx({creator:'A&B',sheets:[{name:'Unit',columns:[{key:'text',type:'text'}],rows:[{text:payload},{text:'@SUM(A1:A2)'},{text:'+CMD'},{text:'-1+2'}]}]})),xml=files.get('xl/worksheets/sheet1.xml');
  assert(!xml.includes('<f>'));assert.match(xml,/t="inlineStr"/);assert.match(xml,/&lt;&amp;&gt;/);assert(!xml.includes('\u0000'));assert.match(files.get('docProps/core.xml'),/A&amp;B/);
});
test('Excel typed cells preserve money, time, dates, booleans, arrays and richly marked text',()=>{
  const files=entries(buildXlsx({sheets:[{name:'Types',filter:false,columns:[{key:'amount',type:'money'},{key:'time',type:'time'},{key:'date',type:'date'},{key:'yes',type:'boolean'},{key:'tags',type:'text'},{key:'rich',type:'text'}],rows:[{amount:1,time:'12:00',date:'1970-01-01',yes:false,tags:['One','Two'],rich:{_sheetCell:true,value:'Hello world',format:{ranges:[{from:0,to:5,style:{bold:true,color:'#ff0000',highlight:'#ffff00'}}]}}}]}]}));
  const xml=files.get('xl/worksheets/sheet1.xml');assert.match(xml,/<v>0.01<\/v>/);assert.match(xml,/<v>0.5<\/v>/);assert.match(xml,/<v>25569<\/v>/);assert.match(xml,/>Нет</);assert.match(xml,/One, Two/);assert.match(xml,/<b\/>/);assert.match(xml,/FFFF0000/);assert(!xml.includes('<autoFilter'));assert.match(files.get('xl/styles.xml'),/FFFFFF00/);
});
test('Excel list sheets avoid name collisions, remain hidden, and do not mutate the source workbook',()=>{
  const input={sheets:[{name:'A/B',columns:[{key:'x',options:['Да','Нет']}],rows:[]},{name:'A?B',columns:[]},{name:'Варианты списков',columns:[]},{name:'x'.repeat(60),columns:[]}]},before=structuredClone(input),files=entries(buildXlsx(input));
  const xml=files.get('xl/workbook.xml'),names=[...xml.matchAll(/<sheet name="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(names).size,names.length);assert(names.every(n=>n.length<=31));assert.match(xml,/state="hidden"/);assert.match(xml,/_tie_list_1/);assert.deepEqual(input,before);
  assert.throws(()=>buildXlsx({sheets:[]}));assert.throws(()=>buildXlsx({}));
});
test('seating export represents unmapped and declined guests and clamps free seats at zero',()=>{
  const view=state();view.entities=[{id:'g',kind:'table',data:{key:'guests',semanticMap:{guestName:'name',rsvpStatus:'status',rsvpValues:{declined:'Нет'},seatingTable:'table',seatIndex:'seat'}}},{id:'plan',kind:'seatingPlan',data:{}},{id:'t',kind:'seatingTable',parent_id:'plan',data:{label:'Стол 1',shape:'rect',capacity:1}},{id:'a',kind:'row',parent_id:'g',data:{name:'A',table:'t',seat:1,status:'Нет'}},{id:'b',kind:'row',parent_id:'g',data:{name:'B',table:'t',seat:2}},{id:'c',kind:'row',parent_id:'g',data:{name:'C'}}];
  const sheets=seatingWorkbook(view).sheets;assert.equal(sheets[1].rows[0].occupied,2);assert.equal(sheets[1].rows[0].free,0);
  assert.equal(sheets[0].rows.find(r=>r.name==='A').rsvp,'Отказ');assert.equal(sheets[0].rows.find(r=>r.name==='C').table,'Без места');
});
test('download actions route online exports to authorized endpoints and offline exports to local workbooks',t=>{
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),links=[],revoked=[],timers=[];
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){const link={click(){links.push({href:this.href,download:this.download});},remove(){}};return link;},body:{appendChild(){}}}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{for(const [key,descriptor] of [['document',originalDocument],['navigator',originalNavigator]])descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  t.mock.method(URL,'createObjectURL',()=> 'blob:unit');t.mock.method(URL,'revokeObjectURL',value=>revoked.push(value));t.mock.method(globalThis,'setTimeout',(fn,delay)=>{timers.push({fn,delay});});
  const view=state();view.entities=[{id:'g',project_id:'p',kind:'table',data:{key:'guests',columns:[{id:'name',type:'text'}]}},{id:'r',kind:'row',parent_id:'g',data:{name:'Unit'}}];
  downloadGuestsXlsx(view);assert.equal(links.at(-1).href,'/api/export.xlsx?project=p&kind=table&table=g');
  downloadBudgetXlsx(view);assert.match(links.at(-1).href,/kind=budget/);
  downloadSeatingXlsx(view);assert.match(links.at(-1).href,/kind=seating/);
  downloadFinanceSheetXlsx(view);assert.match(links.at(-1).href,/kind=financeSheet/);
  downloadFinanceSheetXlsx(view,true);assert.match(links.at(-1).href,/kind=agencyFinance/);
  navigator.onLine=false;
  downloadTableXlsx({table:view.entities[0],rows:[]});downloadGuestsXlsx(view);downloadBudgetXlsx(view);downloadSeatingXlsx(view);downloadFinanceSheetXlsx(view);downloadFinanceSheetXlsx(view,true);
  assert(links.slice(-6).every(link=>link.href==='blob:unit'&&link.download.endsWith('.xlsx')));
  assert.equal(downloadXlsx({sheets:[{name:'Empty'}]},'  Bad:/name.xlsx'),'Bad-name.xlsx');
  assert(timers.every(timer=>timer.delay===60000));timers.forEach(timer=>timer.fn());assert.equal(revoked.length,7);
  assert.throws(()=>downloadGuestsXlsx({...view,entities:[]}),/Реестр гостей/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildXlsx} from '../src/xlsx.js';
import {budgetWorkbook,seatingWorkbook,tableWorkbook} from '../src/export-workbooks.js';

const archiveEntries=bytes=>{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder(),result=new Map();
  let offset=0;
  while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
    const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),nameStart=offset+30,dataStart=nameStart+nameLength+extraLength;
    result.set(decoder.decode(bytes.slice(nameStart,nameStart+nameLength)),decoder.decode(bytes.slice(dataStart,dataStart+size)));
    offset=dataStart+size;
  }
  return result;
};

test('buildXlsx creates a readable OOXML workbook with styling and values',()=>{
  const bytes=buildXlsx({sheets:[{name:'Смета',title:'Анна и Иван — смета',columns:[{key:'title',label:'Статья'},{key:'amount',label:'Сумма',type:'money'},{key:'date',label:'Дата',type:'date'}],rows:[{title:'Фотограф',amount:12500000,date:'2026-08-15'}]}]});
  assert.equal(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0,true),0x04034b50);
  const files=archiveEntries(bytes);
  assert.ok(files.has('[Content_Types].xml'));
  assert.match(files.get('xl/workbook.xml'),/sheet name="Смета"/);
  assert.match(files.get('xl/styles.xml'),/Arial/);
  assert.match(files.get('xl/worksheets/sheet1.xml'),/Анна и Иван — смета/);
  assert.match(files.get('xl/worksheets/sheet1.xml'),/<v>125000<\/v>/);
  assert.match(files.get('xl/worksheets/sheet1.xml'),/state="frozen"/);
});

test('tableWorkbook applies timing audience and row order',()=>{
  const workbook=tableWorkbook({project:'Свадьба',audience:'Пара',table:{data:{name:'Тайминг',rowOrder:['pair','team','common'],columns:[{id:'title',name:'Событие',type:'text'}]}},rows:[{id:'common',data:{title:'Общее',audience:'Общее'}},{id:'team',data:{title:'Только команда',audience:'Команда'}},{id:'pair',data:{title:'Только пара',audience:'Пара'}}]});
  assert.deepEqual(workbook.sheets[0].rows.map(row=>row.title),['Только пара','Общее']);
});

test('budget workbook hides agency commission from the couple export',()=>{
  const state={project:{data:{name:'Проект'}},canViewAgencyCommission:false,entities:[{id:'o1',kind:'obligation',data:{title:'Фотограф',priceKind:'amount',agreed:10000000,agencyCommission:1500000}}],financials:{paid:{o1:2000000}}};
  const couple=budgetWorkbook(state);
  assert.equal(couple.sheets.length,2);
  assert.ok(!couple.sheets[0].columns.some(column=>column.key==='commission'));
  assert.equal(couple.sheets[0].rows[0].due,8000000);
  const organizer=budgetWorkbook({...state,canViewAgencyCommission:true});
  assert.ok(organizer.sheets[0].columns.some(column=>column.key==='commission'));
});

test('seating workbook includes guests and table occupancy',()=>{
  const state={project:{data:{name:'Проект'}},entities:[
    {id:'guest-table',kind:'table',data:{key:'guests',semanticMap:{guestName:'name',rsvpStatus:'rsvp',seatingTable:'table',seatIndex:'seat',rsvpValues:{confirmed:'Да'}}}},
    {id:'plan',kind:'seatingPlan',data:{}},
    {id:'t1',kind:'seatingTable',parent_id:'plan',data:{label:'Стол 1',shape:'round',capacity:8,xM:1,yM:2,widthM:1.6,heightM:1.6}},
    {id:'g1',kind:'row',parent_id:'guest-table',data:{name:'Анна',rsvp:'Да',table:'t1',seat:3}}
  ]};
  const workbook=seatingWorkbook(state);
  assert.deepEqual(workbook.sheets.map(sheet=>sheet.name),['Рассадка гостей','Столы']);
  assert.equal(workbook.sheets[0].rows[0].table,'Стол 1');
  assert.equal(workbook.sheets[1].rows[0].occupied,1);
  assert.equal(workbook.sheets[1].rows[0].free,7);
});

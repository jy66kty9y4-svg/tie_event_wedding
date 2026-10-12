import test from 'node:test';
import assert from 'node:assert/strict';
import {cents, compute, money, dateLabel, today} from '../src/shared.js';
import {sheetValue, sheetNumber, parseListOptions, normalizeSheetLayout} from '../src/sheet.js';
import {amount, date, text, safeUrl} from '../server/model.mjs';

// Explicit oracles: these do not obtain expected values from the implementation.
for (const [input, expected] of [
  ['0',0],['0,01',1],['0.09',9],['1.2',120],['001.02',102],
  [' 1 234,56 ',123456],['1\u00a0234,56',123456],['1\u202f234.56',123456],
  ['9999999999.99',999999999999], [125,12500]
]) test(`money input preserves exact kopecks: ${JSON.stringify(input)}`, () => {
  assert.equal(cents(input),expected);
  assert.equal(sheetValue({type:'money'},input),expected);
});
for (const input of ['',null,undefined,'-1','+1','1.001','1,2,3','1e3','0x10','Infinity','NaN','10 ₽','10000000000','1/2']) {
  test(`money input rejects invalid or implicit rounding: ${String(input)}`, () => assert.throws(() => cents(input)));
}
for (const [expression, values, expected] of [
  ['2+3*4',{},14], ['(2+3)*4',{},20], ['10-3-2',{},5], ['24/4/2',{},3],
  ['-2*-(3+1)',{},8], ['2--3',{},5], ['-(2+3)',{},-5], ['0.5+1.25',{},1.75],
  ['{cost-a}*{qty_2}',{'cost-a':12345,qty_2:3},37035],
  ['{a}/{b}',{a:10,b:4},2.5], ['{a}*0',{a:0},0],
  ['{a}+1',{a:null},null], ['{a}+1',{a:''},null], ['{a}+1',{a:'25'},null],
  ['{a}+1',{},null], ['1/0',{},null], ['0/0',{},null], ['2*(1/0)',{},null],
  ['-{a}',{},null], ['({a}+3)/2',{a:7},5]
]) test(`formula evaluates arithmetic, precedence and unknown values: ${expression} ${JSON.stringify(values)}`, () => {
  const before=structuredClone(values);
  assert.equal(compute(expression,values),expected);
  assert.deepEqual(values,before);
});
for (const expression of ['', ' ', '1 2', '1+', '()', '(1+2', '1+2)', '2**3', '2^3', 'Math.random()',
  'globalThis.process.exit()', '{a.b}', '{a} = 3', '1;2', '1e3', '1,2', '1/*x*/+2', 'Infinity']) {
  test(`formula rejects invalid syntax and executable expressions: ${JSON.stringify(expression)}`, () => assert.throws(() => compute(expression,{})));
}
test('formula properties hold for deterministic integer inputs and do not modify the operands', () => {
  let seed=0x7213;
  for(let i=0;i<500;i++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const a=seed%1000000,b=(seed>>>8)%10000+1;
    assert.equal(compute('({a}+{b})-{b}',{a,b}),a);
    assert.equal(compute('{a}*{b}',{a,b}),compute('{b}*{a}',{a,b}));
    assert.equal(compute('{a}-{a}',{a}),0);
  }
});
for(const value of [0,1,999999999999,1e12]) test(`server amount accepts a bounded integer: ${value}`,()=>assert.equal(amount(value),value));
for(const value of [-1,1.5,1e12+1,Number.MAX_SAFE_INTEGER,NaN,Infinity,'100',null,undefined,true]) {
  test(`server amount rejects malformed, negative or excessive money: ${String(value)}`,()=>assert.throws(()=>amount(value),e=>e.status===400));
}
test('unknown money is distinct from explicit zero',()=>{
  assert.equal(amount(null,true),null);
  assert.equal(amount(0,true),0);
  assert.equal(money(null),'Не определено');
  assert.equal(money(undefined),'Не определено');
  assert.match(money(123456),/1\s234,56/);
  assert.match(money(0),/0/);
});
for(const value of ['2024-02-29','2000-02-29','2027-12-31','2028-01-01']) {
  test(`server accepts a real calendar date: ${value}`,()=>assert.equal(date(value,false),value));
}
for(const value of ['2023-02-29','1900-02-29','2027-04-31','2027-02-30','2027-13-01','2027-00-01','2027-01-32','2027-01-00','2027-1-01','2027-01-01T12:00:00Z',null,23]) {
  test(`invalid date returns a validation error, never an internal error: ${String(value)}`,()=>assert.throws(()=>date(value,false),e=>e.status===400));
}
test('optional dates and bounded text remain usable with no wedding date',()=>{
  assert.equal(date(''),'');assert.equal(date(null),'');
  assert.equal(dateLabel(''),'Дата не выбрана');
  assert.match(dateLabel('2027-06-12'),/12 июня 2027/);
  assert.match(today(),/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(text('  Название  '),'Название');
  for(const v of ['', '   ', null, 42, 'a'.repeat(241)])assert.throws(()=>text(v),e=>e.status===400);
  assert.equal(text('a'.repeat(240)).length,240);
  assert.equal(safeUrl('https://example.test/a'),'https://example.test/a');
  assert.equal(safeUrl(null),'');
  assert.throws(()=>safeUrl('javascript:alert(1)'),e=>e.status===400);
});
test('sheet values separate clearing, zero, decimals and nonnumeric text',()=>{
  for(const type of ['money','number','text'])for(const value of ['',null,undefined])assert.equal(sheetValue({type},value),null);
  assert.equal(sheetValue({type:'number'},' -1 234,5 '),-1234.5);
  assert.equal(sheetValue({type:'number'},'0'),0);
  for(const v of ['abc','Infinity','NaN'])assert.throws(()=>sheetValue({type:'number'},v));
  assert.equal(sheetValue({type:'text'},'000123'),'000123');
  assert.equal(sheetNumber(null),'');assert.equal(sheetNumber(''),'');assert.equal(sheetNumber(1234.25),'1 234,25');
  assert.deepEqual(parseListOptions(' A, B, A, , B, C '),['A','B','C']);
});
test('sheet layouts copy valid dimensions and reject foreign IDs and every invalid boundary',()=>{
  const layout={columnWidths:{price:80,note:800},rowHeights:{1:32,2:500}};
  assert.deepEqual(normalizeSheetLayout(layout,['price','note'],[1,2]),layout);
  assert.deepEqual(normalizeSheetLayout(),{columnWidths:{},rowHeights:{}});
  for(const value of [null,[],3])assert.throws(()=>normalizeSheetLayout(value));
  for(const value of [79,801,80.5,'80',Infinity])assert.throws(()=>normalizeSheetLayout({columnWidths:{price:value}},['price']));
  for(const value of [31,501,32.5,'32'])assert.throws(()=>normalizeSheetLayout({rowHeights:{1:value}},[],[1]));
  assert.throws(()=>normalizeSheetLayout({columnWidths:{foreign:100}},['price']));
  assert.throws(()=>normalizeSheetLayout({rowHeights:[]},[],[1]));
  const copy=normalizeSheetLayout(layout,['price','note'],[1,2]);copy.columnWidths.price=120;
  assert.equal(layout.columnWidths.price,80);
});

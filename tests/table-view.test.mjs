import test from 'node:test';
import assert from 'node:assert/strict';
import {tableViewKeys,readTableView,tableColumnWidth,numericColumn} from '../src/table-view.js';
test('views separate individual tables, agency/wedding scopes and device modes',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)},first=tableViewKeys('agency:user:wedding:guests','phone');
 storage.setItem(first.scale,'.4');storage.setItem(first.columns,'{"amount":152}');assert.deepEqual(readTableView(storage,first),{scale:.4,columns:{amount:152}});
 for(const [scope,device] of [['agency:user:wedding:timing','phone'],['agency:user:agency:guests','phone'],['agency:user:wedding:guests','desktop']])assert.deepEqual(readTableView(storage,tableViewKeys(scope,device)),{scale:null,columns:{}});
});
test('phone table columns compact by type, grow for rendered numbers and respect manual widths',()=>{
 const money={id:'amount',type:'money'},text={id:'name',type:'text'};
 assert.equal(tableColumnWidth(money,'phone',{amount:500}),110);assert.equal(tableColumnWidth(text,'phone'),200);
 assert.equal(tableColumnWidth(money,'phone',{}, {},{amount:230}),230);assert.equal(tableColumnWidth(money,'phone',{}, {amount:128},{amount:230}),128);
 assert.equal(tableColumnWidth(money,'desktop',{amount:500}),500);assert.equal(numericColumn({type:'formula'}),true);assert.equal(numericColumn({type:'date'}),false);
});

test('wide table zoom below20% persists while estimate retains its existing20% floor',async()=>{
 const {budgetViewKeys}=await import('../src/budget-view.js');
 const storage={getItem:()=>'.15',setItem(){}};assert.equal(readTableView(storage,tableViewKeys('a:u:p:table','phone')).scale,.15);
 assert.equal(readTableView(storage,budgetViewKeys('a:u:p','phone')).scale,.2);
});

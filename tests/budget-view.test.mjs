import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetDevice,budgetViewKeys,readBudgetView,budgetColumnWidths,budgetColumnWidth} from '../src/budget-view.js';
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
test('device view follows primary input and keeps phones separate through rotation',()=>{
  assert.equal(budgetDevice({coarse:true,width:440,height:956}),'phone');
  assert.equal(budgetDevice({coarse:true,width:956,height:440}),'phone');
  assert.equal(budgetDevice({coarse:true,width:1024,height:768}),'tablet');
  assert.equal(budgetDevice({coarse:false,width:440,height:956}),'desktop');
});
test('legacy zoom migrates once to the active device mode without overwriting other modes',()=>{
  const s=storage(),phone=budgetViewKeys('agency:user:wedding','phone'),desktop=budgetViewKeys('agency:user:wedding','desktop');
  s.setItem(phone.legacy,'.4551');assert.equal(readBudgetView(s,phone).scale,.4551);
  assert.equal(readBudgetView(s,desktop).scale,null);assert.equal(s.getItem(phone.legacy),'.4551');
  s.setItem(desktop.scale,'1.3');assert.equal(readBudgetView(s,desktop).scale,1.3);assert.equal(readBudgetView(s,phone).scale,.4551);
});
test('device preferences also isolate browsers, accounts, agencies and weddings',()=>{
  const s=storage(),first=budgetViewKeys('a:u:p','phone');s.setItem(first.scale,'.6');s.setItem(first.columns,'{"actual":144}');
  assert.equal(readBudgetView(s,first).scale,.6);
  for(const scope of ['b:u:p','a:v:p','a:u:q'])assert.deepEqual(readBudgetView(s,budgetViewKeys(scope,'phone')),{scale:null,columns:{}});
  assert.deepEqual(readBudgetView(storage(),first),{scale:null,columns:{}});
});
test('compact phone widths ignore shared layout, expand for amounts and respect local manual widths',()=>{
  const widths=['name','estimated','actual','prepaid','remaining','note'].map(id=>budgetColumnWidth({id},'phone',{[id]:700}));
  assert.deepEqual(widths,[200,165,127,120,110,123]);
  assert.equal(budgetColumnWidth({id:'actual'},'phone',{}, {},{actual:250}),250);
  assert.equal(budgetColumnWidth({id:'actual'},'phone',{}, {actual:140},{actual:250}),140);
  assert.equal(budgetColumnWidth({id:'name'},'desktop',{name:340}),340);
});
test('malformed or inaccessible view storage retains usable defaults',()=>{
  assert.deepEqual(budgetColumnWidths({actual:120,prepaid:-2,name:900,note:'123',remaining:NaN}),{actual:120});
  const s=storage(),keys=budgetViewKeys('a:u:p','phone');s.setItem(keys.scale,'NaN');s.setItem(keys.columns,'bad json');
  assert.deepEqual(readBudgetView(s,keys),{scale:null,columns:{}});
  assert.deepEqual(readBudgetView({getItem(){throw new Error('disabled')}},keys),{scale:null,columns:{}});
});

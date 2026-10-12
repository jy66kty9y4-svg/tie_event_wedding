import test from 'node:test';
import assert from 'node:assert/strict';
import {coupleBudgetGroups,coupleBudgetItemCount,coupleBudgetTotals,coupleBudgetOrganizerIncluded,coupleBudgetRemaining,coupleBudgetAgencyFee} from '../src/couple-budget.js';

test('couple budget mirrors every template section and totals all 96 articles',()=>{
  assert.equal(coupleBudgetItemCount,96);
  assert.deepEqual(coupleBudgetGroups.map(group=>group.row),[8,28,51,74,95,110,121]);
  const data={
    estimated:{9:120000,13:9000,33:5000,134:7000},
    actual:{9:100000,13:8000,33:4500,134:6500},
    prepaid:{9:25000,13:2000,33:1000,134:1500}
  };
  const totals=coupleBudgetTotals(data);
  assert.deepEqual(totals.overall,{estimated:141000,actual:119000,prepaid:29500,remaining:89500});
  assert.deepEqual(totals.organizer,{estimated:132000,actual:111000,prepaid:27500,remaining:83500});
  assert.deepEqual(totals.groupTotals[28],{estimated:5000,actual:4500,prepaid:1000,remaining:3500});
  assert.deepEqual(totals.groupTotals[121],{estimated:7000,actual:6500,prepaid:1500,remaining:5000});
});

test('every template article feeds its section and overall totals once, including all additional costs',()=>{
  const ranges=[[8,9,23],[28,29,46],[51,52,69],[74,75,90],[95,96,105],[110,111,116],[121,122,134]];
  const expectedRows=ranges.flatMap(([,first,last])=>Array.from({length:last-first+1},(_,i)=>first+i));
  assert.deepEqual(coupleBudgetGroups.flatMap(group=>group.items.map(item=>item.row)),expectedRows);
  for(const [section,first,last] of ranges)for(let row=first;row<=last;row++){
    const data={estimated:{[row]:12345},actual:{[row]:10507},prepaid:{[row]:2079},organizerRows:{[row]:false}};
    const expected={estimated:12345,actual:10507,prepaid:2079,remaining:8428};
    const totals=coupleBudgetTotals(data);
    assert.equal(coupleBudgetRemaining(data,row),8428,`row ${row}`);
    assert.deepEqual(totals.groupTotals[section],expected,`section ${section}, row ${row}`);
    assert.deepEqual(totals.overall,expected,`overall row ${row}`);
    if([28,51,121].includes(section)){
      assert.deepEqual(totals.organizer,expected,`organizer row ${row}`);
      assert.equal(coupleBudgetOrganizerIncluded(data,row),true);
    }
    for(const [other] of ranges)if(other!==section)assert.deepEqual(totals.groupTotals[other],{estimated:0,actual:0,prepaid:0,remaining:0});
  }
});

test('empty cells, partial payment, overpayment and added additional rows retain exact arithmetic',()=>{
  assert.equal(coupleBudgetRemaining({},33),0);
  assert.equal(coupleBudgetRemaining({actual:{33:null},prepaid:{33:101}},33),-101);
  const data={extraItems:{121:[{row:'item_extra',name:'Трансфер',organizer:false}]},actual:{33:105,134:205,item_extra:305},prepaid:{33:200,134:104,item_extra:106}};
  const totals=coupleBudgetTotals(data);
  assert.deepEqual(totals.groupTotals[121],{estimated:0,actual:510,prepaid:210,remaining:300});
  assert.deepEqual(totals.overall,{estimated:0,actual:615,prepaid:410,remaining:205});
  assert.deepEqual(totals.organizer,totals.overall);
});

test('agency fee uses the stable organization/coordination rows, actual before plan and explicit zero',()=>{
  const fee=coupleBudgetAgencyFee({names:{29:'Наш гонорар'},estimated:{29:100000,30:50000},actual:{29:0},prepaid:{29:10001,30:20002,9:90000,134:80000}});
  assert.equal(fee.feeExpected,50000);assert.equal(fee.feePrepaid,30003);
  assert.equal(fee.amountConfigured,true);assert.equal(fee.prepaidConfigured,true);
  assert.equal(fee.items[0].title,'Наш гонорар');assert.deepEqual(fee.items.map(item=>item.row),[29,30]);
  const blank=coupleBudgetAgencyFee({actual:{29:null},prepaid:{30:null}});
  assert.equal(blank.amountConfigured,false);assert.equal(blank.prepaidConfigured,false);
});

test('new rows and sections enter the correct totals without double counting',()=>{
  const data={
    extraItems:{8:[{row:'item_banquet',name:'Свет',note:'',organizer:true}],28:[{row:'item_vendor',name:'Транспорт',note:'',organizer:false}]},
    extraSections:[{row:'section_after',name:'После свадьбы',totalLabel:'Итого по разделу',items:[{row:'item_album',name:'Альбом',note:'',organizer:false}]}],
    estimated:{item_banquet:12000,item_vendor:20000,item_album:30000},
    actual:{item_banquet:11000,item_vendor:18000,item_album:27000},
    prepaid:{item_banquet:4000,item_vendor:5000,item_album:7000}
  };
  let totals=coupleBudgetTotals(data);
  assert.equal(totals.groups.length,8);
  assert.equal(totals.overall.remaining,40000);
  assert.equal(totals.organizer.remaining,20000);
  assert.equal(totals.groupTotals.section_after.remaining,20000);
  assert.equal(coupleBudgetOrganizerIncluded(data,'item_album'),false);
  data.organizerRows={item_album:true,item_banquet:false};
  totals=coupleBudgetTotals(data);
  assert.equal(totals.organizer.remaining,33000);
  assert.equal(coupleBudgetOrganizerIncluded(data,'item_album'),true);
});

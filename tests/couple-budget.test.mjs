import test from 'node:test';
import assert from 'node:assert/strict';
import {coupleBudgetGroups,coupleBudgetItemCount,coupleBudgetTotals,coupleBudgetOrganizerIncluded} from '../src/couple-budget.js';

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

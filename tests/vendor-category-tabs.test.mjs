import test from 'node:test';
import assert from 'node:assert/strict';
import {weddingVendorCategories} from '../src/vendor-category-tabs.mjs';

test('wedding category tabs include only categories with visible proposals',()=>{
  const selections=[
    {data:{categoryId:'photo',categoryName:'Фотограф'}},
    {data:{categoryId:'photo',categoryName:'Фотограф'}},
    {data:{categoryId:'flowers',categoryName:'Флорист',archived:true}},
    {data:{categoryId:'',categoryName:'Без категории'}}
  ];
  assert.deepEqual([...weddingVendorCategories(selections)],[
    ['photo',{name:'Фотограф',count:2}],
    ['name:Без категории',{name:'Без категории',count:1}]
  ]);
  assert.deepEqual(weddingVendorCategories(selections,true).get('flowers'),{name:'Флорист',count:1});
});

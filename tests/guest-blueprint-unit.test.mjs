import test from 'node:test';
import assert from 'node:assert/strict';
import {hasFoodRestriction,countGuestsWithFoodRestrictions,normalizeGuestRegistry,mergeGuestColumns,personalInvitationsEnabled,DEFAULT_GUEST_COLUMNS,DEFAULT_GUEST_SEMANTIC_MAP} from '../src/guest-blueprint.js';

for(const answer of ['', ' ', 'нет', ' НЕТ. ', 'нет аллергий', 'аллергий нет', 'без ограничений', 'без аллергий', 'Нет особенностей!', 'всё ем', 'все ем', 'no','none','n/a','—',false,null,0,{},[]]) {
  test(`guest negative or absent dietary answer is not counted: ${JSON.stringify(answer)}`,()=>assert.equal(hasFoodRestriction(answer),false));
}
for(const answer of ['Орехи','Без глютена','Веган','Нет аллергий, но не ем мясо',true,['Нет','Лактоза'],['нет',['Глютен']]]) {
  test(`guest restrictions are counted once for a person: ${JSON.stringify(answer)}`,()=>assert.equal(hasFoodRestriction(answer),true));
}
test('diet statistics exclude deleted guests and unreadable fields and do not double count people',()=>{
  const rows=[{id:'a',data:{food:'Орехи',diet:'Веган'}},{id:'b',data:{food:'Нет',diet:'Рыба'}},{id:'c',deleted:true,data:{food:'Глютен'}},{id:'d',data:{food:'Нет',diet:''}}];
  assert.equal(countGuestsWithFoodRestrictions(rows,{allergies:'food',diet:'diet'}),2);
  assert.equal(countGuestsWithFoodRestrictions(rows,{allergies:'food',diet:'food'}),1);
  assert.equal(countGuestsWithFoodRestrictions(rows,{allergies:'food',diet:'diet'},(row,field)=>row.id!=='a'&&field==='food'),0);
  assert.equal(countGuestsWithFoodRestrictions(rows,{}),0);
});
test('personal invitations require an actual boolean setting, including for older weddings',()=>{
  for(const value of [undefined,null,false,0,1,'true','false',{}])assert.equal(personalInvitationsEnabled({data:{personalInvitationsEnabled:value}}),false);
  assert.equal(personalInvitationsEnabled({data:{personalInvitationsEnabled:true}}),true);
  assert.equal(personalInvitationsEnabled(null),false);
});
test('guest normalization preserves mapped identities and valid seating columns and owns its nested options',()=>{
  const columns=[{id:'full_name',name:'Старое',type:'text'},{id:'reply',name:'Ответ',type:'select',options:['Да','Нет']},{id:'table_link',type:'relation'},{id:'seat',type:'number'}];
  const map={guestName:'full_name',rsvpStatus:'reply',rsvpValues:{confirmed:'Да',declined:'Нет'},seatingTable:'table_link',seatIndex:'seat'};
  const input=structuredClone({columns,map}),result=normalizeGuestRegistry(columns,map);
  assert.equal(result.columns[0].id,'full_name');assert.equal(result.columns[0].name,'ФИО');
  assert.equal(result.semanticMap.seatingTable,'table_link');assert.equal(result.semanticMap.seatIndex,'seat');
  assert.deepEqual(result.columns.slice(-2).map(c=>c.id),['table_link','seat']);
  result.columns[6].options.push('Может быть');result.semanticMap.rsvpValues.confirmed='Другой';
  assert.deepEqual({columns,map},input);
  const incomplete=normalizeGuestRegistry(columns,{...map,seatIndex:'missing'});
  assert.equal(incomplete.columns.length,7);assert.equal(incomplete.semanticMap.seatingTable,undefined);
  const fallback=normalizeGuestRegistry([],{guestName:'missing'});
  assert.equal(fallback.semanticMap.guestName,'name');assert.deepEqual(fallback.semanticMap.rsvpValues,DEFAULT_GUEST_SEMANTIC_MAP.rsvpValues);
});
test('guest default merging preserves custom fields and types with canonical labels and no duplicates',()=>{
  const custom={id:'vehicle',name:'Автомобиль',type:'text'},columns=[{id:'name',name:'Старое',type:'text'},custom];
  const result=mergeGuestColumns(columns);
  assert.equal(result.length,DEFAULT_GUEST_COLUMNS.length+1);assert.equal(result[0].name,'ФИО');
  assert.equal(result.at(-1).id,'vehicle');assert.equal(new Set(result.map(c=>c.id)).size,result.length);
  assert.equal(columns[0].name,'Старое');
});

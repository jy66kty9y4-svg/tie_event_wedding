import test from 'node:test';
import assert from 'node:assert/strict';
import {findProjectTable} from '../src/ui/project-tables.mjs';

test('both timing audiences select timing even when guest table comes first', () => {
  const guests = {id:'guests',data:{key:'guests',name:'Гости'}};
  const timing = {id:'timing',data:{key:'timing',name:'Программа дня'}};
  for (const tab of ['timing','timing-pair','timing-team']) {
    assert.equal(findProjectTable([guests,timing],tab),timing);
    assert.equal(findProjectTable([timing,guests],tab),timing);
  }
  assert.equal(findProjectTable([guests],'timing-pair'),undefined);
});

test('explicit keys win over legacy names; custom tables still open by ID', () => {
  const legacy = {id:'legacy',data:{name:'Тайминг'}};
  const keyed = {id:'keyed',data:{key:'timing',name:'День'}};
  assert.equal(findProjectTable([legacy,keyed],'timing-team'),keyed);
  assert.equal(findProjectTable([legacy],'timing-pair'),legacy);
  assert.equal(findProjectTable([legacy,keyed],'table','legacy'),legacy);
  assert.equal(findProjectTable([{id:'g',data:{key:'guests',name:'Тайминг гостей'}}],'timing-pair'),undefined);
});

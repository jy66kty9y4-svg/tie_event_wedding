import test from 'node:test';
import assert from 'node:assert/strict';
import {isPastWedding,localDate} from '../src/project-date-tabs.mjs';

const instant=new Date('2026-09-23T21:30:00.000Z');

test('weddings move to completed only after their local wedding date',()=>{
  assert.equal(localDate(instant,'Europe/Moscow'),'2026-09-24');
  assert.equal(localDate(instant,'America/New_York'),'2026-09-23');
  assert.equal(isPastWedding({data:{date:'2026-09-23',timeZone:'Europe/Moscow',status:'planning'}},instant),true);
  assert.equal(isPastWedding({data:{date:'2026-09-24',timeZone:'Europe/Moscow',status:'completed'}},instant),false);
  assert.equal(isPastWedding({data:{date:'2026-09-23',timeZone:'America/New_York'}},instant),false);
  assert.equal(isPastWedding({data:{date:'2026-09-22',timeZone:'America/New_York'}},instant),true);
});

test('unknown dates stay visible among current weddings',()=>{
  assert.equal(isPastWedding({data:{date:'',status:'archived'}},instant),false);
  assert.equal(isPastWedding({data:{date:'later'}},instant),false);
  assert.equal(isPastWedding({},instant),false);
  assert.equal(localDate(instant,'Invalid/Zone'),'2026-09-24');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {addDays,localDate,zonedInstant,timeZone,listPage,changedFields} from '../server/v2/common.mjs';
import {instantToZonedInput,zonedInputToInstant} from '../src/v2/publishing/datetime.mjs';
import {calendarGrid} from '../src/v2/calendar/grid.mjs';

for(const [day,offset,expected] of [
  ['2024-02-28',1,'2024-02-29'],['2024-02-29',1,'2024-03-01'],
  ['2023-02-28',1,'2023-03-01'],['2027-01-01',-1,'2026-12-31'],
  ['2027-12-31',1,'2028-01-01'],['2027-06-12',0,'2027-06-12']
]) test(`calendar shifts whole dates without a time-zone drift: ${day} ${offset}`,()=>assert.equal(addDays(day,offset),expected));
for(const count of [1.5,NaN,Infinity,36601,-36601,'1'])test(`calendar rejects invalid day shifts: ${String(count)}`,()=>assert.throws(()=>addDays('2027-06-12',count),e=>e.status===400));
for(const [zone,local,instant] of [
  ['Europe/Moscow','2027-01-01T00:00','2026-12-31T21:00:00.000Z'],
  ['Asia/Kathmandu','2027-01-01T00:00','2026-12-31T18:15:00.000Z'],
  ['Pacific/Kiritimati','2027-01-01T00:00','2026-12-31T10:00:00.000Z'],
  ['America/Los_Angeles','2027-07-01T00:00','2027-07-01T07:00:00.000Z'],
  ['Australia/Adelaide','2027-01-01T00:00','2026-12-31T13:30:00.000Z']
]) test(`calendar and publishing agree on wall time: ${zone}`,()=>{
  assert.equal(zonedInstant(local.slice(0,10),local.slice(11),zone),instant);
  assert.equal(zonedInputToInstant(local,zone),instant);
  assert.equal(instantToZonedInput(instant,zone),local);
  assert.equal(localDate(Date.parse(instant),zone),local.slice(0,10));
});
for(const [zone,gap] of [['America/New_York','2027-03-14T02:30'],['Europe/Berlin','2027-03-28T02:30'],['Australia/Lord_Howe','2027-10-03T02:15']]) {
  test(`nonexistent wall time is rejected rather than silently shifted: ${zone}`,()=>{
    assert.throws(()=>zonedInstant(gap.slice(0,10),gap.slice(11),zone),e=>e.status===400);
    assert.throws(()=>zonedInputToInstant(gap,zone));
  });
}
test('DST folds require a choice; preserving the later published instant keeps the intended occurrence',()=>{
  const day='2027-11-07',wall='01:30',zone='America/New_York';
  assert.throws(()=>zonedInstant(day,wall,zone),e=>e.status===409&&e.details.candidates.length===2);
  const first=zonedInstant(day,wall,zone,'earlier'),second=zonedInstant(day,wall,zone,'later');
  assert.equal(first,'2027-11-07T05:30:00.000Z');assert.equal(second,'2027-11-07T06:30:00.000Z');
  assert.equal(zonedInputToInstant(`${day}T${wall}`,zone,second),second);
  assert.equal(zonedInputToInstant(`${day}T${wall}`,zone),first);
});
test('publishing accepts empty deadlines and rejects malformed ones and unknown time zones',()=>{
  assert.equal(instantToZonedInput(null),'');assert.equal(zonedInputToInstant(''),'');
  for(const v of ['broken','2027-13-01T00:00','2027-02-30T00:00','2027-01-01T24:00'])assert.throws(()=>zonedInputToInstant(v));
  assert.throws(()=>instantToZonedInput('not-an-instant'));
  for(const v of ['Mars/Olympus',null,123,'x'.repeat(101)])assert.throws(()=>timeZone(v),e=>e.status===400);
  for(const v of ['24:00','10:60','9:05',''])assert.throws(()=>zonedInstant('2027-06-12',v),e=>e.status===400);
});
test('every month grid spans six full Monday-first weeks, including year and leap-day boundaries',()=>{
  for(let year=2024;year<=2028;year++)for(let month=1;month<=12;month++) {
    const day=`${year}-${String(month).padStart(2,'0')}-15`,grid=calendarGrid(day);
    assert.equal(grid.days.length,42);assert.equal(new Set(grid.days).size,42);
    assert.equal(new Date(grid.start+'T12:00:00Z').getUTCDay(),1);
    assert(grid.days.includes(day));assert(grid.days.includes(day.slice(0,8)+'01'));
    for(let i=1;i<grid.days.length;i++)assert.equal(Date.parse(grid.days[i])-Date.parse(grid.days[i-1]),86400000);
    const week=calendarGrid(day,'week');assert.equal(week.days.length,7);assert(week.days.includes(day));
  }
  assert.deepEqual(calendarGrid('broken'),calendarGrid('1970-01-01'));
});
for(const [query,expected,next] of [[{},[0,1,2,3,4],null],[{offset:1,limit:2},[1,2],3],[{offset:3,limit:2},[3,4],null],[{offset:99,limit:1},[],null],[{offset:'0',limit:'1'},[0],1]]) {
  test(`pagination reports exact boundaries without changing its input: ${JSON.stringify(query)}`,()=>{
    const rows=[0,1,2,3,4],page=listPage(rows,query);
    assert.deepEqual(page.items,expected);assert.equal(page.nextOffset,next);assert.equal(page.total,5);assert.deepEqual(rows,[0,1,2,3,4]);
  });
}
for(const query of [{offset:-1},{offset:.5},{limit:0},{limit:201},{limit:Infinity},{offset:'bad'},{limit:1.5}]) {
  test(`pagination rejects malformed controls: ${JSON.stringify(query)}`,()=>assert.throws(()=>listPage([],query),e=>e.status===400));
}
test('history field changes include removals, additions and nested values, including zero and null',()=>{
  assert.deepEqual(changedFields({a:0,b:null,c:{value:1},removed:true},{a:null,b:null,c:{value:2},added:0}),['a','c','removed','added']);
  assert.deepEqual(changedFields(null,{}),[]);
  assert.deepEqual(changedFields({a:[1,2]},{a:[1,2]}),[]);
});

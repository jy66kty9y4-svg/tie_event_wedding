import test from 'node:test';
import assert from 'node:assert/strict';
import {isPastWedding,localDate,sortWeddingsByDate} from '../src/project-date-tabs.mjs';

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

test('current weddings show the nearest date first, with undated weddings last and stable ties',()=>{
  const projects=[
    {id:'open',data:{date:''}},
    {id:'later',data:{date:'2027-06-12'}},
    {id:'today',data:{date:'2026-09-24'}},
    {id:'soon',data:{date:'2026-10-01'}},
    {id:'same-day',data:{date:'2026-10-01'}},
    {id:'unknown',data:{date:'later'}}
  ];
  const original=projects.slice();
  const sorted=sortWeddingsByDate(projects);
  assert.deepEqual(sorted.map(project=>project.id),['today','soon','same-day','later','open','unknown']);
  assert.deepEqual(projects,original);
  assert.equal(sorted[0],projects[2]);
});

test('completed weddings show the most recent wedding date first',()=>{
  const projects=[{date:'2025-12-12'},{date:'2026-09-23'},{date:'2026-08-01'},{date:''}];
  assert.deepEqual(sortWeddingsByDate(projects,{past:true}).map(project=>project.date),['2026-09-23','2026-08-01','2025-12-12','']);
});

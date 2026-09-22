import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoute,viewUrl} from '../src/v2/routes.js';
import {calendarGrid} from '../src/v2/calendar/grid.mjs';

test('attention routes retain their source ID and resolve to the intended project workspace',()=>{
  const guest=parseRoute('/app/projects/wedding-1/guests/guest-9');
  const seating=parseRoute('/app/projects/wedding-1/seating/guest-9');
  assert.deepEqual(guest,{projectId:'wedding-1',view:'project:guests:guest-9'});
  assert.deepEqual(seating,{projectId:'wedding-1',view:'project:seating:guest-9'});
  assert.equal(viewUrl('project:seating:guest-9','wedding-1'),'/app/projects/wedding-1/seating/guest-9');
});

test('month and week calendar grids start on Monday and contain the selected date',()=>{
  const september=calendarGrid('2026-09-14','month');
  assert.equal(september.start,'2026-08-31');
  assert.equal(september.days.length,42);
  assert.equal(september.days[1],'2026-09-01');
  assert.equal(september.days.includes('2026-09-14'),true);
  const week=calendarGrid('2026-09-14','week');
  assert.deepEqual(week.days,['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20']);
  assert.equal(calendarGrid('','month').days.length,42);
  assert.equal(calendarGrid(null,'week').days.length,7);
});

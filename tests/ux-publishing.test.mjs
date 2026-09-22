import test from 'node:test';
import assert from 'node:assert/strict';
import { instantToZonedInput, zonedInputToInstant } from '../src/v2/publishing/datetime.mjs';
import { confirmNavigation, registerNavigationGuard } from '../src/ui/unsaved-changes.mjs';

test('microsite close time round-trips in the project time zone without drift', () => {
  const stored = '2027-09-14T20:00:37.123Z';
  const input = instantToZonedInput(stored, 'Europe/Moscow');
  assert.equal(input, '2027-09-14T23:00');
  assert.equal(zonedInputToInstant(input, 'Europe/Moscow', stored), stored);
  assert.equal(zonedInputToInstant('2027-09-15T00:00', 'Europe/Moscow', stored), '2027-09-14T21:00:00.000Z');
});

test('microsite close time preserves the selected instant through a repeated DST hour', () => {
  const secondOccurrence = '2027-10-31T01:30:45.123Z';
  const input = instantToZonedInput(secondOccurrence, 'Europe/Berlin');
  assert.equal(input, '2027-10-31T02:30');
  assert.equal(zonedInputToInstant(input, 'Europe/Berlin', secondOccurrence), secondOccurrence);
  assert.throws(
    () => zonedInputToInstant('2027-03-28T02:30', 'Europe/Berlin'),
    /не существует из-за перевода часов/,
  );
});

test('navigation guards synchronously block, allow, and unregister transitions', () => {
  const calls = [];
  const unregisterAllow = registerNavigationGuard(() => { calls.push('allow'); return true; });
  const unregisterBlock = registerNavigationGuard(() => { calls.push('block'); return false; });
  const unregisterSkipped = registerNavigationGuard(() => { calls.push('skipped'); return true; });

  assert.equal(confirmNavigation(), false);
  assert.deepEqual(calls, ['allow', 'block']);
  unregisterBlock();
  calls.length = 0;
  assert.equal(confirmNavigation(), true);
  assert.deepEqual(calls, ['allow', 'skipped']);

  unregisterAllow();
  unregisterSkipped();
  assert.equal(confirmNavigation(), true);
});

test('a failing navigation guard blocks the transition safely', () => {
  const unregister = registerNavigationGuard(() => { throw new Error('guard failed'); });
  assert.equal(confirmNavigation(), false);
  unregister();
});

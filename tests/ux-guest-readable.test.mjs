import test from 'node:test';
import assert from 'node:assert/strict';
import { readableGuestField } from '../src/v2/guest/readable.mjs';

const table = { id: 'guests' };
const row = { id: 'leonid' };

test('guest field readability distinguishes an empty accessible value from a denied field', () => {
  const partial = (action, section, rowId, field) => action === 'read' && section === 'guests' && rowId === 'leonid' && field === 'seat_table';
  assert.equal(readableGuestField(partial, table, row, 'seat_table'), true);
  assert.equal(readableGuestField(partial, table, row, 'rsvp_status'), false);
  assert.equal(readableGuestField(partial, table, row, ''), false);
});

test('protected guest reads allow mapped empty fields for every row', () => {
  assert.equal(readableGuestField(() => true, table, row, 'seat_table'), true);
  assert.equal(readableGuestField(() => true, table, row, 'rsvp_status'), true);
});

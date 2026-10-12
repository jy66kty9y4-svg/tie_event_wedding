import test from 'node:test';
import assert from 'node:assert/strict';
import { lockModalBackground } from '../src/ui/modal-lock.mjs';

const page = (inert = false, overflow = '') => {
  const shell = { inert }, body = { style: { overflow } };
  return { shell, body, querySelector: () => shell };
};

test('closing an editor and confirmation in either order restores clicks and scrolling', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const doc = page(false, 'auto');
    const release = [lockModalBackground(doc), lockModalBackground(doc)];
    assert.equal(doc.shell.inert, true);
    assert.equal(doc.body.style.overflow, 'hidden');
    release[order[0]]();
    assert.equal(doc.shell.inert, true);
    assert.equal(doc.body.style.overflow, 'hidden');
    release[order[1]]();
    assert.equal(doc.shell.inert, false);
    assert.equal(doc.body.style.overflow, 'auto');
  }
});

test('repeated cleanup cannot unlock a remaining dialog or leak into the next opening', () => {
  const doc = page(), outer = lockModalBackground(doc), inner = lockModalBackground(doc);
  outer(); outer();
  assert.equal(doc.shell.inert, true);
  inner(); inner();
  assert.equal(doc.shell.inert, false);
  assert.equal(doc.body.style.overflow, '');
  doc.body.style.overflow = 'scroll';
  const next = lockModalBackground(doc);
  next();
  assert.equal(doc.shell.inert, false);
  assert.equal(doc.body.style.overflow, 'scroll');
});

test('dialogs preserve an existing background lock and also work outside the private shell', () => {
  const doc = page(true, 'clip'), release = lockModalBackground(doc);
  release();
  assert.equal(doc.shell.inert, true);
  assert.equal(doc.body.style.overflow, 'clip');
  const publicPage = { body: { style: { overflow: '' } }, querySelector: () => null };
  const close = lockModalBackground(publicPage);
  assert.equal(publicPage.body.style.overflow, 'hidden');
  close();
  assert.equal(publicPage.body.style.overflow, '');
});

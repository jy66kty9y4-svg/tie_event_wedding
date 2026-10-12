import test from 'node:test';
import assert from 'node:assert/strict';
import { editPhoneInput, formatPhoneInput } from '../src/phone-input.js';
import { normalizePhone } from '../src/auth-identity.js';

function edit(source, start, end, text, inputType = 'insertText') {
  const display = formatPhoneInput(source);
  return editPhoneInput(source, display.slice(0, start) + text + display.slice(end), start + text.length, inputType);
}

test('phone input adds the Russian mask while typing and immediately replaces a domestic 8', () => {
  let state = { value: '', caret: 0 };
  const displays = [];
  for (const digit of '89991234567') {
    state = edit(state.value, state.caret, state.caret, digit);
    displays.push(formatPhoneInput(state.value));
  }
  assert.equal(displays[0], '+7');
  assert.equal(displays[1], '+7 (9');
  assert.equal(displays[3], '+7 (999) ');
  assert.equal(displays.at(-1), '+7 (999) 123-45-67');
  assert.equal(state.caret, 18);
  assert.equal(normalizePhone(state.value), '+79991234567');
});

test('pasted numbers and autofill accept domestic, national and already formatted numbers', () => {
  for (const number of ['89991234567', '8 (999) 123-45-67', '79991234567', '9991234567', '+7 (999) 123-45-67']) {
    const state = editPhoneInput('', number);
    assert.equal(formatPhoneInput(state.value), '+7 (999) 123-45-67');
    assert.equal(normalizePhone(state.value), '+79991234567');
  }
  assert.equal(formatPhoneInput('+44 20 7946 0958'), '+7 (442) 079-46-09');
});

test('backspace passes mask punctuation, including the final country prefix, without trapping the caret', () => {
  let source = '89991234567';
  while (source) {
    const display = formatPhoneInput(source);
    const state = edit(source, display.length - 1, display.length, '', 'deleteContentBackward');
    assert.equal(state.value.length, source.length - 1);
    assert.equal(state.caret, formatPhoneInput(state.value).length);
    source = state.value;
  }
  assert.equal(formatPhoneInput(source), '');
});

test('middle edits keep the caret by the edited digits and delete through separators in either direction', () => {
  const source = '89991234567';
  const replacement = edit(source, 9, 12, '321', 'insertFromPaste');
  assert.equal(formatPhoneInput(replacement.value), '+7 (999) 321-45-67');
  assert.equal(replacement.caret, 13);
  const backward = edit(source, 12, 13, '', 'deleteContentBackward');
  assert.equal(backward.value, '8999124567');
  assert.equal(backward.caret, 11);
  const forward = edit(source, 12, 13, '', 'deleteContentForward');
  assert.equal(forward.value, '8999123567');
  assert.equal(forward.caret, 13);
  const repeated = edit(source, 5, 6, '', 'deleteContentBackward');
  assert.equal(repeated.caret, 5);
  assert.equal(repeated.value, '8991234567');
  assert.equal(edit(source, 0, 18, '', 'deleteContentBackward').value, '');
});

test('typing and pasting cannot exceed the eleven-digit Russian mask', () => {
  for (const pasted of ['89991234567890123', '+7 (999) 123-45-67890', '9991234567890']) {
    const state = editPhoneInput('', pasted);
    assert.equal(formatPhoneInput(state.value), '+7 (999) 123-45-67');
    assert.equal(formatPhoneInput(state.value).replace(/\D/g, '').length, 11);
  }
  const source = '89991234567';
  for (const position of [5, 10, 18]) {
    const state = edit(source, position, position, '999');
    assert.equal(state.value, source, 'extra digits must not displace the existing number');
    assert.equal(state.caret, position);
  }
  const shortened = edit(source, 17, 18, '', 'deleteContentBackward');
  const restored = edit(shortened.value, shortened.caret, shortened.caret, '8');
  assert.equal(formatPhoneInput(restored.value), '+7 (999) 123-45-68');
});

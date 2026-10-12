function cleanInput(value) {
  const digits = value.replace(/\D/g, '');
  const explicitPrefix = value.trimStart().startsWith('+7');
  const limit = /^[78]/.test(digits) ? 11 : 10;
  return `${explicitPrefix ? '+' : ''}${digits.slice(0, limit)}`;
}

// Map each displayed digit back to the source, including the substituted 8 prefix.
function phoneView(source) {
  if (!source) {
    return { text: source, positions: Array.from(source, (_, index) => index) };
  }
  let text = '';
  const positions = [];
  const append = (characters, position = null) => {
    text += characters;
    positions.push(...Array(characters.length).fill(position));
  };
  const explicitPrefix = source.startsWith('+7');
  const domesticPrefix = /^[78]/.test(source);
  const start = explicitPrefix ? 2 : domesticPrefix ? 1 : 0;
  append('+', explicitPrefix ? 0 : null);
  append('7', explicitPrefix ? 1 : domesticPrefix ? 0 : null);
  if (source.length > start) append(' (');
  for (let index = start; index < source.length; index += 1) {
    append(source[index], index);
    const count = index - start + 1;
    if (count === 3) append(') ');
    if (count === 6 || count === 8) append('-');
  }
  return { text, positions };
}

export function formatPhoneInput(value) {
  return phoneView(cleanInput(value)).text;
}

// Translate edits through the mask, including deletion next to its separators.
export function editPhoneInput(source, nextText, caret = nextText.length, inputType = '') {
  const previous = phoneView(source);
  let start = 0;
  while (start < previous.text.length && start < nextText.length && previous.text[start] === nextText[start]) start += 1;
  let end = previous.text.length;
  let nextEnd = nextText.length;
  while (end > start && nextEnd > start && previous.text[end - 1] === nextText[nextEnd - 1]) { end -= 1; nextEnd -= 1; }
  const removed = end - start;
  const inserted = nextEnd - start;
  // The browser's caret disambiguates edits among repeated digits.
  const caretStart = caret - inserted;
  if (caretStart >= 0 && previous.text.slice(0, caretStart) === nextText.slice(0, caretStart)
    && previous.text.slice(caretStart + removed) === nextText.slice(caret)) {
    start = caretStart;
    end = start + removed;
    nextEnd = caret;
  }
  const offset = position => previous.positions.slice(0, position).filter(index => index !== null).length;
  let sourceStart = offset(start);
  let sourceEnd = offset(end);
  if (removed && !inserted && sourceStart === sourceEnd) {
    if (inputType === 'deleteContentBackward') sourceStart = Math.max(0, sourceStart - 1);
    if (inputType === 'deleteContentForward') sourceEnd = Math.min(source.length, sourceEnd + 1);
  }
  const insertion = nextText.slice(start, nextEnd);
  if (sourceStart === sourceEnd && /\d/.test(insertion) && previous.text.replace(/\D/g, '').length === 11) {
    return { value: source, caret: start };
  }
  const candidate = source.slice(0, sourceStart) + insertion + source.slice(sourceEnd);
  const beforeCaret = cleanInput(source.slice(0, sourceStart) + insertion);
  const value = cleanInput(candidate);
  const view = phoneView(value);
  const nextPosition = view.positions.findIndex(index => index !== null && index >= beforeCaret.length);
  return { value, caret: nextPosition === -1 ? view.text.length : nextPosition };
}

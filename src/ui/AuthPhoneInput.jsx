import { useLayoutEffect, useRef } from 'react';
import { editPhoneInput, formatPhoneInput } from '../phone-input.js';

export function AuthPhoneInput({ value, onChange, inputRef, ...props }) {
  const input = useRef(null);
  const caret = useRef(null);
  useLayoutEffect(() => {
    if (caret.current === null) return;
    input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  return <input {...props} ref={element => { input.current = element; if (inputRef) inputRef.current = element; }} value={formatPhoneInput(value)} onChange={event => {
    const edit = editPhoneInput(value, event.target.value, event.target.selectionStart ?? event.target.value.length, event.nativeEvent.inputType);
    caret.current = edit.caret;
    onChange(edit.value);
  }} />;
}

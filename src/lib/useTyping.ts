import { useEffect, useState } from 'react';

// Inputs that take a tap, not typing: no keyboard comes up for them.
const NOT_TYPED = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether focus on `el` brings up a phone's keyboard. */
export function takesTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return !el.readOnly && !NOT_TYPED.has(el.type);
  // jsdom leaves isContentEditable undefined.
  return el.isContentEditable === true;
}

/**
 * True while focus is in a field that types: a phone's keyboard is up. On an
 * iPhone a fixed bar rides up above the keyboard, mid-screen, so the tab bar
 * steps aside while it's there.
 *
 * A focused field taken off the page fires no focusout in Safari (a form
 * that navigates away as it's sent), so the answer is checked against what
 * has focus now at every render, which a route change brings.
 */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(() => takesTyping(document.activeElement));
  useEffect(() => {
    const onIn = (e: FocusEvent) => setTyping(takesTyping(e.target));
    // Focus leaving for nothing (a tap on the page) ends the typing; focus
    // moving to another field is caught by its own focusin.
    const onOut = (e: FocusEvent) => setTyping(takesTyping(e.relatedTarget));
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return typing && takesTyping(document.activeElement);
}

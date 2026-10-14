import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

// Keys that move a closed <select>'s value without opening it (Chrome and
// Firefox on Windows and Linux fire `change` for each), or type ahead to an
// option. Space opens the list instead, so it doesn't count.
function browses(e: KeyboardEvent): boolean {
  if (e.altKey) return false; // Alt+Down opens the list
  const k = e.key;
  return (
    k.startsWith('Arrow') ||
    k === 'Home' ||
    k === 'End' ||
    k === 'PageUp' ||
    k === 'PageDown' ||
    (k.length === 1 && k !== ' ')
  );
}

/**
 * Props for a <select> that adds the option picked to a list (#9). Picking
 * with the mouse or a native picker adds it at once; browsing with the
 * keyboard only moves the selection, which Enter or leaving the control then
 * adds, so arrowing through the names doesn't add every one on the way.
 */
export function useAddPicker(onAdd: (value: string) => void) {
  const [pending, setPending] = useState('');
  const browsing = useRef(false);
  // Only ever a real option: the placeholder is disabled, and Enter or blur
  // add only a browsed-to value.
  function add(value: string) {
    setPending('');
    onAdd(value);
  }
  return {
    value: pending,
    onKeyDown(e: KeyboardEvent<HTMLSelectElement>) {
      if (e.key === 'Enter' && pending) {
        e.preventDefault();
        add(pending);
      } else {
        browsing.current = browses(e);
      }
    },
    onChange(e: ChangeEvent<HTMLSelectElement>) {
      if (browsing.current) {
        browsing.current = false;
        setPending(e.target.value);
      } else {
        add(e.target.value);
      }
    },
    onBlur() {
      browsing.current = false;
      if (pending) add(pending);
    },
  };
}

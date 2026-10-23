import { useEffect, useState, type RefObject } from 'react';

// Keyboard focus for a modal dialog (#258): Tab stays inside it, and closing
// it hands focus back to whatever opened it.

// The kinds of control the app puts in a dialog; [tabindex] covers the rest
// (a map, say).
const TABBABLE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[tabindex]',
].join(', ');

/**
 * The controls inside `container` that Tab reaches, in order: enabled, not
 * taken out by tabindex="-1", and not inert, hidden or (where the browser can
 * tell, which jsdom can't) laid out invisibly.
 */
export function tabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      !el.closest('[inert], [hidden]') &&
      (el.checkVisibility?.({ visibilityProperty: true }) ?? true),
  );
}

/**
 * Keeps Tab inside the element `dialog` points at while `enabled`: Tab from
 * its last control wraps to its first, and Shift+Tab from its first (or from
 * the dialog itself) wraps to its last. Everything in between is left to the
 * browser. A layer drawn beside the dialog (the edit form) isn't inside it,
 * so its keys never reach this.
 */
export function useFocusTrap(dialog: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const el = dialog.current;
    if (!el || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      const order = tabbables(el);
      const first = order[0];
      const last = order[order.length - 1];
      const at = document.activeElement;
      if (!first) {
        // Nothing to go to: stay on the dialog.
        e.preventDefault();
        return;
      }
      if (e.shiftKey && (at === first || at === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [dialog, enabled]);
}

/**
 * Hands focus back, on unmount, to the element that had it when the caller
 * first rendered (the card or pin that opened a dialog), if it's still on the
 * page. Without scrolling: the page under the dialog hasn't moved.
 */
export function useReturnFocus(): void {
  const [opener] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    },
    [opener],
  );
}

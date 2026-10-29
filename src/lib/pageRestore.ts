import { useEffect, useRef } from 'react';

/**
 * Calls `onRestore` when the browser brings this page back from its
 * back-forward cache (Back from Google's or Apple's sign-in page): the page
 * returns as it was left, mid-way to somewhere else, so whatever said
 * "Opening…" has to stand down.
 */
export function useOnPageRestore(onRestore: () => void): void {
  const latest = useRef(onRestore);
  useEffect(() => {
    latest.current = onRestore;
  });
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) latest.current();
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
}

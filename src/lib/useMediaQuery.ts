import { useEffect, useState } from 'react';

/**
 * Reactive CSS media-query hook. Returns whether `query` currently matches and
 * re-renders when it changes (e.g. the viewport crosses a breakpoint).
 *
 * Guards `window.matchMedia` so it degrades cleanly in non-DOM environments
 * (and in jsdom, where `matchMedia` is undefined) — there it reports `false`.
 * The split view uses this to pick its default layout (Split on desktop, List
 * on mobile, see #93) and to avoid mounting the map column when it would be
 * hidden under the `lg` breakpoint.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesQuery(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
      return;
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    // Sync immediately in case the query changed between render and effect.
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

function matchesQuery(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return false;
  return window.matchMedia(query).matches;
}

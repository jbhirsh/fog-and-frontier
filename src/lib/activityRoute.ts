import { useCallback, useLayoutEffect, useRef } from 'react';
import { matchPath, useLocation, useNavigate, type Location } from 'react-router-dom';

// Permalinks for catalog items (#86). Every activity, restaurants included,
// lives at /activity/:id. Opening one from a page keeps that page rendered
// underneath (the "background location" in the history entry's state) and
// shows the detail on top, so the catalog's filters and scroll survive.

export const ACTIVITY_PATH = '/activity/:id';

export function activityPath(id: string): string {
  return `/activity/${encodeURIComponent(id)}`;
}

export function isActivityPath(pathname: string): boolean {
  return matchPath(ACTIVITY_PATH, pathname) !== null;
}

/** History state carried by an activity opened over another page. */
export interface ActivityRouteState {
  /** The page rendered underneath the detail. */
  backgroundLocation: Location;
  /** Activities opened in a row (nearby taps add one), so close can pop them all. */
  depth: number;
  /** Opened from a link straight to an activity, with no page of ours behind it. */
  cold?: boolean;
  /**
   * The ids of the browse list it was opened from, in order (#64), so the
   * detail can step to the previous and next one.
   */
  list?: string[];
}

export function readActivityState(state: unknown): ActivityRouteState | null {
  // Anything but null or undefined destructures; a non-object just lacks the fields.
  if (state == null) return null;
  const { backgroundLocation, depth, cold, list } = state as Partial<ActivityRouteState>;
  if (
    typeof backgroundLocation !== 'object' ||
    backgroundLocation === null ||
    typeof backgroundLocation.pathname !== 'string' ||
    typeof depth !== 'number'
  ) {
    return null;
  }
  const ids =
    Array.isArray(list) && list.every((id) => typeof id === 'string') ? { list } : {};
  return { backgroundLocation, depth, cold: cold === true, ...ids };
}

/** Where an activity sits in the list it was opened from, and its neighbours. */
export interface ListPosition {
  index: number;
  total: number;
  prev: string | null;
  next: string | null;
}

/**
 * The activity's place in the list, or null when there's nothing to step
 * through: no list, an activity not in it (a nearby pick from elsewhere), or a
 * list of one. The ends have no neighbour: it doesn't wrap around.
 */
export function listPosition(list: readonly string[] | undefined, id: string): ListPosition | null {
  if (!list || list.length < 2) return null;
  const index = list.indexOf(id);
  if (index < 0) return null;
  return {
    index,
    total: list.length,
    prev: index > 0 ? list[index - 1] : null,
    next: index < list.length - 1 ? list[index + 1] : null,
  };
}

/** The catalog, shown behind an activity opened from a link. */
export const CATALOG_LOCATION: Location = {
  pathname: '/',
  search: '',
  hash: '',
  state: null,
  key: 'catalog',
};

/**
 * The page to render underneath, or null when no detail is open over one. A
 * direct link to an activity has no page of ours behind it, so it gets the
 * catalog.
 */
export function backgroundFor(location: Location): Location | null {
  const state = readActivityState(location.state);
  if (state) return state.backgroundLocation;
  return isActivityPath(location.pathname) ? CATALOG_LOCATION : null;
}

/**
 * Opens an activity's permalink over the current page. `list` is the browse
 * list it was opened from, in order (#64); from an open detail, the list it
 * was opened with carries over.
 */
export function useOpenActivity(): (id: string, list?: readonly string[]) => void {
  const navigate = useNavigate();
  const location = useLocation();
  // Like close, only the first open from an entry counts: the router applies
  // it in a transition, so a second one before it lands (a double click, a
  // quick second step) would push the same entry twice at the same depth,
  // and close would then stop one short.
  const opened = useRef<string | null>(null);
  useLayoutEffect(() => {
    opened.current = null;
  }, [location.key]);
  return useCallback(
    (id: string, list?: readonly string[]) => {
      if (opened.current === location.key) return;
      opened.current = location.key;
      const current = readActivityState(location.state);
      let state: ActivityRouteState;
      if (current) {
        // From an open detail (a nearby tap, or a step through the list):
        // same page underneath, one deeper.
        state = { ...current, depth: current.depth + 1 };
      } else if (isActivityPath(location.pathname)) {
        state = { backgroundLocation: CATALOG_LOCATION, depth: 1, cold: true };
      } else {
        state = { backgroundLocation: location, depth: 1 };
      }
      if (list) state.list = [...list];
      void navigate(activityPath(id), { state });
    },
    [navigate, location],
  );
}

/**
 * Closes the detail: steps back past every activity opened in a row, back to
 * the page underneath. An activity reached from a link goes to the catalog
 * instead, replacing the entry.
 *
 * Only the first close from an entry counts. The router applies a history
 * step in a transition, so the detail stays up (and clickable) for a moment
 * after it: a double click, or Escape then a click, would otherwise step
 * back twice, past the page underneath. A close that arrives after the
 * entry has already changed (a delete finishing after Back) is stale and
 * dropped too.
 */
export function useCloseActivity(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const live = useRef<string | null>(location.key);
  const closed = useRef<string | null>(null);
  useLayoutEffect(() => {
    live.current = location.key;
    // A new entry, or Forward back onto one closed before: it can close again.
    closed.current = null;
    return () => {
      live.current = null;
    };
  }, [location.key]);
  return useCallback(() => {
    if (live.current !== location.key || closed.current === location.key) return;
    closed.current = location.key;
    const state = readActivityState(location.state);
    if (state && !state.cold) {
      void navigate(-state.depth);
    } else {
      void navigate('/', { replace: true });
    }
  }, [navigate, location]);
}

import type { Activity } from '../data/types';

/**
 * Pure, Leaflet-free geographic bounds. Mirrors the four edges of a map
 * viewport. Kept as a plain shape so the bounds filter can be unit-tested
 * without instantiating a map.
 *
 * See issue #95 (part of split-view #4): the list auto-refilters to the
 * activities whose coordinates fall inside the current viewport.
 */
export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Minimal structural shape of a Leaflet LatLngBounds, so the adapter below can
// accept the real thing without importing Leaflet into this pure module.
interface LeafletLatLngBoundsLike {
  getNorth(): number;
  getSouth(): number;
  getEast(): number;
  getWest(): number;
}

/**
 * Adapter from a Leaflet `LatLngBounds` (or anything with the same getters) to
 * the plain {@link MapBounds} shape consumed by {@link filterByBounds}. This is
 * the only seam that touches Leaflet's API; everything downstream is pure.
 */
export function toMapBounds(bounds: LeafletLatLngBoundsLike): MapBounds {
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };
}

function hasValidCoords(
  activity: Activity,
): activity is Activity & { location: { coords: { lat: number; lng: number } } } {
  const coords = activity.location?.coords;
  if (!coords) return false;
  return Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
}

/**
 * Returns true when the given latitude/longitude falls inside `bounds`.
 * Edges are inclusive (matching Leaflet's `LatLngBounds.contains`).
 *
 * Longitude handling supports an antimeridian-crossing viewport (where the
 * eastern edge is numerically smaller than the western edge, e.g. panned across
 * the 180°/-180° line): in that case a point matches if it is east of `west`
 * OR west of `east`.
 */
export function isWithinBounds(
  lat: number,
  lng: number,
  bounds: MapBounds,
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  const withinLat = lat <= bounds.north && lat >= bounds.south;
  if (!withinLat) return false;

  const withinLng =
    bounds.west <= bounds.east
      ? lng >= bounds.west && lng <= bounds.east
      : lng >= bounds.west || lng <= bounds.east;

  return withinLng;
}

/**
 * Pure bounds filter: given a list of activities and a plain {@link MapBounds},
 * return those whose coordinates fall inside the bounds. Activities missing or
 * with non-finite coordinates are excluded.
 *
 * This stacks on top of the other catalog filters — callers pass an already
 * filtered list and narrow it further to the current viewport.
 */
export function filterByBounds(
  activities: readonly Activity[],
  bounds: MapBounds,
): Activity[] {
  return activities.filter((activity) => {
    if (!hasValidCoords(activity)) return false;
    const { lat, lng } = activity.location.coords;
    return isWithinBounds(lat, lng, bounds);
  });
}

/**
 * Small generic debounce. Delays invoking `fn` until `delay` ms have elapsed
 * since the last call — used to recompute the bounds filter only after the map
 * settles (~400 ms after the final pan/zoom). The returned function exposes a
 * `cancel` to drop any pending invocation (e.g. on unmount).
 *
 * No existing debounce helper was found in `src/lib`, so this is the canonical
 * one for the repo.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay = 400,
): ((...args: Args) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const debounced = (...args: Args): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delay);
  };

  debounced.cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return debounced;
}

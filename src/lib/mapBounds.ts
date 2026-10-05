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

// Wrap a longitude into [-180, 180) by taking off whole turns.
function wrapLng(lng: number): number {
  return lng - 360 * Math.round(lng / 360);
}

/**
 * Adapter from a Leaflet `LatLngBounds` (or anything with the same getters) to
 * the plain {@link MapBounds} shape consumed by {@link filterByBounds}. This is
 * the only seam that touches Leaflet's API; everything downstream is pure.
 *
 * Normalizes longitudes: Leaflet's `getWest()/getEast()` run outside
 * [-180, 180] once the user pans across world copies (e.g. `west: -200`), and
 * the activities use normalized longitudes. A viewport spanning a full world
 * or more contains every longitude, so it collapses to the whole range rather
 * than wrapping into a misleading antimeridian window.
 */
export function toMapBounds(bounds: LeafletLatLngBoundsLike): MapBounds {
  const north = bounds.getNorth();
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  if (east - west >= 360) return { north, south, east: 180, west: -180 };
  return { north, south, east: wrapLng(east), west: wrapLng(west) };
}

/**
 * Returns true when the given latitude/longitude falls inside `bounds`.
 * Edges are inclusive (matching Leaflet's `LatLngBounds.contains`).
 *
 * Longitude handling supports an antimeridian-crossing viewport (where the
 * eastern edge is numerically smaller than the western edge, e.g. panned across
 * the 180°/-180° line): in that case a point matches if it is east of `west`
 * OR west of `east`.
 *
 * Assumes both the point and the bounds use normalized longitudes in
 * [-180, 180]; {@link toMapBounds} normalizes a Leaflet viewport.
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
    // Coords are typed as required, but a row can still arrive without them.
    // Non-finite values need no check here: isWithinBounds rejects them.
    const coords = activity.location.coords;
    if (!coords) return false;
    return isWithinBounds(coords.lat, coords.lng, bounds);
  });
}

/** South-west and north-east corners, in Leaflet's `[[lat, lng], [lat, lng]]`. */
export type LatLngCorners = [[number, number], [number, number]];

/**
 * The smallest box enclosing every activity with finite coordinates, as
 * corners Leaflet's `fitBounds` / `flyToBounds` accept, or `null` when no
 * activity has usable coordinates (there is nothing to fit). "Clear bounds"
 * re-frames the map to this box so the map and the list agree again (#106).
 */
export function activitiesBounds(
  activities: readonly Activity[],
): LatLngCorners | null {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const activity of activities) {
    // Coords are typed as required, but a row can still arrive without them.
    const coords = activity.location.coords;
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
      continue;
    }
    south = Math.min(south, coords.lat);
    north = Math.max(north, coords.lat);
    west = Math.min(west, coords.lng);
    east = Math.max(east, coords.lng);
  }
  return north === -Infinity
    ? null
    : [
        [south, west],
        [north, east],
      ];
}

/**
 * Lets the map's bounds watcher tell its own viewport changes from a
 * programmatic one. The "Clear bounds" re-fit (#106) arms the gate before it
 * flies the map; the watcher then swallows the events that flight fires,
 * through the `moveend` that ends it, instead of re-applying a bounds filter
 * the user just cleared.
 */
export interface MoveGate {
  /** Mark the next viewport change, up to its `moveend`, as programmatic. */
  arm(): void;
  /**
   * Hand the viewport back to the user mid-move: a drag stops a flight
   * without the flight's own `moveend`, so the drag's must count.
   */
  disarm(): void;
  /** Whether a programmatic move is under way. */
  isArmed(): boolean;
  /**
   * Whether the watcher should ignore a viewport event of this type. True
   * while armed; a `moveend` ends the programmatic move and disarms the gate.
   */
  swallow(eventType: string): boolean;
}

export function createMoveGate(): MoveGate {
  let armed = false;
  return {
    arm() {
      armed = true;
    },
    disarm() {
      armed = false;
    },
    isArmed() {
      return armed;
    },
    swallow(eventType) {
      if (!armed) return false;
      if (eventType === 'moveend') armed = false;
      return true;
    },
  };
}

/**
 * Padding for fitting pins into a map of `size` pixels, scaled down so at
 * least half of each axis is left for the pins: Leaflet can't fit bounds into
 * a map smaller than its padding (a phone in landscape) and fails with a NaN
 * zoom. Null for a map with no size (not laid out), which can't fit anything.
 */
export function fitPaddingFor(
  size: { x: number; y: number },
  pad: { top: number; bottom: number; side: number },
): { top: number; bottom: number; side: number } | null {
  if (size.x <= 0 || size.y <= 0) return null;
  const vertical = pad.top + pad.bottom;
  const scale = vertical > 0 ? Math.min(1, size.y / 2 / vertical) : 1;
  return {
    top: pad.top * scale,
    bottom: pad.bottom * scale,
    side: Math.min(pad.side, size.x / 4),
  };
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
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delay);
  };

  debounced.cancel = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };

  return debounced;
}

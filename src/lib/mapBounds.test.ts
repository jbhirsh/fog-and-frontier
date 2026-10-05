import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../data/types';
import {
  activitiesBounds,
  createMoveGate,
  fitPaddingFor,
  debounce,
  filterByBounds,
  isWithinBounds,
  toMapBounds,
  type MapBounds,
} from './mapBounds';

// Bay Area-ish box used across the tests.
const bounds: MapBounds = {
  north: 38,
  south: 37,
  east: -122,
  west: -123,
};

// Build a minimal Activity with the given coords. `coords` may be omitted to
// simulate an activity missing coordinates. Only the fields the bounds filter
// reads are meaningful; the rest are filler to satisfy the type.
function makeActivity(
  id: string,
  coords?: { lat: number; lng: number },
): Activity {
  return {
    id,
    name: id,
    shortDescription: '',
    category: 'hiking',
    region: 'sf',
    location: {
      city: 'Somewhere',
      // Cast lets us model the "missing coords" case the filter must defend
      // against (real DB rows can arrive without coordinates).
      coords: coords as { lat: number; lng: number },
    },
    duration: '1-2 Hours',
    coverImage: '',
  };
}

describe('isWithinBounds', () => {
  it('returns true for a point comfortably inside', () => {
    expect(isWithinBounds(37.5, -122.5, bounds)).toBe(true);
  });

  it('returns false for a point outside in every direction', () => {
    expect(isWithinBounds(39, -122.5, bounds)).toBe(false); // north of north
    expect(isWithinBounds(36, -122.5, bounds)).toBe(false); // south of south
    expect(isWithinBounds(37.5, -121, bounds)).toBe(false); // east of east
    expect(isWithinBounds(37.5, -124, bounds)).toBe(false); // west of west
  });

  it('treats each edge as inclusive', () => {
    expect(isWithinBounds(bounds.north, -122.5, bounds)).toBe(true);
    expect(isWithinBounds(bounds.south, -122.5, bounds)).toBe(true);
    expect(isWithinBounds(37.5, bounds.east, bounds)).toBe(true);
    expect(isWithinBounds(37.5, bounds.west, bounds)).toBe(true);
  });

  it('includes the exact corners', () => {
    expect(isWithinBounds(bounds.north, bounds.west, bounds)).toBe(true);
    expect(isWithinBounds(bounds.north, bounds.east, bounds)).toBe(true);
    expect(isWithinBounds(bounds.south, bounds.west, bounds)).toBe(true);
    expect(isWithinBounds(bounds.south, bounds.east, bounds)).toBe(true);
  });

  it('rejects non-finite coordinates', () => {
    expect(isWithinBounds(Number.NaN, -122.5, bounds)).toBe(false);
    expect(isWithinBounds(37.5, Number.NaN, bounds)).toBe(false);
    expect(isWithinBounds(Infinity, -122.5, bounds)).toBe(false);
    expect(isWithinBounds(37.5, -Infinity, bounds)).toBe(false);
  });

  it('handles an antimeridian-crossing viewport (east < west)', () => {
    const wrapped: MapBounds = {
      north: 60,
      south: 50,
      east: -170,
      west: 170,
    };
    expect(isWithinBounds(55, 175, wrapped)).toBe(true); // east of west edge
    expect(isWithinBounds(55, -175, wrapped)).toBe(true); // west of east edge
    expect(isWithinBounds(55, 180, wrapped)).toBe(true); // on the seam
    expect(isWithinBounds(55, 0, wrapped)).toBe(false); // the far side
  });

  it('includes both edges of an antimeridian-crossing viewport', () => {
    const wrapped: MapBounds = { north: 60, south: 50, east: -170, west: 170 };
    expect(isWithinBounds(55, wrapped.west, wrapped)).toBe(true);
    expect(isWithinBounds(55, wrapped.east, wrapped)).toBe(true);
  });

  it('rejects infinite longitudes on an antimeridian-crossing viewport', () => {
    // Either infinity is numerically past one of the wrapped edges, so only the
    // finiteness check keeps them out.
    const wrapped: MapBounds = { north: 60, south: 50, east: -170, west: 170 };
    expect(isWithinBounds(55, Infinity, wrapped)).toBe(false);
    expect(isWithinBounds(55, -Infinity, wrapped)).toBe(false);
  });

  it('treats a zero-width viewport as that one meridian, not the whole world', () => {
    const line: MapBounds = { north: 38, south: 37, east: -122, west: -122 };
    expect(isWithinBounds(37.5, -122, line)).toBe(true);
    expect(isWithinBounds(37.5, -122.5, line)).toBe(false);
    expect(isWithinBounds(37.5, 0, line)).toBe(false);
  });

  it('matches nothing for inverted latitude bounds (north < south)', () => {
    // Degenerate bounds aren't produced by Leaflet, but document the behavior:
    // an empty latitude range can never contain a point.
    const inverted: MapBounds = { north: 37, south: 38, east: -122, west: -123 };
    expect(isWithinBounds(37.5, -122.5, inverted)).toBe(false);
  });
});

describe('filterByBounds', () => {
  it('keeps only activities inside the bounds', () => {
    const inside = makeActivity('inside', { lat: 37.5, lng: -122.5 });
    const outside = makeActivity('outside', { lat: 40, lng: -120 });

    const result = filterByBounds([inside, outside], bounds);

    expect(result).toEqual([inside]);
  });

  it('includes activities sitting exactly on an edge', () => {
    const onNorth = makeActivity('on-north', { lat: 38, lng: -122.5 });
    const onWest = makeActivity('on-west', { lat: 37.5, lng: -123 });

    const result = filterByBounds([onNorth, onWest], bounds);

    expect(result.map((a) => a.id)).toEqual(['on-north', 'on-west']);
  });

  it('excludes activities with missing coords', () => {
    const noCoords = makeActivity('no-coords', undefined);
    const inside = makeActivity('inside', { lat: 37.5, lng: -122.5 });

    const result = filterByBounds([noCoords, inside], bounds);

    expect(result).toEqual([inside]);
  });

  it('excludes activities with non-finite coords', () => {
    const nanLat = makeActivity('nan-lat', { lat: Number.NaN, lng: -122.5 });
    const nanLng = makeActivity('nan-lng', { lat: 37.5, lng: Number.NaN });
    const inside = makeActivity('inside', { lat: 37.5, lng: -122.5 });

    const result = filterByBounds([nanLat, nanLng, inside], bounds);

    expect(result).toEqual([inside]);
  });

  it('returns an empty array when nothing is inside', () => {
    const a = makeActivity('a', { lat: 10, lng: 10 });
    const b = makeActivity('b', { lat: 20, lng: 20 });

    expect(filterByBounds([a, b], bounds)).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    expect(filterByBounds([], bounds)).toEqual([]);
  });

  it('preserves the input order of matching activities', () => {
    const first = makeActivity('first', { lat: 37.9, lng: -122.1 });
    const second = makeActivity('second', { lat: 37.1, lng: -122.9 });
    const third = makeActivity('third', { lat: 37.5, lng: -122.5 });

    const result = filterByBounds([first, second, third], bounds);

    expect(result.map((a) => a.id)).toEqual(['first', 'second', 'third']);
  });

  it('filters across an antimeridian-crossing viewport end-to-end', () => {
    const wrapped: MapBounds = { north: 60, south: 50, east: -170, west: 170 };
    const nearSeam = makeActivity('near-seam', { lat: 55, lng: 179 });
    const farSide = makeActivity('far-side', { lat: 55, lng: 0 });

    const result = filterByBounds([nearSeam, farSide], wrapped);

    expect(result.map((a) => a.id)).toEqual(['near-seam']);
  });
});

describe('toMapBounds', () => {
  it('adapts a Leaflet-like LatLngBounds to the plain shape', () => {
    const leafletLike = {
      getNorth: () => 38,
      getSouth: () => 37,
      getEast: () => -122,
      getWest: () => -123,
    };

    expect(toMapBounds(leafletLike)).toEqual(bounds);
  });

  it('produces a shape usable by the filter', () => {
    const leafletLike = {
      getNorth: () => 38,
      getSouth: () => 37,
      getEast: () => -122,
      getWest: () => -123,
    };
    const inside = makeActivity('inside', { lat: 37.5, lng: -122.5 });

    expect(filterByBounds([inside], toMapBounds(leafletLike))).toEqual([inside]);
  });

  // Leaflet reports longitudes past ±180 once the map is panned across world
  // copies; the adapter wraps them back.
  const viewport = (west: number, east: number) => ({
    getNorth: () => 38,
    getSouth: () => 37,
    getEast: () => east,
    getWest: () => west,
  });

  it('wraps longitudes from a panned-over world copy into [-180, 180)', () => {
    expect(toMapBounds(viewport(-482, -481))).toEqual({
      ...bounds,
      west: -122,
      east: -121,
    });
    expect(toMapBounds(viewport(190, 200))).toEqual({
      ...bounds,
      west: -170,
      east: -160,
    });
    expect(toMapBounds(viewport(-600, -590))).toEqual({
      ...bounds,
      west: 120,
      east: 130,
    });
  });

  it('wraps a viewport straddling a world-copy seam into an antimeridian window', () => {
    expect(toMapBounds(viewport(-200, -150))).toEqual({
      ...bounds,
      west: 160,
      east: -150,
    });
  });

  it('collapses a viewport a full world wide (or wider) to every longitude', () => {
    const whole = { ...bounds, west: -180, east: 180 };
    expect(toMapBounds(viewport(-200, 160))).toEqual(whole);
    expect(toMapBounds(viewport(-300, 200))).toEqual(whole);
    // Just under a world wide still wraps.
    expect(toMapBounds(viewport(-200, 159))).toEqual({
      ...bounds,
      west: 160,
      east: 159,
    });
  });
});

describe('activitiesBounds', () => {
  it('encloses every activity, as south-west and north-east corners', () => {
    const corners = activitiesBounds([
      makeActivity('a', { lat: 37.5, lng: -122.5 }),
      makeActivity('b', { lat: 36.6, lng: -121.9 }),
      makeActivity('c', { lat: 38.3, lng: -123.1 }),
    ]);
    expect(corners).toEqual([
      [36.6, -123.1],
      [38.3, -121.9],
    ]);
  });

  it('gives a zero-size box for a single activity', () => {
    expect(activitiesBounds([makeActivity('a', { lat: 37.5, lng: -122.5 })])).toEqual([
      [37.5, -122.5],
      [37.5, -122.5],
    ]);
  });

  it('skips activities without usable coordinates', () => {
    const corners = activitiesBounds([
      makeActivity('missing'),
      makeActivity('nan-lat', { lat: Number.NaN, lng: 0 }),
      makeActivity('inf-lng', { lat: 0, lng: Number.POSITIVE_INFINITY }),
      makeActivity('ok', { lat: 37.5, lng: -122.5 }),
    ]);
    expect(corners).toEqual([
      [37.5, -122.5],
      [37.5, -122.5],
    ]);
  });

  it('is null when there is nothing to fit', () => {
    expect(activitiesBounds([])).toBeNull();
    expect(activitiesBounds([makeActivity('missing')])).toBeNull();
  });
});

describe('createMoveGate', () => {
  it('lets every event through until armed', () => {
    const gate = createMoveGate();
    expect(gate.swallow('moveend')).toBe(false);
    expect(gate.swallow('zoomend')).toBe(false);
  });

  it('swallows a programmatic move through its moveend, then disarms', () => {
    const gate = createMoveGate();
    gate.arm();
    expect(gate.swallow('zoomend')).toBe(true);
    expect(gate.swallow('zoomend')).toBe(true);
    expect(gate.swallow('moveend')).toBe(true);
    // The next move is the user's again.
    expect(gate.swallow('zoomend')).toBe(false);
    expect(gate.swallow('moveend')).toBe(false);
  });

  it('reports whether a programmatic move is under way', () => {
    const gate = createMoveGate();
    expect(gate.isArmed()).toBe(false);
    gate.arm();
    expect(gate.isArmed()).toBe(true);
    gate.swallow('zoomend');
    expect(gate.isArmed()).toBe(true);
    gate.swallow('moveend');
    expect(gate.isArmed()).toBe(false);
  });

  it('hands the next move back to the user when disarmed', () => {
    const gate = createMoveGate();
    gate.arm();
    gate.disarm();
    expect(gate.isArmed()).toBe(false);
    expect(gate.swallow('moveend')).toBe(false);
  });

  it('arming twice still swallows only one move', () => {
    const gate = createMoveGate();
    gate.arm();
    gate.arm();
    expect(gate.swallow('moveend')).toBe(true);
    expect(gate.swallow('moveend')).toBe(false);
  });

  it('keeps each gate separate', () => {
    const a = createMoveGate();
    const b = createMoveGate();
    a.arm();
    expect(b.swallow('moveend')).toBe(false);
    expect(a.swallow('moveend')).toBe(true);
  });
});

describe('debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes the function once after the delay, with the latest args', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 400);

    debounced('a');
    debounced('b');
    debounced('c');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('defaults to a 400ms delay', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn);

    debounced();
    vi.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel() drops a pending invocation', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 400);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(1000);

    expect(fn).not.toHaveBeenCalled();
  });

  it('re-arms after firing: a later call schedules a fresh invocation', () => {
    // This is the actual pan/zoom usage pattern — the map settles, fires, then
    // the user pans again and it must fire a second time.
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 400);

    debounced('first');
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith('first');

    debounced('second');
    expect(fn).toHaveBeenCalledTimes(1); // not yet — new timer pending
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('second');
  });

  it('cancel() after the invocation has fired is a safe no-op', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 400);

    debounced();
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);

    expect(() => debounced.cancel()).not.toThrow();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('fitPaddingFor', () => {
  const pad = { top: 100, bottom: 200, side: 48 };

  it('keeps the padding when the map has room for it', () => {
    expect(fitPaddingFor({ x: 600, y: 600 }, pad)).toEqual(pad);
    expect(fitPaddingFor({ x: 1000, y: 900 }, pad)).toEqual(pad);
  });

  it('scales the top and bottom down to leave half the height', () => {
    // 300px of padding in a 400px map: scaled by 200 / 300.
    expect(fitPaddingFor({ x: 600, y: 400 }, pad)).toEqual({
      top: 100 * (2 / 3),
      bottom: 200 * (2 / 3),
      side: 48,
    });
  });

  it('caps the side padding at a quarter of the width', () => {
    expect(fitPaddingFor({ x: 160, y: 900 }, pad)?.side).toBe(40);
    expect(fitPaddingFor({ x: 192, y: 900 }, pad)?.side).toBe(48);
  });

  it('leaves zero padding alone', () => {
    expect(fitPaddingFor({ x: 10, y: 10 }, { top: 0, bottom: 0, side: 0 })).toEqual({
      top: 0,
      bottom: 0,
      side: 0,
    });
  });

  it('has nothing to fit into for a map with no size', () => {
    expect(fitPaddingFor({ x: 0, y: 600 }, pad)).toBeNull();
    expect(fitPaddingFor({ x: 600, y: 0 }, pad)).toBeNull();
    expect(fitPaddingFor({ x: 1, y: 1 }, pad)).not.toBeNull();
  });
});

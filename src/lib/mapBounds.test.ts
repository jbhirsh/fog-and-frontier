import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../data/types';
import {
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

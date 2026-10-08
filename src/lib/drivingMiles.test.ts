import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { distanceMiles } from '../data/home';
import { DistanceOriginCtx, HOME_ORIGIN, deviceOrigin } from './distanceOrigin';
import {
  DrivingMilesCtx,
  NO_DRIVING_MILES,
  coarse,
  distanceTo,
  formatMiles,
  toDrivingMiles,
  useDistanceTo,
  useDrivingMiles,
  type DrivingMiles,
} from './drivingMiles';

const MUIR = { id: 'muir', location: { coords: { lat: 37.897, lng: -122.5811 } } };

describe('coarse', () => {
  it('rounds to two decimals', () => {
    expect(coarse(37.33829)).toBe(37.34);
    expect(coarse(-121.88634)).toBe(-121.89);
  });
});

describe('toDrivingMiles', () => {
  it('keys road miles by id', () => {
    const m = toDrivingMiles([
      { id: 'a', miles: 3 },
      { id: 'b', miles: 70.4 },
    ]);
    expect([...m]).toEqual([
      ['a', 3],
      ['b', 70.4],
    ]);
  });
});

describe('distanceTo', () => {
  it('uses road miles when the server has them', () => {
    expect(distanceTo(HOME_ORIGIN, new Map([['muir', 71.2]]), MUIR)).toEqual({
      miles: 71.2,
      driving: true,
    });
  });

  it('falls back to straight-line miles from the origin', () => {
    const origin = deviceOrigin({ latitude: 37.77, longitude: -122.42 });
    expect(distanceTo(origin, new Map([['other', 1]]), MUIR)).toEqual({
      miles: distanceMiles(origin.coords, MUIR.location.coords),
      driving: false,
    });
  });

  it('keeps a road distance of zero', () => {
    expect(distanceTo(HOME_ORIGIN, new Map([['muir', 0]]), MUIR)).toEqual({
      miles: 0,
      driving: true,
    });
  });
});

describe('formatMiles', () => {
  it.each([
    [71.2, true, false, '71'],
    [9.94, true, false, '9.9'],
    [10, true, false, '10'],
    [4.25, true, true, '4.3'],
    [71.24, true, true, '71.2'],
    [18.4, false, false, '≈18'],
    [3.21, false, false, '≈3.2'],
    [18.44, false, true, '≈18.4'],
  ])('%s mi (driving %s, precise %s) reads "%s"', (miles, driving, precise, want) => {
    expect(formatMiles({ miles, driving }, precise)).toBe(want);
  });
});

function wrapper(driving: DrivingMiles, origin = HOME_ORIGIN) {
  return ({ children }: { children: ReactNode }) =>
    createElement(
      DistanceOriginCtx.Provider,
      { value: origin },
      createElement(DrivingMilesCtx.Provider, { value: driving }, children),
    );
}

describe('useDistanceTo', () => {
  it('measures from the provided origin with the provided road miles', () => {
    const driving = new Map([['muir', 71.2]]);
    const { result } = renderHook(() => useDistanceTo(), { wrapper: wrapper(driving) });
    expect(result.current(MUIR)).toEqual({ miles: 71.2, driving: true });
  });

  it('is a straight-line estimate without road miles', () => {
    const { result } = renderHook(() => useDistanceTo());
    expect(result.current(MUIR)).toEqual({
      miles: distanceMiles(HOME_ORIGIN.coords, MUIR.location.coords),
      driving: false,
    });
  });

  it('keeps the same function until the inputs change', () => {
    const driving = new Map([['muir', 71.2]]);
    const { result, rerender } = renderHook(() => useDistanceTo(), {
      wrapper: wrapper(driving),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('useDrivingMiles', () => {
  it('reads the provided road miles, empty by default', () => {
    const driving = new Map([['muir', 71.2]]);
    expect(renderHook(() => useDrivingMiles(), { wrapper: wrapper(driving) }).result.current).toBe(
      driving,
    );
    expect(renderHook(() => useDrivingMiles()).result.current).toBe(NO_DRIVING_MILES);
  });
});

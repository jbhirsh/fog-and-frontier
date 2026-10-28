import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { WORLD_BOUNDS, WORLD_EDGE_LAT, fillZoom } from './mapFit';

describe('fillZoom', () => {
  it.each([
    [0, 0],
    [200, 0],
    [256, 0],
    [257, 1],
    [512, 1],
    [513, 2],
    [700, 2],
    [1024, 2],
    [1500, 3],
  ])('lets a map %ipx tall zoom out to %i', (height, zoom) => {
    expect(fillZoom(height)).toBe(zoom);
  });

  it('allows any zoom for a map with no height yet', () => {
    expect(fillZoom(Number.NaN)).toBe(0);
    expect(fillZoom(-1)).toBe(0);
    expect(fillZoom(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('always gives the least zoom whose world is at least as tall as the map', () => {
    fc.assert(
      fc.property(fc.integer({ min: 257, max: 100_000 }), (height) => {
        const z = fillZoom(height);
        expect(256 * 2 ** z).toBeGreaterThanOrEqual(height);
        expect(256 * 2 ** (z - 1)).toBeLessThan(height);
      }),
    );
  });

  it('stops at Web Mercator’s own edge, north and south, and nowhere sideways', () => {
    expect(WORLD_EDGE_LAT).toBeCloseTo(85.0511, 4);
    const [[south, west], [north, east]] = WORLD_BOUNDS;
    expect([south, north]).toEqual([-WORLD_EDGE_LAT, WORLD_EDGE_LAT]);
    // Many whole worlds either way.
    expect(west).toBeLessThan(-360 * 100);
    expect(east).toBeGreaterThan(360 * 100);
  });
});

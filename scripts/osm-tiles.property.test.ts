import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { osmTileUrl, tileOf } from './osm-tiles.ts';

// A tile URL comes from the browser (whatever Leaflet asks for), so tileOf
// takes any string.
const place = fc
  .integer({ min: 0, max: 19 })
  .chain((z) =>
    fc.tuple(
      fc.constant(z),
      fc.integer({ min: 0, max: 2 ** z - 1 }),
      fc.integer({ min: 0, max: 2 ** z - 1 }),
    ),
  )
  .map(([z, x, y]) => `${z}/${x}/${y}`);

describe('tileOf (property)', () => {
  it('never throws, and gives a z/x/y or null', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const tile = tileOf(s);
        expect(tile === null || /^\d+\/\d+\/\d+$/.test(tile)).toBe(true);
      }),
    );
  });

  it('reads back the place of any tile URL built from it', () => {
    fc.assert(
      fc.property(
        place,
        fc.constantFrom('a', 'b', 'c', 'd'),
        fc.boolean(),
        fc.constantFrom('', '?key=k', '#x'),
        (tile, sub, retina, tail) => {
          expect(tileOf(osmTileUrl(tile))).toBe(tile);
          expect(
            tileOf(
              `https://${sub}.basemaps.cartocdn.com/light_all/${tile}${retina ? '@2x' : ''}.png${tail}`,
            ),
          ).toBe(tile);
        },
      ),
    );
  });
});

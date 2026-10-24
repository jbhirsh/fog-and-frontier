import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ISO_REGIONS } from '../shared/isoRegions.js';
import { CALIFORNIA_REGIONS } from '../shared/regions.js';
import { toRegion } from './_regions.js';

// A region arrives from people (a save, a suggestion) and from a model (a
// draft), so it must hold for anything sent (#274). Example tests are in
// _regions.test.ts.

const REGIONS = new Set<string>([
  ...CALIFORNIA_REGIONS.map(([id]) => id),
  ...ISO_REGIONS.map(([id]) => id),
]);

// Real ids in any case and spacing, old ones, object keys, and junk.
const value = fc.oneof(
  fc.constantFrom(...REGIONS).chain((id) => fc.constantFrom(id, id.toLowerCase(), ` ${id} `)),
  fc.constantFrom('oregon', 'washington', 'constructor', '__proto__', 'toString', 'US-CA'),
  fc.string(),
  fc.anything(),
);

describe('toRegion, for anything sent (#274)', () => {
  it('names a region on the list, or none, and never throws', () => {
    fc.assert(
      fc.property(value, (v) => {
        const region = toRegion(v);
        expect(region === null || REGIONS.has(region)).toBe(true);
      }),
    );
  });

  it('reads a region it named as itself', () => {
    fc.assert(
      fc.property(value, (v) => {
        const region = toRegion(v);
        if (region !== null) expect(toRegion(region)).toBe(region);
      }),
    );
  });
});

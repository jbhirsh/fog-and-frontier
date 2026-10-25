import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  appliedFilters,
  CATEGORY_OPTIONS,
  DISTANCE_LIMITS,
  DURATION_OPTIONS,
  PARK_TYPE_OPTIONS,
  type FilterValues,
} from './catalogFilterOptions';
import { parseContributors } from './useCatalogFilters';

// Filters as a shared link can leave them: any mix of choices, and whatever
// accounts a `?contributors=` value names.
const values: fc.Arbitrary<FilterValues> = fc.record({
  maxDistance: fc.constantFrom(Infinity, ...DISTANCE_LIMITS),
  duration: fc.constantFrom(...DURATION_OPTIONS),
  category: fc.constantFrom(...CATEGORY_OPTIONS),
  parkType: fc.constantFrom(...PARK_TYPE_OPTIONS),
  dogOnly: fc.boolean(),
  freeOnly: fc.boolean(),
  completedOnly: fc.boolean(),
  contributors: fc.string().map((raw) => parseContributors(raw)),
});

const name = (email: string) => email;

describe('appliedFilters, for any filters', () => {
  it('gives each chip its own key', () => {
    fc.assert(
      fc.property(values, (v) => {
        const keys = appliedFilters(v, name).map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  it('takes off exactly the chip removed, the rest staying in order', () => {
    fc.assert(
      fc.property(values, fc.nat(), (v, pick) => {
        const on = appliedFilters(v, name);
        fc.pre(on.length > 0);
        const i = pick % on.length;
        const after = appliedFilters({ ...v, ...on[i].off }, name);
        expect(after.map((f) => f.key)).toEqual(on.filter((_, j) => j !== i).map((f) => f.key));
      }),
    );
  });
});

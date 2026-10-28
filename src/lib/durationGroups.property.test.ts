import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Duration } from '../data/types';
import { DURATION_OPTIONS } from './catalogFilterOptions';
import {
  DURATION_GROUPS,
  matchesDuration,
  type DurationFilter,
  type DurationGroup,
} from './useCatalogFilters';

// The filter's four time choices (#292): each duration in exactly one
// group, and a group keeping exactly its own durations. Examples are in
// useCatalogFilters.test.ts.

const DURATIONS: readonly Duration[] = [
  '1-2 Hours',
  '2-3 Hours',
  'Half Day',
  'Full Day',
  'Weekend',
  'Multi-Day',
];
const GROUPS = Object.keys(DURATION_GROUPS) as DurationGroup[];

describe('duration groups, for any duration', () => {
  it('put it in exactly one group', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DURATIONS), (duration) => {
        expect(GROUPS.filter((g) => matchesDuration(duration, g))).toHaveLength(1);
      }),
    );
  });

  it('keep it under Any', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DURATIONS), (duration) => {
        expect(matchesDuration(duration, 'Any')).toBe(true);
      }),
    );
  });

  it('keep it under a group exactly when the group lists it', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DURATIONS), fc.constantFrom(...GROUPS), (duration, group) => {
        expect(matchesDuration(duration, group)).toBe(DURATION_GROUPS[group].includes(duration));
      }),
    );
  });
});

describe('the duration groups', () => {
  it('cover every duration once between them', () => {
    expect(
      GROUPS.flatMap((g) => DURATION_GROUPS[g])
        .slice()
        .sort(),
    ).toEqual([...DURATIONS].sort());
  });

  it('are what the filter offers, after Any', () => {
    expect(DURATION_OPTIONS).toEqual<DurationFilter[]>(['Any', 'hours', 'half', 'day']);
  });

  it('hold what the owners chose', () => {
    expect(DURATION_GROUPS).toEqual({
      hours: ['1-2 Hours', '2-3 Hours'],
      half: ['Half Day'],
      day: ['Full Day', 'Weekend', 'Multi-Day'],
    });
  });
});

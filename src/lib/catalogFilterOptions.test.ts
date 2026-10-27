import { describe, expect, it } from 'vitest';
import { appliedFilters, NO_FILTERS, type FilterValues } from './catalogFilterOptions';
import { INITIAL_CATALOG_FILTERS } from './useCatalogFilters';

const name = (email: string) => email.split('@')[0].toUpperCase();

describe('NO_FILTERS', () => {
  it('is every catalog filter at its start, the search aside', () => {
    const { search, ...rest } = INITIAL_CATALOG_FILTERS;
    expect(search).toBe('');
    expect(NO_FILTERS).toEqual(rest);
  });
});

describe('appliedFilters', () => {
  it('lists nothing when no filter is on', () => {
    expect(appliedFilters(NO_FILTERS, name)).toEqual([]);
  });

  it('lists each filter on, in the sheet’s order, with what turns it off', () => {
    const values: FilterValues = {
      maxDistance: 50,
      duration: 'half',
      category: 'hiking',
      parkType: 'state',
      dogOnly: true,
      freeOnly: true,
      completedOnly: true,
      contributors: ['tarun@example.com', 'jess@example.com'],
    };
    expect(appliedFilters(values, name)).toEqual([
      { key: 'category', label: 'Hiking', off: { category: 'Any' } },
      { key: 'distance', label: 'Within 50 mi', off: { maxDistance: Infinity } },
      { key: 'duration', label: 'Half day', off: { duration: 'Any' } },
      { key: 'dog', label: 'Dogs welcome', off: { dogOnly: false } },
      { key: 'free', label: 'Free', off: { freeOnly: false } },
      { key: 'completed', label: "Places we've done", off: { completedOnly: false } },
      { key: 'park', label: 'State park', off: { parkType: 'Any' } },
      {
        key: 'by:tarun@example.com',
        label: 'Added by TARUN',
        off: { contributors: ['jess@example.com'] },
      },
      {
        key: 'by:jess@example.com',
        label: 'Added by JESS',
        off: { contributors: ['tarun@example.com'] },
      },
    ]);
  });

  it('lists a single filter on its own', () => {
    expect(appliedFilters({ ...NO_FILTERS, parkType: 'none' }, name)).toEqual([
      { key: 'park', label: 'Not in a park', off: { parkType: 'Any' } },
    ]);
    expect(appliedFilters({ ...NO_FILTERS, maxDistance: 25 }, name)).toEqual([
      { key: 'distance', label: 'Within 25 mi', off: { maxDistance: Infinity } },
    ]);
  });

  it('names each duration group as the sheet does (#292)', () => {
    const label = (duration: FilterValues['duration']) =>
      appliedFilters({ ...NO_FILTERS, duration }, name)[0]?.label;
    expect(label('hours')).toBe('A few hours');
    expect(label('half')).toBe('Half day');
    expect(label('day')).toBe('A day or more');
    expect(label('Any')).toBeUndefined();
  });
});

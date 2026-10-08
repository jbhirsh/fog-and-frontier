import { describe, expect, it } from 'vitest';
import {
  applyCatalogFilters,
  INITIAL_CATALOG_FILTERS,
  readCompletedOnly,
  withCompletedOnly,
  type CatalogFilterState,
} from './useCatalogFilters';
import {
  completedHike,
  dogFriendlyTidepools,
  muirWoods,
} from '../test/fixtures';
import { HOME_LOCATION, distanceMiles } from '../data/home';

const ALL = [muirWoods, completedHike, dogFriendlyTidepools];

function filters(overrides: Partial<CatalogFilterState>): CatalogFilterState {
  return { ...INITIAL_CATALOG_FILTERS, ...overrides };
}

describe('applyCatalogFilters', () => {
  it('returns every activity with the default (no-op) filters', () => {
    const result = applyCatalogFilters(ALL, INITIAL_CATALOG_FILTERS);
    expect(result.map((a) => a.id).sort()).toEqual(
      ALL.map((a) => a.id).sort(),
    );
  });

  it('sorts by distance from home (nearest first)', () => {
    const result = applyCatalogFilters(ALL, INITIAL_CATALOG_FILTERS);
    // Tide pools (Moss Beach) is closest to San Jose; the two Mill Valley
    // fixtures are farther north.
    expect(result[0].id).toBe(dogFriendlyTidepools.id);
  });

  it('filters by free-text search over name, description, city and category', () => {
    const result = applyCatalogFilters(ALL, filters({ search: 'tide' }));
    expect(result.map((a) => a.id)).toEqual([dogFriendlyTidepools.id]);
  });

  it('trims and lowercases the search query', () => {
    const result = applyCatalogFilters(ALL, filters({ search: '  TIDE  ' }));
    expect(result.map((a) => a.id)).toEqual([dogFriendlyTidepools.id]);
  });

  it('matches search against the category field', () => {
    const result = applyCatalogFilters(ALL, filters({ search: 'hiking' }));
    expect(result.map((a) => a.id)).toEqual([muirWoods.id]);
  });

  it('matches search against the short description field', () => {
    // "redwoods" appears only in muirWoods.shortDescription, not its name,
    // city or category.
    const result = applyCatalogFilters(ALL, filters({ search: 'redwoods' }));
    expect(result.map((a) => a.id)).toEqual([muirWoods.id]);
  });

  it('matches search against the city field', () => {
    // "moss beach" appears only in dogFriendlyTidepools.location.city.
    const result = applyCatalogFilters(ALL, filters({ search: 'moss beach' }));
    expect(result.map((a) => a.id)).toEqual([dogFriendlyTidepools.id]);
  });

  it('does not search the long description field', () => {
    // "loop" appears only in muirWoods.longDescription, which is intentionally
    // outside the search haystack — so it must match nothing.
    const result = applyCatalogFilters(ALL, filters({ search: 'loop' }));
    expect(result).toEqual([]);
  });

  it('filters by duration', () => {
    const result = applyCatalogFilters(ALL, filters({ duration: 'Half Day' }));
    expect(result.map((a) => a.id)).toEqual([muirWoods.id]);
  });

  it('filters by category', () => {
    const result = applyCatalogFilters(ALL, filters({ category: 'scenic' }));
    expect(result.map((a) => a.id).sort()).toEqual(
      [completedHike.id, dogFriendlyTidepools.id].sort(),
    );
  });

  it('measures distance from the given origin when there is one (#66)', () => {
    // Standing at Muir Woods: it, then the nearby completed hike, come first.
    const atMuirWoods = muirWoods.location.coords;
    expect(
      applyCatalogFilters(ALL, INITIAL_CATALOG_FILTERS, {}, atMuirWoods).map((a) => a.id),
    ).toEqual([muirWoods.id, completedHike.id, dogFriendlyTidepools.id]);
    // The radius is measured from there too.
    expect(
      applyCatalogFilters(ALL, filters({ maxDistance: 5 }), {}, atMuirWoods).map((a) => a.id),
    ).toEqual([muirWoods.id, completedHike.id]);
  });

  it('measures from home without an origin', () => {
    expect(applyCatalogFilters(ALL, INITIAL_CATALOG_FILTERS, {})).toEqual(
      applyCatalogFilters(ALL, INITIAL_CATALOG_FILTERS, {}, HOME_LOCATION.coords),
    );
  });

  it('filters by max distance', () => {
    // From San Jose, all fixtures are >25 miles away.
    const result = applyCatalogFilters(ALL, filters({ maxDistance: 25 }));
    expect(result).toEqual([]);
  });

  it('keeps an activity exactly at the max distance ("Within N mi")', () => {
    const miles = distanceMiles(
      HOME_LOCATION.coords,
      dogFriendlyTidepools.location.coords,
    );
    const result = applyCatalogFilters(
      [dogFriendlyTidepools],
      filters({ maxDistance: miles }),
    );
    expect(result).toEqual([dogFriendlyTidepools]);
  });

  it('filters by dog-friendly', () => {
    const result = applyCatalogFilters(ALL, filters({ dogOnly: true }));
    expect(result.map((a) => a.id).sort()).toEqual(
      [completedHike.id, dogFriendlyTidepools.id].sort(),
    );
    // Muir Woods is not dog friendly, so it is excluded.
    expect(result.map((a) => a.id)).not.toContain(muirWoods.id);
  });

  it('treats a missing parkType as "none"', () => {
    // None of the fixtures set parkType, so they default to "none".
    expect(
      applyCatalogFilters(ALL, filters({ parkType: 'none' })).map((a) => a.id)
        .sort(),
    ).toEqual(ALL.map((a) => a.id).sort());
    expect(applyCatalogFilters(ALL, filters({ parkType: 'state' }))).toEqual([]);
  });

  it('stacks multiple filters (AND semantics)', () => {
    const result = applyCatalogFilters(
      ALL,
      filters({ category: 'scenic', dogOnly: true, duration: '1-2 Hours' }),
    );
    expect(result.map((a) => a.id)).toEqual([dogFriendlyTidepools.id]);
  });

  it('does not mutate the input array', () => {
    const input = [...ALL];
    applyCatalogFilters(input, INITIAL_CATALOG_FILTERS);
    expect(input).toEqual(ALL);
  });
});

describe('applyCatalogFilters — completed only (#5)', () => {
  it('is off by default', () => {
    expect(INITIAL_CATALOG_FILTERS.completedOnly).toBe(false);
  });

  it('keeps only activities completed in their baseline', () => {
    const result = applyCatalogFilters(ALL, filters({ completedOnly: true }));
    expect(result.map((a) => a.id)).toEqual([completedHike.id]);
  });

  it('honours completion overrides in both directions', () => {
    // muirWoods is marked completed; completedHike is un-marked.
    const result = applyCatalogFilters(ALL, filters({ completedOnly: true }), {
      [muirWoods.id]: true,
      [completedHike.id]: false,
    });
    expect(result.map((a) => a.id)).toEqual([muirWoods.id]);
  });

  it('ignores overrides while the filter is off', () => {
    const result = applyCatalogFilters(ALL, INITIAL_CATALOG_FILTERS, {
      [completedHike.id]: false,
    });
    expect(result).toHaveLength(ALL.length);
  });

  it('stacks with the other filters', () => {
    const result = applyCatalogFilters(
      ALL,
      filters({ completedOnly: true, duration: '1-2 Hours' }),
      { [dogFriendlyTidepools.id]: true },
    );
    expect(result.map((a) => a.id)).toEqual([dogFriendlyTidepools.id]);
  });
});

describe('completed-only URL param', () => {
  it('reads ?completed=1 as on', () => {
    expect(readCompletedOnly(new URLSearchParams('completed=1'))).toBe(true);
  });

  it('reads a missing or other value as off', () => {
    expect(readCompletedOnly(new URLSearchParams(''))).toBe(false);
    expect(readCompletedOnly(new URLSearchParams('completed=0'))).toBe(false);
    expect(readCompletedOnly(new URLSearchParams('completed=true'))).toBe(
      false,
    );
  });

  it('sets ?completed=1 and keeps the other params', () => {
    const next = withCompletedOnly(new URLSearchParams('q=tide&view=map'), true);
    expect(next.toString()).toBe('q=tide&view=map&completed=1');
  });

  it('removes the param when turned off', () => {
    const next = withCompletedOnly(
      new URLSearchParams('completed=1&q=tide'),
      false,
    );
    expect(next.toString()).toBe('q=tide');
  });

  it('does not mutate the params it was given', () => {
    const prev = new URLSearchParams('q=tide');
    withCompletedOnly(prev, true);
    expect(prev.toString()).toBe('q=tide');
  });
});

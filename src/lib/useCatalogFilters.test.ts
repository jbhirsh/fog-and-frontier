import { describe, expect, it } from 'vitest';
import {
  applyCatalogFilters,
  INITIAL_CATALOG_FILTERS,
  type CatalogFilterState,
} from './useCatalogFilters';
import {
  completedHike,
  dogFriendlyTidepools,
  muirWoods,
} from '../test/fixtures';

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
    // Tide pools (Moss Beach) is closest to Campbell; the two Mill Valley
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

  it('filters by max distance', () => {
    // From Campbell, all fixtures are >25 miles away.
    const result = applyCatalogFilters(ALL, filters({ maxDistance: 25 }));
    expect(result).toEqual([]);
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

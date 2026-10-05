import { describe, expect, it } from 'vitest';
import type { Activity, Category } from '../data/types';
import { distanceMiles } from '../data/home';
import {
  NEARBY_GROUP_HEADING,
  NEARBY_PER_CATEGORY,
  NEARBY_RADIUS_MILES,
  groupNearby,
  hasUsableCoords,
  nearbyByCategory,
  rankNearby,
  type NearbyActivity,
} from './nearbyActivities';

// Minimal Activity at the given coords; only id, category and coords matter to
// the selector, the rest is filler for the type.
function make(
  id: string,
  category: Category,
  lat: number,
  lng: number,
): Activity {
  return {
    id,
    name: id,
    shortDescription: '',
    category,
    region: 'south-bay',
    location: { city: 'Somewhere', coords: { lat, lng } },
    duration: 'Half Day',
    coverImage: '',
  };
}

// Origin in the South Bay; 0.01° of latitude is ~0.69 mi, so `north(n)` sits
// n × 0.69 mi due north of it.
const ORIGIN_LAT = 37;
const ORIGIN_LNG = -122;
const origin = make('origin', 'hiking', ORIGIN_LAT, ORIGIN_LNG);
const north = (id: string, category: Category, hundredths: number) =>
  make(id, category, ORIGIN_LAT + hundredths / 100, ORIGIN_LNG);

const ids = (xs: readonly NearbyActivity[]) => xs.map((x) => x.activity.id);

describe('hasUsableCoords', () => {
  it('accepts finite, non-sentinel coords', () => {
    expect(hasUsableCoords(make('a', 'food', 37, -122))).toBe(true);
  });

  it('accepts a zero on one axis only (equator / prime meridian)', () => {
    expect(hasUsableCoords(make('a', 'food', 0, -122))).toBe(true);
    expect(hasUsableCoords(make('a', 'food', 37, 0))).toBe(true);
  });

  it('rejects the (0, 0) never-set sentinel', () => {
    expect(hasUsableCoords(make('a', 'food', 0, 0))).toBe(false);
  });

  it('rejects non-finite latitude or longitude', () => {
    expect(hasUsableCoords(make('a', 'food', NaN, -122))).toBe(false);
    expect(hasUsableCoords(make('a', 'food', 37, Infinity))).toBe(false);
  });

  it('rejects an activity whose row arrived without coords', () => {
    const a = make('a', 'food', 37, -122);
    const missing = {
      ...a,
      location: { city: 'Nowhere' },
    } as unknown as Activity;
    expect(hasUsableCoords(missing)).toBe(false);
  });
});

describe('rankNearby', () => {
  it('returns others within the radius, nearest first, with their distance', () => {
    const far = north('far', 'food', 10);
    const near = north('near', 'scenic', 2);
    const mid = north('mid', 'hiking', 5);
    const ranked = rankNearby(origin, [far, origin, near, mid]);
    expect(ids(ranked)).toEqual(['near', 'mid', 'far']);
    expect(ranked[0].miles).toBeCloseTo(
      distanceMiles(origin.location.coords, near.location.coords),
      10,
    );
    expect(ranked[0].activity).toBe(near);
  });

  it('excludes the origin itself even when other entries share its coords', () => {
    const twin = make('twin', 'food', ORIGIN_LAT, ORIGIN_LNG);
    expect(ids(rankNearby(origin, [origin, twin]))).toEqual(['twin']);
  });

  it('includes an activity exactly on the radius and drops one just beyond', () => {
    const edge = north('edge', 'food', 10);
    const beyond = north('beyond', 'food', 10.01);
    const radius = distanceMiles(origin.location.coords, edge.location.coords);
    expect(ids(rankNearby(origin, [beyond, edge], radius))).toEqual(['edge']);
  });

  it(`defaults to a ${NEARBY_RADIUS_MILES} mi radius`, () => {
    // 0.21° of latitude ≈ 14.5 mi; 0.23° ≈ 15.9 mi.
    const inside = north('inside', 'food', 21);
    const outside = north('outside', 'food', 23);
    expect(ids(rankNearby(origin, [inside, outside]))).toEqual(['inside']);
  });

  it('skips catalog entries without usable coords', () => {
    const sentinel = make('sentinel', 'food', 0, 0);
    const nan = make('nan', 'food', NaN, ORIGIN_LNG);
    const ok = north('ok', 'food', 1);
    expect(ids(rankNearby(origin, [sentinel, nan, ok]))).toEqual(['ok']);
  });

  it('returns nothing when the origin has no usable coords', () => {
    // A real place right next to (0, 0) must not be "nearby" an activity whose
    // coords were simply never set.
    const unset = make('unset', 'hiking', 0, 0);
    const offAfrica = make('off-africa', 'food', 0.01, 0.01);
    expect(rankNearby(unset, [offAfrica])).toEqual([]);

    const missing = {
      ...origin,
      location: { city: 'Nowhere' },
    } as unknown as Activity;
    expect(rankNearby(missing, [north('ok', 'food', 1)])).toEqual([]);
  });

  it('returns an empty list for an empty catalog', () => {
    expect(rankNearby(origin, [])).toEqual([]);
  });
});

describe('groupNearby', () => {
  const at = (id: string, category: Category, miles: number): NearbyActivity => ({
    activity: make(id, category, ORIGIN_LAT, ORIGIN_LNG),
    miles,
  });

  it('groups by category, keeping nearest-first order within each group', () => {
    const groups = groupNearby(
      [at('s1', 'scenic', 1), at('c1', 'culture', 2), at('s2', 'scenic', 3)],
      'hiking',
    );
    expect(groups.map((g) => g.category)).toEqual(['scenic', 'culture']);
    expect(ids(groups[0].items)).toEqual(['s1', 's2']);
    expect(ids(groups[1].items)).toEqual(['c1']);
    expect(groups[0].items[0].miles).toBe(1);
  });

  it(`caps each category at ${NEARBY_PER_CATEGORY} by default, keeping the nearest`, () => {
    const groups = groupNearby(
      [
        at('h1', 'hiking', 1),
        at('h2', 'hiking', 2),
        at('h3', 'hiking', 3),
        at('h4', 'hiking', 4),
        at('f1', 'food', 5),
      ],
      'scenic',
    );
    expect(ids(groups.find((g) => g.category === 'hiking')!.items)).toEqual([
      'h1',
      'h2',
      'h3',
    ]);
    // The cap is per category: food still makes it in behind four hikes.
    expect(ids(groups.find((g) => g.category === 'food')!.items)).toEqual(['f1']);
  });

  it('honours a custom per-category cap', () => {
    const groups = groupNearby(
      [at('h1', 'hiking', 1), at('h2', 'hiking', 2), at('s1', 'scenic', 3)],
      'food',
      1,
    );
    expect(groups.map((g) => ids(g.items))).toEqual([['h1'], ['s1']]);
  });

  it('puts food first when the origin is not food, then orders by nearest member', () => {
    const groups = groupNearby(
      [
        at('s1', 'scenic', 1),
        at('c1', 'culture', 2),
        at('f1', 'food', 3),
        at('w1', 'water', 4),
      ],
      'hiking',
    );
    expect(groups.map((g) => g.category)).toEqual([
      'food',
      'scenic',
      'culture',
      'water',
    ]);
  });

  it('orders purely by nearest member when the origin is food', () => {
    const groups = groupNearby(
      [at('h1', 'hiking', 1), at('f1', 'food', 2), at('s1', 'scenic', 3)],
      'food',
    );
    expect(groups.map((g) => g.category)).toEqual(['hiking', 'food', 'scenic']);
  });

  it('returns no groups for an empty ranking', () => {
    expect(groupNearby([], 'hiking')).toEqual([]);
  });
});

describe('nearbyByCategory', () => {
  it('ranks, groups and caps the catalog around the origin', () => {
    const catalog = [
      origin,
      north('h4', 'hiking', 4),
      north('h1', 'hiking', 1),
      north('h3', 'hiking', 3),
      north('h2', 'hiking', 2),
      north('f9', 'food', 9),
      north('too-far', 'food', 30),
    ];
    const groups = nearbyByCategory(origin, catalog);
    expect(groups.map((g) => [g.category, ids(g.items)])).toEqual([
      ['food', ['f9']],
      ['hiking', ['h1', 'h2', 'h3']],
    ]);
  });

  it('passes the radius and per-category options through', () => {
    const catalog = [
      north('h1', 'hiking', 1),
      north('h2', 'hiking', 2),
      north('f5', 'food', 5),
    ];
    const groups = nearbyByCategory(origin, catalog, {
      radiusMiles: 2,
      perCategory: 1,
    });
    expect(groups.map((g) => [g.category, ids(g.items)])).toEqual([
      ['hiking', ['h1']],
    ]);
  });

  it("uses the origin's own category to decide whether food leads", () => {
    const food = north('origin-food', 'food', 0);
    const catalog = [north('h1', 'hiking', 1), north('f2', 'food', 2)];
    expect(nearbyByCategory(food, catalog).map((g) => g.category)).toEqual([
      'hiking',
      'food',
    ]);
  });
});

describe('NEARBY_GROUP_HEADING', () => {
  it('names the food and hiking groups the way the section reads', () => {
    expect(NEARBY_GROUP_HEADING.food).toBe('Nearby food');
    expect(NEARBY_GROUP_HEADING.hiking).toBe('Nearby hikes');
  });

  it('has a distinct heading for every category', () => {
    const headings = Object.values(NEARBY_GROUP_HEADING);
    expect(headings).toHaveLength(9);
    expect(new Set(headings).size).toBe(headings.length);
  });
});

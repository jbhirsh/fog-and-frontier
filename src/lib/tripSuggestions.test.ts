import { describe, expect, it } from 'vitest';
import type { Activity, Category } from '../data/types';
import { distanceMiles } from '../data/home';
import {
  TRIP_SUGGESTION_RADIUS_MILES,
  candidateActivities,
  suggestForTrip,
  type TripSuggestion,
} from './tripSuggestions';

// Minimal Activity; only id, name, category and coords matter here.
function make(id: string, category: Category, lat: number, lng = -122): Activity {
  return {
    id,
    name: `Name ${id}`,
    shortDescription: '',
    category,
    region: 'south-bay',
    location: { city: 'Somewhere', coords: { lat, lng } },
    duration: 'Half Day',
    coverImage: '',
  };
}

// 0.01° of latitude is ~0.69 mi, so `at(n)` sits n × 0.69 mi north of 37°N.
const at = (id: string, category: Category, hundredths: number) =>
  make(id, category, 37 + hundredths / 100);

// A trip candidate pointing at a catalog activity, with its add-time snapshot.
const onTrip = (a: Activity) => ({ activity_id: a.id, snapshot: a });

const ids = (xs: readonly TripSuggestion[]) => xs.map((x) => x.activity.id);

describe('candidateActivities', () => {
  it("prefers the catalog's current row over the add-time snapshot", () => {
    const current = at('a', 'food', 0);
    const stale = { ...current, name: 'Old name' };
    expect(candidateActivities([{ activity_id: 'a', snapshot: stale }], [current])).toEqual([
      current,
    ]);
  });

  it('falls back to the snapshot for an activity no longer in the catalog', () => {
    const gone = at('gone', 'food', 0);
    expect(candidateActivities([{ activity_id: 'gone', snapshot: gone }], [])).toEqual([gone]);
    expect(candidateActivities([{ activity_id: null, snapshot: gone }], [])).toEqual([gone]);
  });

  it('skips a candidate with neither', () => {
    expect(candidateActivities([{ activity_id: 'x', snapshot: null }], [])).toEqual([]);
  });
});

describe('suggestForTrip', () => {
  it('suggests nothing for a trip with no candidates', () => {
    expect(suggestForTrip([], [at('a', 'food', 0)])).toEqual([]);
  });

  it('suggests nothing when no candidate has usable coordinates', () => {
    const nowhere = make('nowhere', 'hiking', 0, 0);
    expect(suggestForTrip([onTrip(nowhere)], [nowhere, at('a', 'food', 0)])).toEqual([]);
  });

  it('leaves out activities already on the trip', () => {
    const hike = at('hike', 'hiking', 0);
    const food = at('food', 'food', 1);
    expect(ids(suggestForTrip([onTrip(hike), onTrip(food)], [hike, food]))).toEqual([]);
  });

  it('keeps only activities within the radius of some candidate, inclusive', () => {
    const hike = at('hike', 'hiking', 0);
    const radiusHundredths = Math.floor(TRIP_SUGGESTION_RADIUS_MILES / 0.69);
    const inside = at('inside', 'food', radiusHundredths);
    const outside = at('outside', 'food', radiusHundredths + 10);
    const result = suggestForTrip([onTrip(hike)], [hike, inside, outside]);
    expect(ids(result)).toEqual(['inside']);

    const exact = distanceMiles(hike.location.coords, inside.location.coords);
    expect(ids(suggestForTrip([onTrip(hike)], [hike, inside], exact))).toEqual(['inside']);
    expect(ids(suggestForTrip([onTrip(hike)], [hike, inside], exact - 0.01))).toEqual([]);
  });

  it('measures from the nearest candidate and names it, whatever their order', () => {
    const north = at('north', 'hiking', 30);
    const south = at('south', 'hiking', 0);
    const lunch = at('lunch', 'food', 25);
    const miles = distanceMiles(north.location.coords, lunch.location.coords);
    for (const order of [
      [south, north],
      [north, south],
    ]) {
      const [s] = suggestForTrip(order.map(onTrip), [north, south, lunch]);
      expect(s.activity.id).toBe('lunch');
      expect(s.nearName).toBe('Name north');
      expect(s.miles).toBeCloseTo(miles, 6);
    }
  });

  it('names the earlier candidate when two are equally near', () => {
    const below = at('below', 'hiking', 0);
    const above = at('above', 'scenic', 20);
    const middle = at('middle', 'food', 10);
    const [s] = suggestForTrip([onTrip(below), onTrip(above)], [below, above, middle]);
    expect(s.activity.id).toBe('middle');
    expect(s.nearName).toBe('Name below');
  });

  it('never measures from a candidate at the (0, 0) never-set sentinel', () => {
    const unset = make('unset', 'hiking', 0, 0);
    // Usable coords about 0.7 mi from (0, 0).
    const nearSentinel = make('near-sentinel', 'food', 0.01, 0);
    expect(suggestForTrip([onTrip(unset)], [unset, nearSentinel])).toEqual([]);
  });

  it('skips catalog rows without usable coordinates', () => {
    const hike = at('hike', 'hiking', 0);
    const nowhere = make('nowhere', 'food', 0, 0);
    expect(ids(suggestForTrip([onTrip(hike)], [hike, nowhere]))).toEqual([]);
  });

  it("puts the categories the trip lacks first", () => {
    const hikes = [at('h1', 'hiking', 0), at('h2', 'hiking', 1)];
    const scenic = at('view', 'scenic', 2);
    // Nearer hike, farther food: the missing category still leads.
    const moreHiking = at('h3', 'hiking', 3);
    const food = at('food', 'food', 20);
    const result = suggestForTrip(
      [...hikes, scenic].map(onTrip),
      [...hikes, scenic, moreHiking, food],
    );
    expect(ids(result)).toEqual(['food', 'h3']);
  });

  it('orders categories the trip has equally many of by their nearest activity', () => {
    const hike = at('hike', 'hiking', 0);
    const farFood = at('food', 'food', 20);
    const nearCulture = at('museum', 'culture', 5);
    expect(ids(suggestForTrip([onTrip(hike)], [hike, farFood, nearCulture]))).toEqual([
      'museum',
      'food',
    ]);
  });

  it('takes one from each category in turn, nearest first within a category', () => {
    const hike = at('hike', 'hiking', 0);
    const catalog = [
      hike,
      at('food-far', 'food', 9),
      at('food-near', 'food', 2),
      at('food-mid', 'food', 5),
      at('view', 'scenic', 4),
    ];
    expect(ids(suggestForTrip([onTrip(hike)], catalog))).toEqual([
      'food-near',
      'view',
      'food-mid',
      'food-far',
    ]);
  });

  it('counts snapshot-only candidates toward the mix and as places to measure from', () => {
    const gone = at('gone', 'food', 0);
    const lunch = at('lunch', 'food', 1);
    const view = at('view', 'scenic', 2);
    const result = suggestForTrip([{ activity_id: null, snapshot: gone }], [lunch, view]);
    expect(ids(result)).toEqual(['view', 'lunch']);
    expect(result[0].nearName).toBe('Name gone');
  });
});

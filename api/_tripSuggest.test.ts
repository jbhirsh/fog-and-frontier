import { describe, expect, it } from 'vitest';
import {
  MAX_TRIP_SUGGESTIONS,
  keepTripPicks,
  toCandidate,
  type TripCandidate,
} from './_tripSuggest.js';

const candidate = (id: string): TripCandidate => ({
  id,
  name: id,
  category: 'hiking',
  region: 'sf',
  city: 'San Francisco',
  shortDescription: '',
  duration: 'Half Day',
});

describe('toCandidate (#78)', () => {
  it('keeps what ranking needs, with the city off the location', () => {
    expect(
      toCandidate({
        id: 'ff',
        name: 'Fort Funston',
        category: 'scenic',
        region: 'sf',
        location: { city: 'San Francisco', coords: { lat: 1, lng: 2 } },
        shortDescription: 'Bluffs.',
        duration: '1-2 Hours',
        difficulty: 'easy',
        dogFriendly: true,
        coverImage: 'http://img',
        notes: 'not sent',
      }),
    ).toEqual({
      id: 'ff',
      name: 'Fort Funston',
      category: 'scenic',
      region: 'sf',
      city: 'San Francisco',
      shortDescription: 'Bluffs.',
      duration: '1-2 Hours',
      difficulty: 'easy',
      dogFriendly: true,
    });
  });

  it('sends unknown difficulty and dog rules as null', () => {
    const c = toCandidate({ id: 'x', location: { city: 'X' } });
    expect(c.difficulty).toBeNull();
    expect(c.dogFriendly).toBeNull();
  });
});

describe('keepTripPicks (#78)', () => {
  const candidates = [candidate('a'), candidate('b'), candidate('c')];

  it('keeps real picks once each, in order, with trimmed reasons', () => {
    expect(
      keepTripPicks(
        {
          suggestions: [
            { activityId: 'b', reason: '  fits  ' },
            { activityId: 'made-up', reason: 'x' },
            { activityId: 'b', reason: 'again' },
            { activityId: 7, reason: 'x' },
            null,
            { activityId: 'a' },
          ],
        },
        candidates,
      ),
    ).toEqual([
      { activityId: 'b', reason: 'fits' },
      { activityId: 'a', reason: '' },
    ]);
  });

  it('stops at the most a list can hold', () => {
    const many = Array.from({ length: MAX_TRIP_SUGGESTIONS + 2 }, (_, i) => candidate(`p${i}`));
    const picks = keepTripPicks(
      { suggestions: many.map((c) => ({ activityId: c.id, reason: 'r' })) },
      many,
    );
    expect(MAX_TRIP_SUGGESTIONS).toBe(12);
    expect(picks.map((p) => p.activityId)).toEqual(many.slice(0, 12).map((c) => c.id));
  });

  it('reads anything without a list as no picks', () => {
    expect(keepTripPicks(null, candidates)).toEqual([]);
    expect(keepTripPicks({ suggestions: 'a' }, candidates)).toEqual([]);
    expect(keepTripPicks({}, candidates)).toEqual([]);
  });
});

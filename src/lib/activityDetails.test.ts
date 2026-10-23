import { describe, expect, it } from 'vitest';
import { rowDetails, type DetailRow } from './activityDetails';

const full: Required<DetailRow> = {
  durationDetail: '2-3 hours',
  difficulty: 'moderate',
  dogFriendly: false,
  hikeDistanceMiles: 0,
  hikeElevationFeet: 1200,
  allTrailsUrl: 'https://www.alltrails.com/trail/x',
  cuisine: 'Thai',
  priceRange: '$$',
  costTier: 'free',
  hours: '9-5',
  reservationUrl: 'https://r.example',
  menuUrl: 'https://m.example',
  dietary: ['vegan'],
  notes: 'Bring water',
  coverCredit: 'Photo: someone',
};

describe('rowDetails', () => {
  it('keeps every detail that is set, falsy ones included', () => {
    expect(rowDetails(full)).toEqual(full);
  });

  it('turns every null into undefined', () => {
    const nulls = Object.fromEntries(Object.keys(full).map((k) => [k, null])) as DetailRow;
    const details = rowDetails(nulls);
    expect(Object.keys(details).sort()).toEqual(Object.keys(full).sort());
    for (const value of Object.values(details as Record<string, unknown>)) {
      expect(value).toBeUndefined();
    }
  });

  it('leaves out nothing it was not given', () => {
    const details = rowDetails({}) as Record<string, unknown>;
    expect(Object.values(details).every((v) => v === undefined)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { trailNumbers } from './trailOptions';

const TRAIL = { url: 'https://www.alltrails.com/trail/us/x/y', title: 'Y', description: '' };

describe('trailNumbers', () => {
  it('writes the rating with its count, the distance and the climb', () => {
    expect(trailNumbers({ ...TRAIL, rating: 4.7, reviews: 6412, miles: 8.4, feet: 1640 })).toEqual([
      '★ 4.7 (6,412)',
      '8.4 mi',
      '1,640 ft gain',
    ]);
  });

  it('rounds to a tenth, keeping a whole number whole', () => {
    expect(trailNumbers({ ...TRAIL, rating: 5, miles: 13.04, feet: 905 })).toEqual([
      '★ 5.0',
      '13 mi',
      '905 ft gain',
    ]);
    expect(trailNumbers({ ...TRAIL, miles: 0.95 })).toEqual(['0.9 mi']);
  });

  it('gives what it has, and nothing for none', () => {
    expect(trailNumbers(TRAIL)).toEqual([]);
    expect(trailNumbers({ ...TRAIL, reviews: 12 })).toEqual([]);
    expect(trailNumbers({ ...TRAIL, feet: 0 })).toEqual(['0 ft gain']);
    expect(trailNumbers({ ...TRAIL, rating: 4.5, reviews: 0 })).toEqual(['★ 4.5 (0)']);
  });
});

import { describe, expect, it } from 'vitest';
import { COST_TIERS, costLabel, costStat } from './cost';

describe('cost tiers (#85)', () => {
  it('runs cheapest first', () => {
    expect(COST_TIERS).toEqual(['free', '$', '$$', '$$$']);
  });

  it('labels each tier with its rough per-person range', () => {
    expect(COST_TIERS.map(costLabel)).toEqual([
      'Free',
      '$ · under $25',
      '$$ · $25–75',
      '$$$ · over $75',
    ]);
  });

  it('says "per person" in the detail stat, except for free', () => {
    expect(COST_TIERS.map(costStat)).toEqual([
      'Free',
      '$ · under $25 per person',
      '$$ · $25–75 per person',
      '$$$ · over $75 per person',
    ]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ISO_REGIONS } from '../../shared/isoRegions';
import { californiaLabel, loadRegionOptions, regionOptions, searchRegions } from './regions';

// A few of the ISO regions, in the list's own order (by country).
const SOME = [
  ['IS-1', 'Höfuðborgarsvæði', 'Iceland'],
  ['JP-26', 'Kyoto', 'Japan'],
  ['JP-13', 'Tokyo', 'Japan'],
  ['HK', 'Hong Kong', ''],
  ['US-OR', 'Oregon', 'United States'],
  ['US-UT', 'Utah', 'United States'],
  ['US-WA', 'Washington', 'United States'],
  ['US-DC', 'District of Columbia', 'United States'],
] as unknown as typeof ISO_REGIONS;

const labels = (query: string, limit?: number) =>
  searchRegions(regionOptions(SOME), query, limit).map((o) => o.label);

describe('regionOptions (#274)', () => {
  it('lists California’s areas, then each region with its country', () => {
    const options = regionOptions(SOME);
    expect(options.slice(0, 2)).toMatchObject([
      { id: 'sf', label: 'San Francisco' },
      { id: 'north-bay', label: 'North Bay' },
    ]);
    expect(options.find((o) => o.id === 'JP-26')).toMatchObject({ label: 'Kyoto, Japan' });
    // A country that is a region itself is named alone.
    expect(options.find((o) => o.id === 'HK')).toMatchObject({ label: 'Hong Kong' });
  });
});

describe('searchRegions (#274)', () => {
  it('offers California’s areas before anything is typed', () => {
    expect(labels('')).toEqual([
      'San Francisco',
      'North Bay',
      'East Bay',
      'South Bay',
      'Peninsula',
      'Central Coast',
      'NorCal',
      'SoCal',
    ]);
    expect(labels('  ', 3)).toEqual(['San Francisco', 'North Bay', 'East Bay']);
    // Never more than the areas, however many are asked for.
    expect(labels('', 20)).toHaveLength(8);
  });

  it('matches the start of any word, in any case, without accents', () => {
    expect(labels('kyo')).toEqual(['Kyoto, Japan']);
    expect(labels('JAPAN')).toEqual(['Kyoto, Japan', 'Tokyo, Japan']);
    expect(labels('hofudborg')).toEqual(['Höfuðborgarsvæði, Iceland']);
    // A word's middle isn't a match: "oto" is in Kyoto, but starts no word.
    expect(labels('oto')).toEqual([]);
  });

  it('needs every word typed, and finds a region by its code', () => {
    expect(labels('united states ut')).toEqual(['Utah, United States']);
    expect(labels('us-wa')).toEqual(['Washington, United States']);
    expect(labels('jp 26')).toEqual(['Kyoto, Japan']);
  });

  it('puts a label starting with what’s typed first, then keeps the list’s order', () => {
    expect(labels('w')).toEqual(['Washington, United States']);
    // Utah's own name starts with "u", so it leads the other United States
    // entries, though Oregon is first in the list.
    expect(labels('u')).toEqual([
      'Utah, United States',
      'Oregon, United States',
      'Washington, United States',
      'District of Columbia, United States',
    ]);
    expect(labels('o')).toEqual(['Oregon, United States', 'District of Columbia, United States']);
    expect(labels('d')).toEqual(['District of Columbia, United States']);
  });

  it('stops at the limit', () => {
    expect(labels('united', 2)).toEqual(['Oregon, United States', 'Utah, United States']);
  });
});

describe('loadRegionOptions when the list can’t load (#274)', () => {
  it('tries again next time', async () => {
    vi.resetModules();
    vi.doMock('../../shared/isoRegions', () => {
      throw new Error('chunk gone');
    });
    const { loadRegionOptions: load } = await import('./regions');
    await expect(load()).rejects.toThrow();
    vi.doUnmock('../../shared/isoRegions');
    const options = await load();
    expect(options.find((o) => o.id === 'JP-26')?.label).toBe('Kyoto, Japan');
    vi.resetModules();
  });
});

describe('californiaLabel (#274)', () => {
  it('names an area without loading the rest, and nothing else', () => {
    expect(californiaLabel('south-bay')).toBe('South Bay');
    expect(californiaLabel('US-OR')).toBeUndefined();
  });
});

describe('loadRegionOptions (#274)', () => {
  it('loads every region once', async () => {
    const options = await loadRegionOptions();
    expect(options).toHaveLength(8 + 3638);
    expect(options.find((o) => o.id === 'JP-26')?.label).toBe('Kyoto, Japan');
    // California is its areas, not one region.
    expect(options.map((o): string => o.id)).not.toContain('US-CA');
    expect(await loadRegionOptions()).toBe(options);
  });
});

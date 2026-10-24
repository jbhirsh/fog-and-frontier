import { describe, expect, it } from 'vitest';
import { toRegion } from './_regions';

describe('toRegion (#274)', () => {
  it('keeps the California areas as they are', () => {
    expect(toRegion('sf')).toBe('sf');
    expect(toRegion('north-bay')).toBe('north-bay');
    expect(toRegion('socal')).toBe('socal');
    // An area's id is its own spelling, not an ISO code's.
    expect(toRegion('SF')).toBeNull();
  });

  it('takes any first-level subdivision, or a country without them, by its ISO code', () => {
    expect(toRegion('US-OR')).toBe('US-OR');
    expect(toRegion('JP-26')).toBe('JP-26');
    expect(toRegion('CA-BC')).toBe('CA-BC');
    expect(toRegion('HK')).toBe('HK');
    // However a model writes it.
    expect(toRegion(' us-ut ')).toBe('US-UT');
  });

  it('reads the ids saved before #274 as the states they named', () => {
    expect(toRegion('oregon')).toBe('US-OR');
    expect(toRegion('washington')).toBe('US-WA');
  });

  it('names nothing for anything else', () => {
    // California itself is divided into the areas above.
    expect(toRegion('US-CA')).toBeNull();
    // A country that has subdivisions is chosen by one of them.
    expect(toRegion('JP')).toBeNull();
    // A second-level subdivision, a made-up code, a name, nothing.
    expect(toRegion('FR-69')).toBeNull();
    expect(toRegion('XX-1')).toBeNull();
    expect(toRegion('Oregon')).toBeNull();
    expect(toRegion('')).toBeNull();
    expect(toRegion(null)).toBeNull();
    // Nor anything an object has of its own, for every object.
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(toRegion(key)).toBeNull();
    }
    expect(toRegion(7)).toBeNull();
  });
});

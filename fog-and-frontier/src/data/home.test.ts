import { describe, expect, it } from 'vitest';
import { HOME_LOCATION, distanceMiles } from './home';

describe('distanceMiles', () => {
  it('returns 0 for the same point', () => {
    expect(distanceMiles({ lat: 37, lng: -122 }, { lat: 37, lng: -122 })).toBe(0);
  });

  it('approximates Campbell to San Francisco at ~40 miles', () => {
    const sf = { lat: 37.7749, lng: -122.4194 };
    const d = distanceMiles(HOME_LOCATION.coords, sf);
    expect(d).toBeGreaterThan(38);
    expect(d).toBeLessThan(45);
  });

  it('approximates Campbell to LA at ~290 miles', () => {
    const la = { lat: 34.0522, lng: -118.2437 };
    const d = distanceMiles(HOME_LOCATION.coords, la);
    expect(d).toBeGreaterThan(280);
    expect(d).toBeLessThan(310);
  });

  it('is symmetric', () => {
    const a = { lat: 36, lng: -120 };
    const b = { lat: 38, lng: -123 };
    expect(distanceMiles(a, b)).toBeCloseTo(distanceMiles(b, a), 6);
  });

  it('exposes a configured home location', () => {
    expect(HOME_LOCATION.label).toMatch(/Campbell/);
    expect(HOME_LOCATION.coords.lat).toBeGreaterThan(36);
    expect(HOME_LOCATION.coords.lat).toBeLessThan(38);
  });
});

import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { directionsUrl, isApplePlatform } from './directions';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('isApplePlatform', () => {
  it('detects iPhone, iPad and Mac user agents', () => {
    expect(isApplePlatform({ userAgent: IPHONE_UA })).toBe(true);
    expect(isApplePlatform({ userAgent: IPAD_DESKTOP_UA })).toBe(true);
  });

  it('detects Apple from navigator.platform alone', () => {
    expect(isApplePlatform({ platform: 'iPhone' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPad' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPod touch' })).toBe(true);
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
  });

  it('detects Apple from the client-hints platform alone', () => {
    expect(isApplePlatform({ userAgentData: { platform: 'macOS' } })).toBe(
      true,
    );
  });

  it('reports non-Apple platforms as such', () => {
    expect(
      isApplePlatform({
        userAgent: ANDROID_UA,
        platform: 'Linux armv81',
        userAgentData: { platform: 'Android' },
      }),
    ).toBe(false);
    expect(
      isApplePlatform({
        userAgent: WINDOWS_UA,
        platform: 'Win32',
        userAgentData: {},
      }),
    ).toBe(false);
    expect(isApplePlatform({})).toBe(false);
  });

  it('reads the real navigator by default', () => {
    const ua = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue(IPHONE_UA);
    onTestFinished(() => ua.mockRestore());
    expect(isApplePlatform()).toBe(true);
    ua.mockReturnValue(WINDOWS_UA);
    expect(isApplePlatform()).toBe(false);
  });
});

describe('directionsUrl', () => {
  const coords = { lat: 37.8917, lng: -122.5719 };

  it('builds an Apple Maps directions URL on Apple platforms', () => {
    expect(directionsUrl(coords, true)).toBe(
      'https://maps.apple.com/?daddr=37.8917%2C-122.5719',
    );
  });

  it('builds a Google Maps directions URL everywhere else', () => {
    expect(directionsUrl(coords, false)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=37.8917%2C-122.5719',
    );
  });

  it('encodes the destination so it decodes back to "lat,lng"', () => {
    for (const apple of [true, false]) {
      const url = new URL(directionsUrl(coords, apple) ?? '');
      expect(url.searchParams.get(apple ? 'daddr' : 'destination')).toBe(
        '37.8917,-122.5719',
      );
    }
  });

  it('accepts the edges of the latitude and longitude ranges', () => {
    expect(directionsUrl({ lat: 90, lng: 180 }, false)).toContain(
      'destination=90%2C180',
    );
    expect(directionsUrl({ lat: -90, lng: -180 }, false)).toContain(
      'destination=-90%2C-180',
    );
    expect(directionsUrl({ lat: 0, lng: 0 }, true)).toContain('daddr=0%2C0');
  });

  it('returns null when coordinates are missing', () => {
    expect(directionsUrl(undefined, true)).toBeNull();
    expect(directionsUrl(null, false)).toBeNull();
    expect(directionsUrl({}, false)).toBeNull();
    expect(directionsUrl({ lat: 37 }, false)).toBeNull();
    expect(directionsUrl({ lng: -122 }, false)).toBeNull();
    expect(directionsUrl({ lat: null, lng: null }, true)).toBeNull();
  });

  it('returns null for non-finite coordinates', () => {
    expect(directionsUrl({ lat: Number.NaN, lng: -122 }, false)).toBeNull();
    expect(directionsUrl({ lat: 37, lng: Number.NaN }, false)).toBeNull();
    expect(directionsUrl({ lat: Infinity, lng: -122 }, true)).toBeNull();
    expect(directionsUrl({ lat: 37, lng: -Infinity }, true)).toBeNull();
  });

  it('returns null for coordinates outside the valid range', () => {
    expect(directionsUrl({ lat: 90.0001, lng: 0 }, false)).toBeNull();
    expect(directionsUrl({ lat: -90.0001, lng: 0 }, false)).toBeNull();
    expect(directionsUrl({ lat: 0, lng: 180.0001 }, false)).toBeNull();
    expect(directionsUrl({ lat: 0, lng: -180.0001 }, false)).toBeNull();
    // Longitude allows more than latitude: a valid longitude of 120 is not a
    // valid latitude.
    expect(directionsUrl({ lat: 0, lng: 120 }, false)).not.toBeNull();
    expect(directionsUrl({ lat: 120, lng: 0 }, false)).toBeNull();
  });
});

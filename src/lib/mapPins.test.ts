import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ICON,
  MINOR_PIN_MILES,
  cartoTileUrl,
  glyphPin,
  hasNearPinInView,
  isMinorPin,
  minorPin,
  pinZIndex,
} from './mapPins';

const BASE = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

describe('cartoTileUrl', () => {
  it('appends the API key as a `key` query param', () => {
    expect(cartoTileUrl('abc123')).toBe(`${BASE}?key=abc123`);
  });

  it('trims and URL-encodes the key', () => {
    expect(cartoTileUrl('  a b&c  ')).toBe(`${BASE}?key=a%20b%26c`);
  });

  it('falls back to the bare URL when no key is configured', () => {
    expect(cartoTileUrl(undefined)).toBe(BASE);
    expect(cartoTileUrl('')).toBe(BASE);
    expect(cartoTileUrl('   ')).toBe(BASE);
  });
});

describe('glyphPin', () => {
  it('renders an icon glyph at the default size', () => {
    const icon = glyphPin('#0ea5e9', { icon: 'landscape' });
    expect(icon.options.className).toBe('glyph-pin');
    expect(icon.options.iconSize).toEqual([30, 30]);
    expect(icon.options.iconAnchor).toEqual([15, 15]);
    expect(icon.options.html).toContain('material-symbols-outlined');
    expect(icon.options.html).toContain('landscape');
    expect(icon.options.html).toContain('background:#0ea5e9');
  });

  it('renders a text glyph larger when highlighted', () => {
    const icon = glyphPin('#16a34a', { text: '3' }, { highlighted: true });
    expect(icon.options.iconSize).toEqual([40, 40]);
    expect(icon.options.popupAnchor).toEqual([0, -22]);
    expect(icon.options.html).toContain('>3</span>');
    expect(icon.options.html).not.toContain('material-symbols-outlined');
  });
});

describe('isMinorPin', () => {
  it('draws a dot past the day-trip line, the "Within 100 mi" filter step', () => {
    expect(MINOR_PIN_MILES).toBe(100);
    expect(isMinorPin(100.1, false, true)).toBe(true);
    expect(isMinorPin(450, false, true)).toBe(true);
  });

  it('keeps a full pin at or inside the line', () => {
    expect(isMinorPin(100, false, true)).toBe(false);
    expect(isMinorPin(12, false, true)).toBe(false);
  });

  it('promotes a far pin to a full one while it is active', () => {
    expect(isMinorPin(450, true, true)).toBe(false);
  });

  it('keeps far pins whole when no near pin is in view', () => {
    expect(isMinorPin(450, false, false)).toBe(false);
  });
});

describe('hasNearPinInView', () => {
  const view = { north: 38, south: 37, east: -121, west: -123 };
  const near = { lat: 37.3, lng: -121.9, miles: 12 };
  const nearOutOfView = { lat: 34, lng: -118.2, miles: 100 };
  const far = { lat: 37.5, lng: -122, miles: 100.5 };

  it('is true with a near pin in view, the line included', () => {
    expect(hasNearPinInView([far, near], view)).toBe(true);
    expect(hasNearPinInView([{ ...near, miles: 100 }], view)).toBe(true);
  });

  it('is false when every pin in view is far', () => {
    expect(hasNearPinInView([far], view)).toBe(false);
  });

  it('ignores near pins outside the view', () => {
    expect(hasNearPinInView([far, nearOutOfView], view)).toBe(false);
  });

  it('counts any near pin before the view is known', () => {
    expect(hasNearPinInView([far, nearOutOfView], null)).toBe(true);
    expect(hasNearPinInView([far], null)).toBe(false);
  });

  it('is false with no pins', () => {
    expect(hasNearPinInView([], view)).toBe(false);
  });
});

describe('pinZIndex', () => {
  it('raises a highlighted or hovered pin above its neighbours', () => {
    expect(pinZIndex(true, false)).toBe(1000);
    expect(pinZIndex(true, true)).toBe(1000);
  });

  it('sinks minor dots under full pins', () => {
    expect(pinZIndex(false, true)).toBe(-1000);
  });

  it('leaves an ordinary pin where Leaflet puts it', () => {
    expect(pinZIndex(false, false)).toBe(0);
  });
});

describe('minorPin', () => {
  it('draws a small dot in the status color, with no glyph', () => {
    const icon = minorPin('#16a34a');
    expect(icon.options.html).toContain('background:#16a34a');
    expect(icon.options.html).toContain('width:10px;height:10px');
    expect(icon.options.html).not.toContain('material-symbols-outlined');
    expect(icon.options.className).toBe('glyph-pin');
  });

  it('centres the dot in a 24px box that takes the hover and tap', () => {
    const icon = minorPin('#0ea5e9');
    expect(icon.options.html).toContain('width:24px;height:24px');
    expect(icon.options.iconSize).toEqual([24, 24]);
    expect(icon.options.iconAnchor).toEqual([12, 12]);
    expect(icon.options.popupAnchor).toEqual([0, -7]);
  });
});

describe('CATEGORY_ICON', () => {
  it('gives each category the same Material Symbols glyph as its catalog card', () => {
    expect(CATEGORY_ICON).toEqual({
      hiking: 'directions_walk',
      cycling: 'pedal_bike',
      water: 'water',
      food: 'restaurant',
      culture: 'museum',
      scenic: 'landscape',
      climbing: 'terrain',
      camping: 'forest',
      other: 'explore',
    });
  });
});

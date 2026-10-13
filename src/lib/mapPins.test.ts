import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ICON,
  MINOR_PIN_MILES,
  cartoTileUrl,
  glyphPin,
  isMinorPin,
  minorPin,
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
    expect(isMinorPin(100.1, false)).toBe(true);
    expect(isMinorPin(450, false)).toBe(true);
  });

  it('keeps a full pin at or inside the line', () => {
    expect(isMinorPin(100, false)).toBe(false);
    expect(isMinorPin(12, false)).toBe(false);
  });

  it('promotes a far pin to a full one while it is active', () => {
    expect(isMinorPin(450, true)).toBe(false);
    expect(isMinorPin(12, true)).toBe(false);
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

  it('centres the dot in a larger box that takes the hover and tap', () => {
    const icon = minorPin('#0ea5e9');
    expect(icon.options.html).toContain('width:22px;height:22px');
    expect(icon.options.iconSize).toEqual([22, 22]);
    expect(icon.options.iconAnchor).toEqual([11, 11]);
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

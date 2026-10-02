import { describe, expect, it } from 'vitest';
import { CATEGORY_ICON, cartoTileUrl, glyphPin } from './mapPins';

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

import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ICON,
  MINOR_PIN_MILES,
  cartoTileUrl,
  glyphPin,
  groupPin,
  homePin,
  MARKER_REACH_PX,
  hasNearPinInView,
  isMinorPin,
  minorPin,
  pinZIndex,
} from './mapPins';
import { GROUP_RADIUS_PX } from './pinGroups';

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

describe('groupPin', () => {
  it('draws the count in a navy circle sized by it, named for a screen reader', () => {
    const icon = groupPin(12, '12 places, zoom in');
    expect(icon.options.html).toMatch(
      /<span aria-hidden="true"[^>]*font-size:14px[^>]*>12<\/span>/,
    );
    expect(icon.options.html).toContain('<span class="sr-only">12 places, zoom in</span>');
    expect(icon.options.html).toContain('background:#001e37');
    expect(icon.options.html).toContain('width:42px;height:42px');
    expect(icon.options.html).toContain('border:2px solid #fff');
    expect(icon.options.iconSize).toEqual([42, 42]);
    expect(icon.options.iconAnchor).toEqual([21, 21]);
    expect(icon.options.className).toBe('glyph-pin pin-group');
  });

  it('rings a highlighted group in blue, the same size', () => {
    const icon = groupPin(12, '', { highlighted: true });
    expect(icon.options.html).toContain('border:3px solid #0ea5e9');
    expect(icon.options.iconSize).toEqual([42, 42]);
  });

  it('sets a three-figure count smaller, to fit', () => {
    expect(groupPin(99, '').options.html).toContain('font-size:14px');
    expect(groupPin(100, '').options.html).toContain('font-size:11px');
  });

  it('draws a group of far places small and muted', () => {
    const icon = groupPin(30, '', { minor: true });
    expect(icon.options.html).toContain('background:#64748b');
    expect(icon.options.html).toContain('width:24px;height:24px');
    expect(icon.options.html).toContain('font-size:11px');
    expect(icon.options.iconSize).toEqual([24, 24]);
  });
});

describe('homePin', () => {
  it('is the plain house pin with nothing beside it', () => {
    const icon = homePin('#dc2626', 0);
    expect(icon.options.html).toBe(glyphPin('#dc2626', { icon: 'home' }).options.html);
    expect(icon.options.className).toBe('glyph-pin');
  });

  it('badges the house with the count of places beside it, named, the same size', () => {
    const icon = homePin('#dc2626', 3, 'Home, 3 places beside it, zoom in');
    expect(icon.options.html).toContain('>home</span>');
    expect(icon.options.html).toContain('background:#dc2626');
    expect(icon.options.html).toMatch(/aria-hidden="true"[^>]*background:#001e37[^>]*>3<\/span>/);
    expect(icon.options.html).toContain('top:-3px;right:-3px');
    expect(icon.options.html).toContain(
      '<span class="sr-only">Home, 3 places beside it, zoom in</span>',
    );
    expect(icon.options.iconSize).toEqual([30, 30]);
    expect(icon.options.iconAnchor).toEqual([15, 15]);
    expect(icon.options.className).toBe('glyph-pin pin-group');
  });

  it('turns the badge blue when highlighted', () => {
    expect(homePin('#dc2626', 3, '', { highlighted: true }).options.html).toMatch(
      /background:#0ea5e9[^>]*>3<\/span>/,
    );
  });
});

describe('MARKER_REACH_PX', () => {
  it('is the farthest a marker reaches: a group at its widest', () => {
    expect(MARKER_REACH_PX).toBe(23);
  });

  it('keeps any two markers apart at the grouping radius', () => {
    expect(2 * MARKER_REACH_PX).toBeLessThanOrEqual(GROUP_RADIUS_PX);
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

import { describe, expect, it } from 'vitest';
import { ICON_OPTICAL_OFFSET, ICON_SIDE_BEARING, glyphBleed, glyphNudge } from './iconMetrics';
import { CATEGORY_ICON } from './mapPins';

describe('glyphBleed', () => {
  it('pulls an icon out by its measured side bearing, in em', () => {
    expect(glyphBleed('expand_more')).toBe('-0.25em');
    expect(glyphBleed('add')).toBe('-0.194em');
  });

  it('leaves a glyph with no side bearing, or an unmeasured one, in place', () => {
    expect(glyphBleed('forest')).toBe('0');
    expect(glyphBleed('not_an_icon')).toBe('0');
  });

  it('holds the bearings as measured', () => {
    expect(ICON_SIDE_BEARING).toEqual({
      add: 0.194,
      category: 0.111,
      check_box: 0.111,
      check_circle: 0.083,
      close: 0.194,
      expand_less: 0.25,
      expand_more: 0.25,
      lightbulb: 0.167,
      location_on: 0.167,
      map: 0.111,
      payments: 0.042,
      person: 0.167,
      pets: 0.083,
      schedule: 0.083,
      directions_walk: 0.233,
      explore: 0.067,
      forest: 0,
      landscape: 0.033,
      museum: 0.067,
      pedal_bike: 0,
      restaurant: 0.167,
      terrain: 0.033,
      water: 0.067,
    });
  });

  it('covers every category glyph', () => {
    for (const icon of Object.values(CATEGORY_ICON)) {
      expect(ICON_SIDE_BEARING).toHaveProperty(icon);
    }
  });
});

describe('glyphNudge (#291)', () => {
  it('moves a glyph to where it looks centred, by its measured offset', () => {
    // A mountain's wide base sits low: up and a touch left.
    expect(glyphNudge('landscape')).toBe('transform:translate(-0.012em,-0.068em);');
    // The fork and knife's tines sit high: down.
    expect(glyphNudge('restaurant')).toBe('transform:translate(0em,0.06em);');
  });

  it('leaves a glyph that already looks centred alone', () => {
    expect(glyphNudge('explore')).toBe('');
    expect(glyphNudge('not_an_icon')).toBe('');
  });

  it('keeps every offset small, a nudge rather than a move', () => {
    for (const { x, y } of Object.values(ICON_OPTICAL_OFFSET)) {
      expect(Math.abs(x)).toBeLessThan(0.1);
      expect(Math.abs(y)).toBeLessThan(0.1);
    }
  });
});

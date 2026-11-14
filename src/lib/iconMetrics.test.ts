import { describe, expect, it } from 'vitest';
import { opticalOffset, sideBearing } from './iconGeometry';
import { ICON_OPTICAL_OFFSET, ICON_SIDE_BEARING, glyphBleed, glyphNudge } from './iconMetrics';
import { ICONS, PIN_ICONS, type IconName, type PinIconName } from './iconPaths';
import { CATEGORY_ICON } from './mapPins';

describe('glyphBleed', () => {
  it('pulls an icon out by its side bearing, in em', () => {
    expect(glyphBleed('expand_more')).toBe('-0.25em');
    expect(glyphBleed('add')).toBe('-0.208em');
  });

  it('leaves a glyph with no side bearing, or one not listed, in place', () => {
    expect(glyphBleed('forest')).toBe('0');
    expect(glyphBleed('search')).toBe('0');
  });

  it('holds each bearing to its icon’s path', () => {
    for (const [icon, em] of Object.entries(ICON_SIDE_BEARING)) {
      // On a failure (the icons were regenerated), set the table to the path's.
      expect([icon, em]).toEqual([icon, sideBearing(ICONS[icon as IconName])]);
    }
  });

  it('covers every category glyph', () => {
    for (const icon of Object.values(CATEGORY_ICON)) {
      expect(ICON_SIDE_BEARING).toHaveProperty(icon);
    }
  });
});

describe('glyphNudge (#291)', () => {
  it('moves a glyph to where it looks centred, by its offset', () => {
    // A mountain's wide base sits low: up and a touch left.
    expect(glyphNudge('landscape')).toBe('transform:translate(-0.011em,-0.066em);');
    // The fork and knife's tines sit high: down.
    expect(glyphNudge('restaurant')).toBe('transform:translate(-0.003em,0.064em);');
  });

  it('lists every pin glyph off the middle, at its path’s offset', () => {
    for (const icon of Object.keys(PIN_ICONS) as PinIconName[]) {
      const off = opticalOffset(PIN_ICONS[icon]);
      const listed = Math.max(Math.abs(off.x), Math.abs(off.y)) >= 0.005;
      // On a failure (the icons were regenerated), set the table to the path's offset.
      expect([icon, ICON_OPTICAL_OFFSET[icon]]).toEqual([icon, listed ? off : undefined]);
    }
  });

  it('leaves a glyph that already looks centred alone', () => {
    expect(glyphNudge('explore')).toBe('');
  });

  it('keeps every offset small, a nudge rather than a move', () => {
    for (const { x, y } of Object.values(ICON_OPTICAL_OFFSET)) {
      expect(Math.abs(x)).toBeLessThan(0.1);
      expect(Math.abs(y)).toBeLessThan(0.1);
    }
  });
});

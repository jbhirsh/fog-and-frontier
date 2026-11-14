import { describe, expect, it } from 'vitest';
import { inkOf, opticalOffset, sideBearing } from './iconGeometry';

// A square, 480 wide, in the middle of the 960-unit box (its top at -720).
const SQUARE = 'M240-720h480v480H240Z';

describe('inkOf', () => {
  it('bounds the ink and finds its centre of mass', () => {
    expect(inkOf(SQUARE)).toEqual({
      minX: 240,
      maxX: 720,
      minY: -720,
      maxY: -240,
      centreX: 480,
      centreY: -480,
    });
  });

  it('reads absolute and relative lines alike', () => {
    expect(inkOf('M240-720L720-720L720-240L240-240Z')).toEqual(inkOf(SQUARE));
    expect(inkOf('m240-720l480 0 0 480-480 0z')).toEqual(inkOf(SQUARE));
    expect(inkOf('M240-720H720V-240H240Z')).toEqual(inkOf(SQUARE));
  });

  it('takes out a hole wound the other way', () => {
    // A square ring: the middle quarter of the square cut away.
    const ring = inkOf(`${SQUARE}M360-600v240h240v-240Z`);
    expect(ring.centreX).toBeCloseTo(480, 6);
    expect(ring.centreY).toBeCloseTo(-480, 6);
  });

  it('follows a curve, smooth ones too', () => {
    // A dome over the box's bottom half: its top is the curve's peak, not its control point.
    const dome = inkOf('M240-240Q480-720 720-240Z');
    expect(dome.minY).toBeCloseTo(-480, 0);
    const smooth = inkOf('M240-240q120-240 240 0t240 0Z');
    expect(smooth.minY).toBeCloseTo(-360, 0);
    expect(smooth.maxY).toBeCloseTo(-120, 0);
  });

  it('refuses a command Material Symbols doesn’t use', () => {
    expect(() => inkOf('M0 0C1 1 2 2 3 3Z')).toThrow('no support for "C"');
  });

  it('refuses drawing on after a close without a move', () => {
    expect(() => inkOf('M240-720h480v480Zh100v100Z')).toThrow('without a move');
  });
});

describe('sideBearing and opticalOffset', () => {
  it('measures a centred square: a quarter of the box each side, centred', () => {
    expect(sideBearing(SQUARE)).toBe(0.25);
    expect(opticalOffset(SQUARE)).toEqual({ x: 0, y: 0 });
  });

  it('puts a bottom-heavy shape’s look below its box’s middle', () => {
    // A triangle, point up: its mass sits low.
    expect(opticalOffset('M480-720 720-240H240Z').y).toBeGreaterThan(0);
  });
});

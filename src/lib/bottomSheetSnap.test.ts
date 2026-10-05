import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  SNAP_CSS,
  cycleSnap,
  dragHeight,
  isDrag,
  nearestSnap,
  snapHeights,
  stepSnap,
  type SnapHeights,
} from './bottomSheetSnap';

// A round set of rest heights so the midpoints below are easy to read.
const HEIGHTS: SnapHeights = { peek: 100, half: 400, full: 700 };

describe('SNAP_CSS', () => {
  it('fixes peek and sizes half and full to the dynamic viewport', () => {
    expect(SNAP_CSS).toEqual({ peek: '7rem', half: '52dvh', full: '90dvh' });
  });
});

describe('snapHeights', () => {
  it('matches SNAP_CSS in pixels for an 800px viewport', () => {
    expect(snapHeights(800)).toEqual({ peek: 112, half: 416, full: 720 });
  });

  it('rounds the fractional heights to whole pixels', () => {
    // 0.52 * 845 = 439.4 and 0.9 * 845 = 760.5.
    expect(snapHeights(845)).toEqual({ peek: 112, half: 439, full: 761 });
  });
});

describe('nearestSnap', () => {
  it('picks the rest position closest to the height', () => {
    expect(nearestSnap(90, HEIGHTS)).toBe('peek');
    expect(nearestSnap(240, HEIGHTS)).toBe('peek');
    expect(nearestSnap(260, HEIGHTS)).toBe('half');
    expect(nearestSnap(540, HEIGHTS)).toBe('half');
    expect(nearestSnap(560, HEIGHTS)).toBe('full');
    expect(nearestSnap(900, HEIGHTS)).toBe('full');
  });

  it('resolves an exact midpoint to the lower position', () => {
    expect(nearestSnap(250, HEIGHTS)).toBe('peek');
    expect(nearestSnap(550, HEIGHTS)).toBe('half');
  });
});

describe('cycleSnap', () => {
  it('cycles peek → half → full → peek', () => {
    expect(cycleSnap('peek')).toBe('half');
    expect(cycleSnap('half')).toBe('full');
    expect(cycleSnap('full')).toBe('peek');
  });
});

describe('stepSnap', () => {
  it('steps up one position and stops at full', () => {
    expect(stepSnap('peek', 1)).toBe('half');
    expect(stepSnap('half', 1)).toBe('full');
    expect(stepSnap('full', 1)).toBe('full');
  });

  it('steps down one position and stops at peek', () => {
    expect(stepSnap('full', -1)).toBe('half');
    expect(stepSnap('half', -1)).toBe('peek');
    expect(stepSnap('peek', -1)).toBe('peek');
  });
});

describe('dragHeight', () => {
  it('grows the sheet as the pointer moves up and shrinks it as it moves down', () => {
    expect(dragHeight(400, 500, 450, HEIGHTS)).toBe(450);
    expect(dragHeight(400, 500, 560, HEIGHTS)).toBe(340);
  });

  it('keeps the height between the peek and full rest heights', () => {
    expect(dragHeight(400, 500, 0, HEIGHTS)).toBe(700);
    expect(dragHeight(400, 500, 900, HEIGHTS)).toBe(100);
  });

  it('allows exactly the peek and full heights', () => {
    expect(dragHeight(400, 500, 200, HEIGHTS)).toBe(700);
    expect(dragHeight(400, 500, 800, HEIGHTS)).toBe(100);
  });
});

describe('isDrag', () => {
  it('treats travel up to the threshold as a tap', () => {
    expect(DRAG_THRESHOLD_PX).toBe(6);
    expect(isDrag(300, 300)).toBe(false);
    expect(isDrag(300, 306)).toBe(false);
    expect(isDrag(300, 294)).toBe(false);
  });

  it('treats travel past the threshold, either way, as a drag', () => {
    expect(isDrag(300, 307)).toBe(true);
    expect(isDrag(300, 293)).toBe(true);
  });
});

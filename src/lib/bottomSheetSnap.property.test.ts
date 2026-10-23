import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cycleSnap,
  dragHeight,
  isDrag,
  nearestSnap,
  snapHeights,
  stepSnap,
  type SheetSnap,
} from './bottomSheetSnap';

// Properties over arbitrary viewports and pointer positions, alongside the
// example tests in bottomSheetSnap.test.ts.
const snap = fc.constantFrom<SheetSnap>('peek', 'half', 'full');
// Phones and tablets: tall enough that peek < half < full holds.
const viewport = fc.integer({ min: 400, max: 3000 });
const y = fc.integer({ min: -5000, max: 5000 });

describe('bottom sheet snapping, for any viewport and pointer', () => {
  it('rests in order: peek below half below full', () => {
    fc.assert(
      fc.property(viewport, (vh) => {
        const h = snapHeights(vh);
        expect(h.peek).toBeLessThan(h.half);
        expect(h.half).toBeLessThan(h.full);
      }),
    );
  });

  it('never drags the sheet past peek or full', () => {
    fc.assert(
      fc.property(viewport, snap, y, y, (vh, from, startY, currentY) => {
        const h = snapHeights(vh);
        const height = dragHeight(h[from], startY, currentY, h);
        expect(height).toBeGreaterThanOrEqual(h.peek);
        expect(height).toBeLessThanOrEqual(h.full);
      }),
    );
  });

  it('follows the pointer one for one inside the range', () => {
    fc.assert(
      // From 600 px up, half ± 100 px stays inside peek..full.
      fc.property(
        fc.integer({ min: 600, max: 3000 }),
        fc.integer({ min: -100, max: 100 }),
        (vh, delta) => {
          const h = snapHeights(vh);
          expect(dragHeight(h.half, 1000, 1000 - delta, h)).toBe(h.half + delta);
        },
      ),
    );
  });

  it('snaps to a rest position no farther than any other', () => {
    fc.assert(
      fc.property(viewport, fc.integer({ min: 0, max: 4000 }), (vh, height) => {
        const h = snapHeights(vh);
        const chosen = nearestSnap(height, h);
        for (const other of ['peek', 'half', 'full'] as const) {
          expect(Math.abs(h[chosen] - height)).toBeLessThanOrEqual(Math.abs(h[other] - height));
        }
      }),
    );
  });

  it('snaps a rest height to itself', () => {
    fc.assert(
      fc.property(viewport, snap, (vh, rest) => {
        const h = snapHeights(vh);
        expect(nearestSnap(h[rest], h)).toBe(rest);
      }),
    );
  });

  it('comes back to where it started after three taps', () => {
    fc.assert(
      fc.property(snap, (start) => {
        expect(cycleSnap(cycleSnap(cycleSnap(start)))).toBe(start);
        expect(cycleSnap(start)).not.toBe(start);
      }),
    );
  });

  it('steps between neighbours and undoes a step, except at the ends', () => {
    const order: SheetSnap[] = ['peek', 'half', 'full'];
    fc.assert(
      fc.property(snap, fc.constantFrom<1 | -1>(1, -1), (start, direction) => {
        const next = stepSnap(start, direction);
        const moved = order.indexOf(next) - order.indexOf(start);
        expect([0, direction]).toContain(moved);
        if (moved !== 0) expect(stepSnap(next, direction === 1 ? -1 : 1)).toBe(start);
        else expect(start).toBe(direction === 1 ? 'full' : 'peek');
      }),
    );
  });

  it('calls a move a drag exactly when it travels past the threshold, either way', () => {
    fc.assert(
      fc.property(y, y, (startY, currentY) => {
        expect(isDrag(startY, currentY)).toBe(isDrag(currentY, startY));
        expect(isDrag(startY, currentY)).toBe(Math.abs(startY - currentY) > 6);
      }),
    );
  });
});

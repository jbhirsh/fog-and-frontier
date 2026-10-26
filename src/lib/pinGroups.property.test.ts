import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  GROUP_MAX_SIZE,
  GROUP_RADIUS_PX,
  drawPins,
  groupPins,
  groupSize,
  type Project,
  type ScreenPin,
} from './pinGroups';

// The map hands over wherever its pins land at the zoom: these hold for any
// of them. Example tests are in pinGroups.test.ts.

const pins = fc.uniqueArray(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 6 }),
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
  }),
  { selector: (p) => p.id, maxLength: 60 },
);
const radius = fc.integer({ min: 1, max: 120 });

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('groupPins, for any pins', () => {
  it('puts every pin in exactly one group', () => {
    fc.assert(
      fc.property(pins, radius, (given, r) => {
        const ids = groupPins(given, r).flatMap((g) => g.ids);
        expect([...ids].sort()).toEqual(given.map((p) => p.id).sort());
      }),
    );
  });

  it('keeps every member within the radius of where its group draws', () => {
    fc.assert(
      fc.property(pins, radius, (given, r) => {
        const at = new Map<string, ScreenPin>(given.map((p) => [p.id, p]));
        for (const group of groupPins(given, r)) {
          for (const id of group.ids) expect(distance(at.get(id)!, group)).toBeLessThan(r);
        }
      }),
    );
  });

  it('draws no two groups closer than the radius, so no markers overlap', () => {
    fc.assert(
      fc.property(pins, radius, (given, r) => {
        const groups = groupPins(given, r);
        for (const [i, a] of groups.entries()) {
          for (const b of groups.slice(i + 1)) {
            expect(distance(a, b)).toBeGreaterThanOrEqual(r);
          }
        }
      }),
    );
  });

  it('keeps the pin seeded first where it is, at the head of its group', () => {
    fc.assert(
      fc.property(
        pins.filter((p) => p.length > 0),
        radius,
        fc.nat(),
        (given, r, pick) => {
          const first = given[pick % given.length];
          const groups = groupPins(given, r, first.id);
          expect(groups[0]).toEqual(expect.objectContaining({ x: first.x, y: first.y }));
          expect(groups[0].ids[0]).toBe(first.id);
          expect(groups.flatMap((g) => g.ids).sort()).toEqual(given.map((p) => p.id).sort());
        },
      ),
    );
  });

  it('groups the same whatever order the pins come in', () => {
    fc.assert(
      fc.property(
        pins.chain((p) =>
          fc.tuple(fc.constant(p), fc.shuffledSubarray(p, { minLength: p.length })),
        ),
        ([given, shuffled]) => {
          expect(groupPins(shuffled)).toEqual(groupPins(given));
        },
      ),
    );
  });

  it('draws any group narrower than the space between groups', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (count) => {
        expect(groupSize(count)).toBeLessThanOrEqual(GROUP_MAX_SIZE);
        expect(groupSize(count)).toBeLessThan(GROUP_RADIUS_PX);
      }),
    );
  });
});

const project: Project = (lat, lng, zoom) => ({ x: lng * 2 ** zoom, y: -lat * 2 ** zoom });
const mapPins = fc.uniqueArray(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 6 }),
    lat: fc.integer({ min: -300, max: 300 }),
    lng: fc.integer({ min: -300, max: 300 }),
    minor: fc.boolean(),
  }),
  { selector: (p) => p.id, maxLength: 40 },
);
const home = fc.record({
  lat: fc.integer({ min: -300, max: 300 }),
  lng: fc.integer({ min: -300, max: 300 }),
});
const zooms = fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }));

describe('drawPins, for any places', () => {
  it('draws home once, where it is, and every place exactly once', () => {
    fc.assert(
      fc.property(mapPins, home, zooms, (given, at, [zoom, deeper]) => {
        const drawn = drawPins(given, at, project, zoom, zoom + deeper);
        const homes = drawn.filter((d) => d.home);
        expect(homes).toHaveLength(1);
        expect(homes[0]).toEqual(expect.objectContaining({ lat: at.lat, lng: at.lng }));
        expect(drawn.flatMap((d) => d.ids).sort()).toEqual(given.map((p) => p.id).sort());
      }),
    );
  });

  it('draws no two markers closer than the radius', () => {
    fc.assert(
      fc.property(mapPins, home, zooms, (given, at, [zoom, deeper]) => {
        const points = drawPins(given, at, project, zoom, zoom + deeper).map((d) =>
          project(d.lat, d.lng, zoom),
        );
        for (const [i, a] of points.entries()) {
          for (const b of points.slice(i + 1)) {
            expect(distance(a, b)).toBeGreaterThanOrEqual(GROUP_RADIUS_PX);
          }
        }
      }),
    );
  });

  it('parts at the deepest zoom any group it says splits', () => {
    fc.assert(
      fc.property(mapPins, home, zooms, (given, at, [zoom, deeper]) => {
        const max = zoom + deeper;
        const deepest = drawPins(given, at, project, max, max);
        // Drawn at the deepest zoom, every group is one that can't part.
        for (const d of deepest) {
          if (d.ids.length + (d.home ? 1 : 0) > 1) expect(d.splits).toBe(false);
        }
      }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { activityPath, isActivityPath, listPosition, readActivityState } from './activityRoute';

// History state comes back from the browser as whatever was stored, and ids
// as whatever the catalog holds: these hold for any of it. Example tests are
// in activityRoute.test.tsx.

describe('activity routes, for any input', () => {
  it('reads any history state without throwing, keeping only well-formed fields', () => {
    fc.assert(
      fc.property(fc.anything(), (state) => {
        const read = readActivityState(state);
        if (read === null) return;
        expect(typeof read.backgroundLocation.pathname).toBe('string');
        expect(typeof read.depth).toBe('number');
        expect(typeof read.cold).toBe('boolean');
        if (read.list !== undefined)
          expect(read.list.every((id) => typeof id === 'string')).toBe(true);
      }),
    );
  });

  it('reads back the state it would have stored', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 1, max: 50 }),
        fc.boolean(),
        fc.array(fc.string()),
        (pathname, depth, cold, list) => {
          const state = {
            backgroundLocation: { pathname, search: '', hash: '', state: null, key: 'k' },
            depth,
            cold,
            list,
          };
          expect(readActivityState(state)).toEqual(state);
        },
      ),
    );
  });

  it('routes any non-empty id to an activity page', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (id) => {
        expect(isActivityPath(activityPath(id))).toBe(true);
      }),
    );
  });

  it('places an id in its list between its true neighbours, or nowhere', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string()), fc.string(), (list, id) => {
        const position = listPosition(list, id);
        if (list.length < 2 || !list.includes(id)) {
          expect(position).toBeNull();
          return;
        }
        expect(position).not.toBeNull();
        const { index, total, prev, next } = position!;
        expect(list[index]).toBe(id);
        expect(total).toBe(list.length);
        expect(prev).toBe(index > 0 ? list[index - 1] : null);
        expect(next).toBe(index < list.length - 1 ? list[index + 1] : null);
      }),
    );
  });
});

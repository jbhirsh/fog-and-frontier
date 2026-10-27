import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TripActivity } from './userTrips';
import { dayOrder, moveWithinDay } from './tripDays';

// A day's times are whatever its members set: shared, missing, at the day's
// edges. Whatever they are, a step moves one place exactly one on. Examples
// are in tripDays.test.ts.

const time = fc.oneof(
  fc.constant(null),
  // A few times, so places often share one, near either end of the day.
  fc.constantFrom('00:00', '00:01', '09:00', '09:01', '12:00', '23:58', '23:59'),
  fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`),
);

function stop(id: string, start_time: string | null): TripActivity {
  return {
    id,
    trip_id: 't',
    activity_id: id,
    added_by_email: 'a@example.com',
    added_at: 0,
    day_index: 0,
    start_time,
    display_order: 0,
    snapshot: null,
  };
}

describe('moveWithinDay, for any day', () => {
  it('moves the place exactly one step, with times inside the day, and nothing else', () => {
    fc.assert(
      fc.property(
        fc.array(time, { minLength: 1, maxLength: 12 }),
        fc.nat(),
        fc.constantFrom<-1 | 1>(-1, 1),
        (times, pick, by) => {
          const day = dayOrder(times.map((t, i) => stop(`p${i}`, t)));
          const index = pick % day.length;
          const changes = moveWithinDay(day, index, by);
          const target = index + by;
          if (target < 0 || target >= day.length) {
            expect(changes).toEqual([]);
            return;
          }
          for (const c of changes) expect(c.start_time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
          expect(new Set(changes.map((c) => c.id)).size).toBe(changes.length);
          const changed = new Map(changes.map((c) => [c.id, c.start_time]));
          const after = dayOrder(
            day.map((s) => ({ ...s, start_time: changed.get(s.id) ?? s.start_time })),
          );
          const expected = day.map((s) => s.id);
          [expected[index], expected[target]] = [expected[target], expected[index]];
          expect(after.map((s) => s.id)).toEqual(expected);
        },
      ),
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { TripActivity } from './userTrips';
import {
  dayName,
  dayOrder,
  moveWithinDay,
  placesCount,
  shortDayLabel,
  timeOfDay,
} from './tripDays';

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

describe('timeOfDay', () => {
  it('splits the day at noon and five', () => {
    expect(timeOfDay('00:00')).toBe('Morning');
    expect(timeOfDay('11:59')).toBe('Morning');
    expect(timeOfDay('12:00')).toBe('Afternoon');
    expect(timeOfDay('16:59')).toBe('Afternoon');
    expect(timeOfDay('17:00')).toBe('Evening');
    expect(timeOfDay('23:45')).toBe('Evening');
  });

  it('says nothing without a time it can read', () => {
    expect(timeOfDay(null)).toBeNull();
    expect(timeOfDay('')).toBeNull();
    expect(timeOfDay('noon')).toBeNull();
  });
});

describe('a day’s names', () => {
  const trip = { start_date: '2026-04-11' };

  it('labels a day’s button by weekday and date', () => {
    expect(shortDayLabel(trip, 0)).toBe('Sat 11');
    expect(shortDayLabel(trip, 1)).toBe('Sun 12');
    expect(shortDayLabel({ start_date: '2026-04-30' }, 1)).toBe('Fri 1');
  });

  it('names a day in full', () => {
    expect(dayName(trip, 0)).toBe('Saturday');
    expect(dayName(trip, 2)).toBe('Monday');
  });

  it('falls back to the day’s number when the dates don’t read', () => {
    expect(shortDayLabel({ start_date: 'soon' }, 1)).toBe('Day 2');
    expect(dayName({ start_date: 'soon' }, 1)).toBe('day 2');
  });

  it('counts the places', () => {
    expect(placesCount(0)).toBe('Nothing yet');
    expect(placesCount(1)).toBe('1 place');
    expect(placesCount(3)).toBe('3 places');
  });
});

describe('moveWithinDay', () => {
  const day = [stop('a', '09:00'), stop('b', '13:00'), stop('c', '18:30')];

  it('swaps a place’s time with its neighbour’s', () => {
    expect(moveWithinDay(day, 1, -1)).toEqual([
      { id: 'b', start_time: '09:00' },
      { id: 'a', start_time: '13:00' },
    ]);
    expect(moveWithinDay(day, 1, 1)).toEqual([
      { id: 'b', start_time: '18:30' },
      { id: 'c', start_time: '13:00' },
    ]);
  });

  it('does nothing past the day’s ends', () => {
    expect(moveWithinDay(day, 0, -1)).toEqual([]);
    expect(moveWithinDay(day, 2, 1)).toEqual([]);
    expect(moveWithinDay([], 0, 1)).toEqual([]);
  });

  it('keeps both inside the day when they share its last minute', () => {
    const late = [stop('a', '23:59'), stop('b', '23:59')];
    // Not 23:59 and 00:00, which would sort the moved place first again.
    expect(moveWithinDay(late, 1, -1)).toEqual([
      { id: 'b', start_time: '23:58' },
      { id: 'a', start_time: '23:59' },
    ]);
    // An untimed place beside one at 23:59 the same way.
    expect(moveWithinDay([stop('a', '23:59'), stop('b', null)], 0, 1)).toEqual([
      { id: 'b', start_time: '23:58' },
      { id: 'a', start_time: '23:59' },
    ]);
  });

  it('times the two a minute apart when they share a time', () => {
    const same = [stop('a', '10:00'), stop('b', '10:00')];
    expect(moveWithinDay(same, 1, -1)).toEqual([
      { id: 'b', start_time: '10:00' },
      { id: 'a', start_time: '10:01' },
    ]);
    expect(moveWithinDay(same, 0, 1)).toEqual([
      { id: 'b', start_time: '10:00' },
      { id: 'a', start_time: '10:01' },
    ]);
  });

  it('times a neighbour with none, so the move holds', () => {
    // As a phone shows it: the untimed last.
    const day = dayOrder([stop('x', null), stop('y', '14:00')]);
    expect(day.map((s) => s.id)).toEqual(['y', 'x']);
    expect(moveWithinDay(day, 1, -1)).toEqual([
      { id: 'x', start_time: '14:00' },
      { id: 'y', start_time: '14:01' },
    ]);
    expect(moveWithinDay(day, 0, 1)).toEqual([
      { id: 'x', start_time: '14:00' },
      { id: 'y', start_time: '14:01' },
    ]);
  });

  it('moves one step past a third place at the same time', () => {
    const tied = [stop('a', '09:00'), stop('b', '09:00'), stop('c', '09:00')];
    // a later: b, a, c. c, still at 09:00, would sort before a at 09:01.
    expect(moveWithinDay(tied, 0, 1)).toEqual([
      { id: 'b', start_time: '09:00' },
      { id: 'a', start_time: '09:01' },
      { id: 'c', start_time: '09:02' },
    ]);
    // c earlier: a, c, b.
    expect(moveWithinDay(tied, 2, -1)).toEqual([
      { id: 'c', start_time: '09:01' },
      { id: 'b', start_time: '09:02' },
    ]);
  });

  it('moves on the next place when the new minute lands on its time', () => {
    const day = [stop('a', '09:00'), stop('b', '09:00'), stop('c', '09:01'), stop('d', '12:00')];
    expect(moveWithinDay(day, 0, 1)).toEqual([
      { id: 'b', start_time: '09:00' },
      { id: 'a', start_time: '09:01' },
      { id: 'c', start_time: '09:02' },
    ]);
  });

  it('times a tied run back from the day’s last minute', () => {
    const late = [stop('a', '23:59'), stop('b', '23:59'), stop('c', '23:59')];
    expect(moveWithinDay(late, 0, 1)).toEqual([
      { id: 'b', start_time: '23:57' },
      { id: 'a', start_time: '23:58' },
    ]);
  });

  it('leaves a later run sharing the day’s last minute as it is', () => {
    // Found by the property: the end's pair was moved on, past 23:59.
    const day = dayOrder([
      stop('p0', '23:59'),
      stop('p1', '00:00'),
      stop('p2', '00:00'),
      stop('p3', '23:59'),
    ]);
    expect(moveWithinDay(day, 0, 1)).toEqual([
      { id: 'p2', start_time: '00:00' },
      { id: 'p1', start_time: '00:01' },
    ]);
  });

  it('keeps the minute it gives the moved one when the day’s end runs back', () => {
    // Found by the property: timing back from 23:59 undid the minute that
    // put the moved one after the place it now follows.
    const day = dayOrder([
      stop('p1', '23:59'),
      stop('p4', '00:00'),
      stop('p6', '00:00'),
      stop('p7', '23:59'),
      stop('p8', null),
    ]);
    expect(day.map((s) => s.id)).toEqual(['p4', 'p6', 'p1', 'p7', 'p8']);
    expect(moveWithinDay(day, 2, -1)).toEqual([
      { id: 'p1', start_time: '00:01' },
      { id: 'p6', start_time: '23:58' },
    ]);
  });

  it('starts from nine when neither has a time', () => {
    const day = [stop('a', null), stop('b', 'soon')];
    expect(moveWithinDay(day, 1, -1)).toEqual([
      { id: 'b', start_time: '09:00' },
      { id: 'a', start_time: '09:01' },
    ]);
  });
});

describe('dayOrder', () => {
  it('orders a day by time, the untimed last, leaving what it was given', () => {
    const day = [stop('c', null), stop('b', '13:00'), stop('a', '08:00')];
    expect(dayOrder(day).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(day.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });
});

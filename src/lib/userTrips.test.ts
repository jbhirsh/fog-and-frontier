import { describe, expect, it } from 'vitest';
import {
  addMinutesToHHMM,
  approxDurationMinutes,
  dayCount,
  defaultStartTimeForDay,
  derivedEndTime,
  formatHHMM,
  parseHHMM,
  type TripActivity,
  type TripActivitySnapshot,
} from './userTrips';

function snapshot(
  overrides: Partial<TripActivitySnapshot> = {},
): TripActivitySnapshot {
  return {
    id: 'a',
    name: 'A',
    shortDescription: '',
    category: 'hiking',
    region: 'sf',
    location: { city: 'SF', coords: { lat: 0, lng: 0 } },
    duration: '2-3 Hours',
    coverImage: '',
    ...overrides,
  };
}

function ta(
  overrides: Partial<TripActivity> = {},
  snapshotOverrides: Partial<TripActivitySnapshot> = {},
): TripActivity {
  return {
    id: 't-a',
    trip_id: 't',
    activity_id: 'a',
    added_by_email: 'o@e.com',
    added_at: 0,
    day_index: 0,
    start_time: '09:00',
    display_order: 0,
    snapshot: snapshot(snapshotOverrides),
    ...overrides,
  };
}

describe('parseHHMM', () => {
  it('parses valid HH:MM strings', () => {
    expect(parseHHMM('00:00')).toEqual({ hours: 0, minutes: 0 });
    expect(parseHHMM('09:30')).toEqual({ hours: 9, minutes: 30 });
    expect(parseHHMM('23:59')).toEqual({ hours: 23, minutes: 59 });
  });

  it('rejects invalid strings', () => {
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('9:30')).toBeNull();
    expect(parseHHMM('not a time')).toBeNull();
    expect(parseHHMM('')).toBeNull();
  });
});

describe('formatHHMM', () => {
  it('formats to 12-hour clock with AM/PM', () => {
    expect(formatHHMM('00:00')).toBe('12:00 AM');
    expect(formatHHMM('09:30')).toBe('9:30 AM');
    expect(formatHHMM('12:00')).toBe('12:00 PM');
    expect(formatHHMM('13:05')).toBe('1:05 PM');
    expect(formatHHMM('23:59')).toBe('11:59 PM');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatHHMM(null)).toBe('');
    expect(formatHHMM(undefined)).toBe('');
  });
});

describe('addMinutesToHHMM', () => {
  it('adds minutes within a day', () => {
    expect(addMinutesToHHMM('09:00', 90)).toBe('10:30');
    expect(addMinutesToHHMM('14:45', 30)).toBe('15:15');
  });

  it('wraps past midnight', () => {
    expect(addMinutesToHHMM('23:30', 60)).toBe('00:30');
  });
});

describe('approxDurationMinutes', () => {
  it('maps each catalog duration', () => {
    expect(approxDurationMinutes(snapshot({ duration: '1-2 Hours' }))).toBe(90);
    expect(approxDurationMinutes(snapshot({ duration: '2-3 Hours' }))).toBe(150);
    expect(approxDurationMinutes(snapshot({ duration: 'Half Day' }))).toBe(240);
    expect(approxDurationMinutes(snapshot({ duration: 'Full Day' }))).toBe(480);
  });

  it('falls back to 60 when snapshot is missing', () => {
    expect(approxDurationMinutes(null)).toBe(60);
  });
});

describe('derivedEndTime', () => {
  it('returns start + approx duration', () => {
    expect(
      derivedEndTime(ta({}, { duration: '2-3 Hours' })),
    ).toBe('11:30');
  });

  it('returns null for unscheduled activities', () => {
    expect(derivedEndTime(ta({ start_time: null }))).toBeNull();
  });
});

describe('dayCount', () => {
  it('counts inclusive days', () => {
    expect(dayCount({ start_date: '2026-03-14', end_date: '2026-03-14' })).toBe(1);
    expect(dayCount({ start_date: '2026-03-14', end_date: '2026-03-16' })).toBe(3);
  });

  it('falls back to 1 for malformed dates', () => {
    expect(dayCount({ start_date: 'bogus', end_date: 'also bogus' })).toBe(1);
  });
});

describe('defaultStartTimeForDay', () => {
  it("defaults to 09:00 when the day is empty", () => {
    expect(defaultStartTimeForDay([])).toBe('09:00');
  });

  it('defaults to 30 min after the latest derived end, rounded to 15 min', () => {
    // 09:00 + 150 min ('2-3 Hours') = 11:30; +30 = 12:00.
    const existing = [ta({}, { duration: '2-3 Hours' })];
    expect(defaultStartTimeForDay(existing)).toBe('12:00');
  });

  it('rounds the 30-min pad to the nearest 15 minutes', () => {
    // start 10:13, duration 60 (other) => end 11:13; +30 = 11:43 => round to 11:45.
    const existing = [
      ta(
        { start_time: '10:13' },
        // Force unknown duration via Multi-Day → 1440 min (out of range), so use 'other' indirectly:
        // We coerce a 60-min default by using a snapshot whose duration triggers the fallback branch.
        // Simulating via a snapshot with an unknown duration is awkward, so we instead use 2-3 Hours
        // (150 min) and verify 10:13 + 150 + 30 = 13:13 → rounded → 13:15.
        { duration: '2-3 Hours' },
      ),
    ];
    expect(defaultStartTimeForDay(existing)).toBe('13:15');
  });

  it('picks the latest end across multiple scheduled activities', () => {
    const existing = [
      ta(
        { start_time: '09:00' },
        { duration: '2-3 Hours' }, // ends 11:30
      ),
      ta(
        { id: 't-b', activity_id: 'b', start_time: '12:00' },
        { duration: '1-2 Hours' }, // ends 13:30
      ),
      ta(
        { id: 't-c', activity_id: 'c', start_time: '10:00' },
        { duration: '1-2 Hours' }, // ends 11:30
      ),
    ];
    // Latest end is 13:30 → +30 = 14:00.
    expect(defaultStartTimeForDay(existing)).toBe('14:00');
  });

  it('ignores unscheduled activities', () => {
    const existing = [
      ta({ start_time: null, day_index: null }),
    ];
    expect(defaultStartTimeForDay(existing)).toBe('09:00');
  });

  it('caps the start time at 23:45', () => {
    const existing = [ta({ start_time: '23:00' }, { duration: 'Full Day' })];
    expect(defaultStartTimeForDay(existing)).toBe('23:45');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildActivitiesCsv,
  csvEscape,
  csvFilename,
  isUserActivity,
} from './exportCsv';
import type { Activity } from '../data/types';
import { activities as STATIC_ACTIVITIES } from '../data/activities';

describe('csvEscape', () => {
  it('returns plain strings unchanged', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape('mountain view')).toBe('mountain view');
  });

  it('quotes fields containing a comma', () => {
    expect(csvEscape('a, b')).toBe('"a, b"');
  });

  it('quotes and escapes embedded double quotes', () => {
    expect(csvEscape('she said "hi"')).toBe('"she said ""hi"""');
  });

  it('quotes fields containing a newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('returns empty string for undefined and null', () => {
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape(null)).toBe('');
  });

  it('stringifies numbers and booleans without quoting', () => {
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(false)).toBe('false');
  });
});

describe('isUserActivity', () => {
  it('returns false for ids present in the static seed', () => {
    const someStaticId = STATIC_ACTIVITIES[0]?.id;
    expect(someStaticId).toBeTruthy();
    expect(isUserActivity(someStaticId ?? '')).toBe(false);
  });

  it('returns true for ids not in the static seed', () => {
    expect(isUserActivity('user-added-id-zzz-not-in-seed')).toBe(true);
  });
});

describe('csvFilename', () => {
  it('uses local YYYY-MM-DD with zero-padding', () => {
    // Construct via local-time fields so the assertion is timezone-stable.
    const d = new Date(2026, 0, 5); // 2026-01-05 local
    expect(csvFilename(d)).toBe('fog-and-frontier-activities-2026-01-05.csv');
  });
});

describe('buildActivitiesCsv', () => {
  const base: Activity = {
    id: 'test-csv-1',
    name: 'Simple',
    shortDescription: 'short',
    category: 'hiking',
    region: 'sf',
    location: { city: 'SF', coords: { lat: 37.77, lng: -122.42 } },
    duration: 'Half Day',
    coverImage: 'https://example.com/c.jpg',
  };

  it('emits header in the documented column order', () => {
    const csv = buildActivitiesCsv([]);
    const [header] = csv.split('\n');
    expect(header).toBe(
      'id,name,shortDescription,longDescription,category,region,city,lat,lng,duration,durationDetail,difficulty,dogFriendly,coverImage,galleryImages,allTrailsUrl,allTrailsRating,hikeDistanceMiles,hikeElevationFeet,completed,completedDate,notes,source',
    );
  });

  it('renders missing optionals as empty strings (no literal "undefined")', () => {
    const csv = buildActivitiesCsv([base]);
    const lines = csv.split('\n');
    expect(lines[1]).toContain(',,'); // adjacent empty optionals
    expect(csv).not.toMatch(/undefined/);
  });

  it('renders boolean false explicitly (not as empty)', () => {
    const a: Activity = { ...base, dogFriendly: false };
    const csv = buildActivitiesCsv([a]);
    const cells = csv.split('\n')[1]?.split(',') ?? [];
    // dogFriendly is column index 12 (0-based).
    expect(cells[12]).toBe('false');
  });

  it('joins galleryImages with the pipe character', () => {
    const a: Activity = {
      ...base,
      galleryImages: ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg'],
    };
    const csv = buildActivitiesCsv([a]);
    expect(csv).toContain('https://x/1.jpg|https://x/2.jpg|https://x/3.jpg');
  });

  it('quotes and round-trips a notes field containing comma, quote, and newline', () => {
    const a: Activity = {
      ...base,
      notes: 'has, a "tricky"\nfield',
    };
    const csv = buildActivitiesCsv([a]);
    expect(csv).toContain('"has, a ""tricky""\nfield"');
  });

  it('marks unseeded ids as source=user and seeded ids as source=static', () => {
    const seeded = STATIC_ACTIVITIES[0];
    expect(seeded).toBeTruthy();
    if (!seeded) return;
    const userAdded: Activity = { ...base, id: 'definitely-not-in-seed-xyz' };
    const csv = buildActivitiesCsv([seeded, userAdded]);
    const [, seededRow, userRow] = csv.split('\n');
    expect(seededRow?.endsWith(',static')).toBe(true);
    expect(userRow?.endsWith(',user')).toBe(true);
  });
});

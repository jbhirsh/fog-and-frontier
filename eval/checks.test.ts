// Unit tests for the pure graders in eval/checks.ts. Focused on the regression
// surface flagged in the #123 review: the date-window logic (DST fall-back,
// Sunday-weekend extension, ±1-day slack), classifyGeminiError's infra-vs-
// quality triage, the required-field grading (now driven by the resolver's
// exported ACTIVITY_REQUIRED_FIELDS), and coordinate-tolerance checks.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { badGateway, badInput, notFound } from '../api/_gqlError.js';
import {
  checkDiscoverStructural,
  checkGenerateHappy,
  classifyGeminiError,
  haversineKm,
} from './checks.js';
import type { CheckResult, DiscoverExpect, DiscoverRange } from './types.js';

// --- helpers -----------------------------------------------------------------

// Wide structural bounds so only the date-window check is under test.
const DISCOVER_EXPECT: DiscoverExpect = {
  structural: { minEvents: 0, maxEvents: 99, minFieldCoverage: 0 },
  datesWithinRange: true,
  dedupe: false,
  judgeEvents: { minPlausibleFraction: 0.8 },
};

interface TestEvent {
  startDate?: string;
  endDate?: string;
}

function dateWindow(
  events: TestEvent[],
  range: DiscoverRange,
  now: Date,
): CheckResult {
  const results = checkDiscoverStructural({ events }, DISCOVER_EXPECT, range, now);
  const check = results.find((c) => c.name === 'structural:date-window');
  if (!check) throw new Error('structural:date-window check missing');
  return check;
}

// Local noon on a calendar day: windowFor reads local accessors
// (getFullYear/getMonth/getDate/getDay), so noon pins the intended day in any
// timezone. m1 is 1-based.
function localNoon(y: number, m1: number, d: number): Date {
  return new Date(y, m1 - 1, d, 12, 0, 0);
}

function activityRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: 'Castle Rock Loop',
    shortDescription: 'short',
    longDescription: 'long',
    category: 'hiking',
    region: 'south-bay',
    city: 'Los Gatos',
    lat: 37.2309,
    lng: -122.0961,
    duration: '1-2 Hours',
    difficulty: 'moderate',
    dogFriendly: false,
    ...overrides,
  };
}

function findCheck(results: CheckResult[], name: string): CheckResult {
  const check = results.find((c) => c.name === name);
  if (!check) throw new Error(`${name} check missing`);
  return check;
}

// --- date-window -------------------------------------------------------------

describe('checkDateWindow (via checkDiscoverStructural)', () => {
  it('weekend from a mid-week day runs through the upcoming Sunday, with ±1-day slack', () => {
    const wednesday = localNoon(2026, 7, 15); // window 07-15..07-19 (Sun)
    expect(dateWindow([{ startDate: '2026-07-18' }], 'weekend', wednesday).status).toBe('pass');
    // 07-20 is end+1 — inside the slack.
    expect(dateWindow([{ startDate: '2026-07-20' }], 'weekend', wednesday).status).toBe('pass');
    expect(dateWindow([{ startDate: '2026-07-21' }], 'weekend', wednesday).status).toBe('fail');
  });

  it('on a Sunday the weekend window extends through the NEXT weekend', () => {
    const sunday = localNoon(2026, 7, 19); // window 07-19..07-26
    // Next Saturday: would be outside a collapsed single-day window.
    expect(dateWindow([{ startDate: '2026-07-25' }], 'weekend', sunday).status).toBe('pass');
    expect(dateWindow([{ startDate: '2026-07-28' }], 'weekend', sunday).status).toBe('fail');
  });

  it("'today' is a single-day window (plus slack)", () => {
    const now = localNoon(2026, 7, 15);
    expect(dateWindow([{ startDate: '2026-07-15' }], 'today', now).status).toBe('pass');
    expect(dateWindow([{ startDate: '2026-07-16' }], 'today', now).status).toBe('pass');
    expect(dateWindow([{ startDate: '2026-07-17' }], 'today', now).status).toBe('fail');
  });

  it('a multi-day event overlapping only the window edge passes', () => {
    const now = localNoon(2026, 7, 15);
    const festival = { startDate: '2026-07-10', endDate: '2026-07-16' };
    expect(dateWindow([festival], 'weekend', now).status).toBe('pass');
  });

  it('events without parseable dates are left to the iso-dates check', () => {
    const now = localNoon(2026, 7, 15);
    const result = dateWindow([{ startDate: 'next Tuesday' }, {}], 'weekend', now);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('no events with valid dates');
  });

  describe('across the DST fall-back (America/Los_Angeles, Nov 1 2026)', () => {
    const originalTz = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'America/Los_Angeles';
    });
    afterAll(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it("a 'week' window spanning the transition stays exactly 7 calendar days", () => {
      const friday = localNoon(2026, 10, 30); // window 10-30..11-06, DST ends 11-01
      const inWindow = dateWindow([{ startDate: '2026-11-06' }], 'week', friday);
      expect(inWindow.status).toBe('pass');
      // Pin the computed bounds: ms-based day arithmetic would drift an hour
      // across the fall-back and rot the window edge by a day.
      expect(inWindow.detail).toContain('2026-10-30..2026-11-06');
      expect(dateWindow([{ startDate: '2026-11-07' }], 'week', friday).status).toBe('pass'); // end+1 slack
      expect(dateWindow([{ startDate: '2026-11-08' }], 'week', friday).status).toBe('fail');
    });
  });
});

// --- classifyGeminiError -------------------------------------------------------

describe('classifyGeminiError', () => {
  it('treats non-GraphQLError throws (timeouts, transport) as infrastructure', () => {
    expect(classifyGeminiError(new Error('case timed out after 90000ms'))).toEqual({
      code: 'OTHER',
      infra: true,
      message: 'case timed out after 90000ms',
    });
    expect(classifyGeminiError('fetch failed')).toEqual({
      code: 'OTHER',
      infra: true,
      message: 'fetch failed',
    });
  });

  it('treats the two resolver transport messages as infra even though they are BAD_GATEWAY', () => {
    expect(classifyGeminiError(badGateway('gemini request failed'))).toEqual({
      code: 'BAD_GATEWAY',
      infra: true,
      message: 'gemini request failed',
    });
    expect(classifyGeminiError(badGateway('lookup failed')).infra).toBe(true);
  });

  it('treats other BAD_GATEWAY messages as gradeable model behavior', () => {
    expect(classifyGeminiError(badGateway('gemini returned non-JSON'))).toEqual({
      code: 'BAD_GATEWAY',
      infra: false,
      message: 'gemini returned non-JSON',
    });
  });

  it('classifies BAD_USER_INPUT as a graceful, gradeable rejection', () => {
    expect(classifyGeminiError(badInput('title is required'))).toEqual({
      code: 'BAD_USER_INPUT',
      infra: false,
      message: 'title is required',
    });
  });

  it('maps unrecognized GraphQLError codes to OTHER without the infra flag', () => {
    expect(classifyGeminiError(notFound('no such thing'))).toEqual({
      code: 'OTHER',
      infra: false,
      message: 'no such thing',
    });
  });
});

// --- required fields (list imported from the resolver) ------------------------

describe('schema:required (via checkGenerateHappy)', () => {
  it('passes a record carrying every required field with the right type', () => {
    const results = checkGenerateHappy({ activity: activityRecord() }, {});
    expect(findCheck(results, 'schema:required').status).toBe('pass');
  });

  it('fails when a required field is missing or mistyped', () => {
    const missing = checkGenerateHappy(
      { activity: activityRecord({ dogFriendly: undefined }) },
      {},
    );
    const missingCheck = findCheck(missing, 'schema:required');
    expect(missingCheck.status).toBe('fail');
    expect(missingCheck.detail).toContain('dogFriendly missing');

    const mistyped = checkGenerateHappy(
      { activity: activityRecord({ lat: '37.23' }) },
      {},
    );
    const mistypedCheck = findCheck(mistyped, 'schema:required');
    expect(mistypedCheck.status).toBe('fail');
    expect(mistypedCheck.detail).toContain('lat expected number, got string');
  });
});

// --- coordinate tolerance ------------------------------------------------------

describe('coordinate tolerance', () => {
  const SF = { lat: 37.7749, lng: -122.4194 };
  const LA = { lat: 34.0522, lng: -118.2437 };

  it('haversineKm matches known distances', () => {
    expect(haversineKm(SF, SF)).toBe(0);
    // SF ↔ LA great-circle distance ≈ 559 km.
    expect(haversineKm(SF, LA)).toBeCloseTo(559, -1);
    expect(haversineKm(SF, LA)).toBe(haversineKm(LA, SF));
  });

  function geoCheck(overrides: Record<string, unknown>, toleranceKm: number): CheckResult {
    const results = checkGenerateHappy(
      { activity: activityRecord(overrides) },
      { geo: { lat: 37.2309, lng: -122.0961, toleranceKm } },
    );
    return findCheck(results, 'expect:geo');
  }

  it('passes coordinates within the tolerance radius', () => {
    expect(geoCheck({}, 5).status).toBe('pass');
    // ~0.01° of latitude ≈ 1.1 km — inside a 5 km tolerance.
    expect(geoCheck({ lat: 37.2409 }, 5).status).toBe('pass');
  });

  it('fails coordinates beyond the tolerance radius', () => {
    // A full degree of latitude ≈ 111 km.
    const result = geoCheck({ lat: 38.2309 }, 5);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('exceeds tolerance');
  });

  it('fails missing or non-numeric coordinates instead of throwing', () => {
    expect(geoCheck({ lat: undefined }, 5).status).toBe('fail');
    expect(geoCheck({ lng: 'far away' }, 5).status).toBe('fail');
  });
});

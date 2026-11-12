// The graders checks.test.ts doesn't reach: generateActivity's expectations
// and graceful path, the AllTrails lookup, and discover's structural checks.
import { describe, expect, it } from 'vitest';
import { badGateway, badInput, notFound } from '../api/_gqlError.js';
import {
  checkAlltrails,
  checkDiscoverStructural,
  checkGenerateGraceful,
  checkGenerateHappy,
} from './checks.js';
import type { CheckResult, DiscoverExpect, ResolverOutcome } from './types.js';

const activity = (overrides: Record<string, unknown> = {}) => ({
  activity: {
    name: 'Duarte’s Tavern',
    shortDescription: 'short',
    longDescription: 'long',
    category: 'food',
    region: 'peninsula',
    city: 'Pescadero',
    lat: 37.2552,
    lng: -122.3829,
    duration: '1-2 Hours',
    difficulty: 'easy',
    dogFriendly: false,
    cardLine: 'Artichoke soup and olallieberry pie since 1894.',
    cuisine: 'American',
    priceRange: '$$',
    ...overrides,
  },
});
const byName = (results: CheckResult[]) =>
  Object.fromEntries(results.map((r) => [r.name, [r.status, r.detail]]));
const ok = (value: unknown): ResolverOutcome => ({ ok: true, value });
const threw = (error: unknown): ResolverOutcome => ({ ok: false, error });

describe('checkGenerateHappy', () => {
  it('grades each expected value, the city case-insensitively', () => {
    const checks = byName(
      checkGenerateHappy(activity(), {
        category: ['food'],
        region: ['coast'],
        parkType: ['state'],
        duration: ['1-2 Hours'],
        city: [' pescadero '],
        restaurantFields: true,
      }),
    );
    expect(checks['expect:category']).toEqual(['pass', 'category=food']);
    expect(checks['expect:region']).toEqual(['fail', 'region=peninsula, expected one of [coast]']);
    expect(checks['expect:parkType']).toEqual([
      'fail',
      'parkType missing or non-string; expected one of [state]',
    ]);
    expect(checks['expect:duration']?.[0]).toBe('pass');
    expect(checks['expect:city']).toEqual(['pass', 'city=Pescadero']);
    expect(checks['expect:restaurant-fields']).toEqual(['pass', 'cuisine and priceRange present']);
  });

  it('fails another city, a missing one, and a restaurant without its fields', () => {
    const other = byName(
      checkGenerateHappy(activity({ city: 'Oakland' }), { city: ['Pescadero'] }),
    );
    expect(other['expect:city']).toEqual(['fail', 'city=Oakland, expected one of [Pescadero]']);
    const none = byName(checkGenerateHappy(activity({ city: 3 }), { city: ['Pescadero'] }));
    expect(none['expect:city']?.[1]).toBe(
      'city missing or non-string; expected one of [Pescadero]',
    );
    const bare = byName(
      checkGenerateHappy(activity({ cuisine: ' ', priceRange: undefined }), {
        restaurantFields: true,
      }),
    );
    expect(bare['expect:restaurant-fields']).toEqual(['fail', 'missing: cuisine, priceRange']);
  });

  it('fails an enum value that is not a string, a non-finite number, and a missing activity', () => {
    const checks = byName(checkGenerateHappy(activity({ difficulty: 2, lat: Infinity }), {}));
    expect(checks['schema:enums']?.[1]).toContain('difficulty=2 is not a string');
    expect(checks['schema:required']?.[1]).toContain('lat is not a finite number');
    expect(checkGenerateHappy({ activity: 'x' }, {})).toEqual([
      {
        name: 'schema:required',
        status: 'fail',
        detail: 'resolver output was not shaped { activity: object }',
      },
    ]);
    expect(checkGenerateHappy(null, {})[0]?.status).toBe('fail');
  });
});

describe('checkGenerateGraceful', () => {
  const graceful = (
    ifReturned: null | { geo?: { lat: number; lng: number; toleranceKm: number } },
  ) => ({
    graceful: { allowedErrors: ['BAD_USER_INPUT' as const], ifReturned },
  });

  it('passes an allowed rejection, fails any other, and leaves infrastructure ungraded', () => {
    expect(
      byName(checkGenerateGraceful(threw(badInput('nonsense title')), graceful(null))),
    ).toEqual({
      'graceful:error': ['pass', 'rejected with BAD_USER_INPUT: nonsense title'],
    });
    expect(
      byName(checkGenerateGraceful(threw(badGateway('parse failed')), graceful(null))),
    ).toEqual({
      'graceful:error': [
        'fail',
        'error code BAD_GATEWAY (parse failed) not in allowed [BAD_USER_INPUT]',
      ],
    });
    expect(checkGenerateGraceful(threw(notFound()), graceful(null))[0]?.status).toBe('fail');
    expect(checkGenerateGraceful(threw(new Error('timed out')), graceful(null))[0]).toEqual({
      name: 'graceful:error',
      status: 'error',
      detail: 'infrastructure failure, not gradeable: timed out',
    });
  });

  it('fails any record for input that should have none', () => {
    expect(checkGenerateGraceful(ok(activity()), graceful(null))[0]?.name).toBe(
      'graceful:no-fabrication',
    );
  });

  it("holds a record it may return to honest coordinates, and to the record's shape", () => {
    const far = { lat: 35.6762, lng: 139.6503, toleranceKm: 50 };
    const checks = byName(checkGenerateGraceful(ok(activity()), graceful({ geo: far })));
    expect(checks['schema:enums']?.[0]).toBe('pass');
    expect(checks['expect:geo']?.[0]).toBe('fail');
    expect(checkGenerateGraceful(ok(activity()), graceful({}))).toHaveLength(1);
    expect(checkGenerateGraceful(ok({}), graceful({}))[0]?.name).toBe('graceful:shape');
  });
});

describe('checkAlltrails', () => {
  const ranges = {
    lookup: {
      allTrailsRating: { min: 4, max: 5 },
      hikeDistanceMiles: { min: 2, nullable: true },
      hikeElevationFeet: { max: 1000 },
    },
  };

  it('holds each specified field to its range', () => {
    const checks = byName(
      checkAlltrails(
        ok({ lookup: { allTrailsRating: 4.6, hikeDistanceMiles: null, hikeElevationFeet: 1200 } }),
        ranges,
      ),
    );
    expect(checks).toEqual({
      'alltrails:allTrailsRating': ['pass', '4.6 within [4, 5]'],
      'alltrails:hikeDistanceMiles': ['pass', 'null (allowed)'],
      'alltrails:hikeElevationFeet': ['fail', '1200 above max 1000'],
    });
    const low = byName(
      checkAlltrails(
        ok({ lookup: { allTrailsRating: 3, hikeDistanceMiles: '2', hikeElevationFeet: null } }),
        ranges,
      ),
    );
    expect(low).toEqual({
      'alltrails:allTrailsRating': ['fail', '3 below min 4'],
      'alltrails:hikeDistanceMiles': ['fail', 'expected a number, got "2"'],
      'alltrails:hikeElevationFeet': ['fail', 'expected a number in [-inf, 1000], got null'],
    });
    const open = checkAlltrails(ok({ lookup: { allTrailsRating: 9 } }), {
      lookup: { allTrailsRating: {} },
    });
    expect(open[0]?.detail).toBe('9 within [-inf, +inf]');
  });

  it('fails a throw or a bad shape where a lookup was expected, unless infrastructure', () => {
    expect(checkAlltrails(threw(badInput('no such trail')), ranges)[0]).toEqual({
      name: 'alltrails:ranges',
      status: 'fail',
      detail: 'expected a numeric lookup, but resolver threw BAD_USER_INPUT: no such trail',
    });
    expect(checkAlltrails(threw(badGateway('lookup failed')), ranges)[0]?.status).toBe('error');
    expect(checkAlltrails(ok({ lookup: null }), ranges)[0]?.detail).toBe(
      'resolver output was not shaped { lookup: object }',
    );
  });

  it('passes an unknown trail that comes back all null, or is rejected gracefully', () => {
    const allNull = { graceful: { allNull: true as const } };
    expect(
      checkAlltrails(
        ok({ lookup: { allTrailsRating: null, hikeDistanceMiles: null, hikeElevationFeet: null } }),
        allNull,
      )[0]?.status,
    ).toBe('pass');
    expect(checkAlltrails(ok({ lookup: { allTrailsRating: 4.2 } }), allNull)[0]?.detail).toBe(
      'expected all fields null, got allTrailsRating=4.2',
    );
    expect(checkAlltrails(threw(badInput('unknown trail')), allNull)[0]?.detail).toBe(
      'rejected gracefully with BAD_USER_INPUT: unknown trail',
    );
  });

  it('holds a graceful rejection to the allowed codes, and fails anything ungraceful', () => {
    const allowed = { graceful: { allowedErrors: ['BAD_USER_INPUT' as const] } };
    expect(checkAlltrails(threw(badGateway('parse failed')), allowed)[0]?.detail).toBe(
      'error code BAD_GATEWAY (parse failed) not in allowed [BAD_USER_INPUT]',
    );
    expect(checkAlltrails(threw(notFound('gone')), allowed)[0]?.detail).toBe(
      'unexpected non-graceful error: gone',
    );
    expect(checkAlltrails(threw(new Error('fetch failed')), allowed)[0]?.status).toBe('error');
    expect(checkAlltrails(ok({ lookup: {} }), allowed)[0]?.detail).toBe(
      'expected a graceful error, but the resolver returned a lookup',
    );
    expect(checkAlltrails(ok('nope'), allowed)[0]?.detail).toBe(
      'resolver output was not shaped { lookup: object }',
    );
  });
});

describe('checkDiscoverStructural', () => {
  const expectAll: DiscoverExpect = {
    structural: { minEvents: 2, maxEvents: 3, minFieldCoverage: 0.75 },
    datesWithinRange: true,
    dedupe: true,
    judgeEvents: { minPlausibleFraction: 0.8 },
  };
  const now = new Date(2026, 6, 15, 12); // a Wednesday
  const event = (overrides: Record<string, unknown> = {}) => ({
    name: 'Farmers Market',
    startDate: '2026-07-15',
    sourceUrl: 'https://market.example/july',
    ...overrides,
  });

  it('passes well-formed, distinct, in-window events', () => {
    const checks = byName(
      checkDiscoverStructural(
        { events: [event(), event({ name: 'Jazz Night', startDate: '2026-07-16' })] },
        expectAll,
        'week',
        now,
      ),
    );
    expect(Object.values(checks).every(([status]) => status === 'pass')).toBe(true);
    expect(checks['structural:date-window']?.[1]).toBe(
      'all 2 dated events overlap 2026-07-15..2026-07-22 (±1d)',
    );
  });

  it('fails too many events, thin fields, bad dates and urls, and duplicate names', () => {
    const checks = byName(
      checkDiscoverStructural(
        {
          events: [
            event(),
            event({ name: 'farmers   market!', sourceUrl: 'ftp://x' }),
            event({ name: '...', startDate: '2026-02-30', sourceUrl: 'not a url' }),
            event({ name: '', sourceUrl: 'https://vertexaisearch.cloud.google.com/r/1' }),
            null,
          ],
        },
        expectAll,
        'tomorrow',
        now,
      ),
    );
    expect(checks['structural:count']).toEqual(['fail', '5 events, expected 2-3']);
    expect(checks['structural:field-coverage']).toEqual(['fail', '3/5 (60%) < 75%']);
    expect(checks['structural:iso-dates']).toEqual(['fail', 'event[2].startDate="2026-02-30"']);
    expect(checks['structural:source-urls']).toEqual([
      'fail',
      'invalid url(s): event[1].sourceUrl="ftp://x"; event[2].sourceUrl="not a url" (1 grounding-redirect host(s): event[3])',
    ]);
    expect(checks['structural:dedupe']).toEqual(['fail', 'duplicate name(s): farmers   market!']);
  });

  it('notes grounding redirects, and grades none of an empty list but its count', () => {
    const redirect = byName(
      checkDiscoverStructural(
        {
          events: [
            event({ sourceUrl: 'https://vertexaisearch.cloud.google.com/r/1' }),
            event({ name: 'Other' }),
          ],
        },
        expectAll,
        'week',
        now,
      ),
    );
    expect(redirect['structural:source-urls']).toEqual([
      'pass',
      'all present sourceUrls are http(s) (1 grounding-redirect host(s): event[0])',
    ]);
    const empty = byName(checkDiscoverStructural({ events: [] }, expectAll, 'week', now));
    expect(empty['structural:field-coverage']).toEqual(['fail', '0/0 (0%) < 75%']);
    expect(empty['structural:date-window']).toEqual([
      'pass',
      'no events with valid dates to grade',
    ]);
  });

  it('skips the window and duplicate checks when the case turns them off', () => {
    const checks = byName(
      checkDiscoverStructural(
        { events: [event()] },
        { ...expectAll, datesWithinRange: false, dedupe: false },
        'week',
        now,
      ),
    );
    expect(checks['structural:date-window']?.[0]).toBe('skipped');
    expect(checks['structural:dedupe']?.[0]).toBe('skipped');
  });

  it('fails output with no events list', () => {
    expect(checkDiscoverStructural({ events: 'none' }, expectAll, 'week', now)).toEqual([
      {
        name: 'structural:shape',
        status: 'fail',
        detail: 'resolver output was not shaped { events: [...] }',
      },
    ]);
    expect(checkDiscoverStructural(undefined, expectAll, 'week', now)[0]?.status).toBe('fail');
  });
});

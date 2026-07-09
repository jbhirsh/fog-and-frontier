// Mechanical graders for the Gemini output-quality eval harness (issue #122).
//
// Pure functions only — no network, fs, timers, or side effects. Every resolver
// return is treated as `unknown` and narrowed defensively: malformed model
// output must produce a FAILED check, never a thrown exception. The
// LLM-as-judge checks live in eval/judge.ts; the runner stitches the two.
//
// Date arithmetic is done in local time (process runs under
// TZ=America/Los_Angeles) via getFullYear/getMonth/getDate — never UTC accessor
// methods on `now`. Calendar days are mapped to a UTC-based integer index so
// slack arithmetic is DST-proof.

import { GraphQLError } from 'graphql';
import {
  ACTIVITY_REQUIRED_FIELDS,
  CATEGORY_VALUES,
  REGION_VALUES,
  PARK_TYPE_VALUES,
  DURATION_VALUES,
  DIFFICULTY_VALUES,
  PRICE_RANGE_VALUES,
} from '../api/_resolvers/gemini.js';
import type {
  AlltrailsExpect,
  AlltrailsGracefulExpect,
  AlltrailsRangesExpect,
  CheckResult,
  DiscoverExpect,
  DiscoverRange,
  GenerateGracefulExpect,
  GenerateHappyExpect,
  GeoExpectation,
  GracefulErrorCode,
  NumericRange,
  ResolverOutcome,
} from './types.js';

// --- result constructors ---------------------------------------------------

function pass(name: string, detail = ''): CheckResult {
  return { name, status: 'pass', detail };
}

function fail(name: string, detail: string): CheckResult {
  return { name, status: 'fail', detail };
}

// Reserved for infrastructure failures: excluded from the score denominator so
// transport flake can't fail CI while quality failures still do.
function errored(name: string, detail: string): CheckResult {
  return { name, status: 'error', detail };
}

function skipped(name: string, detail: string): CheckResult {
  return { name, status: 'skipped', detail };
}

// --- geo --------------------------------------------------------------------

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371; // mean Earth radius, km
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- error classification ---------------------------------------------------

// Triage a thrown resolver error by the exact production message + Apollo code
// (see api/_resolvers/gemini.ts + api/_gqlError.ts). `infra: true` marks a
// transport failure (Gemini unreachable) — NOT a signal that the model behaved,
// so it is never a graceful pass. Quality failures (non-JSON, missing fields,
// empty response) share the BAD_GATEWAY code but are gradeable model behavior.
export function classifyGeminiError(err: unknown): {
  code: GracefulErrorCode | 'OTHER';
  infra: boolean;
  message: string;
} {
  // Every QUALITY failure the resolvers can signal is wrapped in a
  // GraphQLError (badGateway/badInput). A non-GraphQLError can only be the
  // runner's per-case timeout, a raw transport rejection ("fetch failed"), or
  // an unreachable config error — all infrastructure, never model behavior.
  // Classified here so graceful/alltrails paths triage identically to the
  // happy-path gate (a timed-out adversarial case must not score as a quality
  // fail, nor xfail-promote into a pass).
  if (!(err instanceof GraphQLError)) {
    const message = err instanceof Error ? err.message : String(err);
    return { code: 'OTHER', infra: true, message };
  }
  const message = err.message;
  // The only two transport messages the resolvers throw; both are BAD_GATEWAY
  // but mean the upstream call itself failed, not that the model misbehaved.
  if (message === 'gemini request failed' || message === 'lookup failed') {
    return { code: 'BAD_GATEWAY', infra: true, message };
  }
  const rawCode = err.extensions?.code;
  if (rawCode === 'BAD_GATEWAY') {
    return { code: 'BAD_GATEWAY', infra: false, message };
  }
  if (rawCode === 'BAD_USER_INPUT') {
    return { code: 'BAD_USER_INPUT', infra: false, message };
  }
  return { code: 'OTHER', infra: false, message };
}

// --- generateActivity: shared schema graders --------------------------------

// The field list is ACTIVITY_SCHEMA.required, imported from the resolver like
// the enum value sets below (shared source of truth, no hand-copied drift).
// Only the runtime type each field must carry is decided here: lat/lng are
// numbers, dogFriendly a boolean, everything else a string.
type RequiredFieldType = 'string' | 'number' | 'boolean';

function requiredFieldType(field: string): RequiredFieldType {
  if (field === 'lat' || field === 'lng') return 'number';
  if (field === 'dogFriendly') return 'boolean';
  return 'string';
}

const REQUIRED_ACTIVITY_FIELDS: {
  field: string;
  type: RequiredFieldType;
}[] = ACTIVITY_REQUIRED_FIELDS.map((field) => ({
  field,
  type: requiredFieldType(field),
}));

const ENUM_ACTIVITY_FIELDS: { field: string; values: readonly string[] }[] = [
  { field: 'category', values: CATEGORY_VALUES },
  { field: 'region', values: REGION_VALUES },
  { field: 'parkType', values: PARK_TYPE_VALUES },
  { field: 'duration', values: DURATION_VALUES },
  { field: 'difficulty', values: DIFFICULTY_VALUES },
  { field: 'priceRange', values: PRICE_RANGE_VALUES },
];

function asActivity(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const activity = (value as Record<string, unknown>).activity;
  if (!activity || typeof activity !== 'object') return null;
  return activity as Record<string, unknown>;
}

function checkRequired(activity: Record<string, unknown>): CheckResult {
  const problems: string[] = [];
  for (const { field, type } of REQUIRED_ACTIVITY_FIELDS) {
    const v = activity[field];
    if (v === undefined || v === null) {
      problems.push(`${field} missing`);
    } else if (typeof v !== type) {
      problems.push(`${field} expected ${type}, got ${typeof v}`);
    } else if (type === 'number' && !Number.isFinite(v)) {
      problems.push(`${field} is not a finite number`);
    }
  }
  return problems.length === 0
    ? pass('schema:required', 'all required fields present with correct types')
    : fail('schema:required', problems.join('; '));
}

// Enum-typed fields that are PRESENT must carry a legal value. Absent optional
// enum fields (parkType/priceRange omitted) are not graded here.
function checkEnums(activity: Record<string, unknown>): CheckResult {
  const problems: string[] = [];
  for (const { field, values } of ENUM_ACTIVITY_FIELDS) {
    const v = activity[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') {
      problems.push(`${field}=${JSON.stringify(v)} is not a string`);
    } else if (!values.includes(v)) {
      problems.push(`${field}=${JSON.stringify(v)} not in [${values.join(', ')}]`);
    }
  }
  return problems.length === 0
    ? pass('schema:enums', 'all present enum fields legal')
    : fail('schema:enums', problems.join('; '));
}

function checkValueExpectation(
  name: string,
  activity: Record<string, unknown>,
  field: string,
  accept: string[],
): CheckResult {
  const v = activity[field];
  if (typeof v !== 'string') {
    return fail(
      name,
      `${field} missing or non-string; expected one of [${accept.join(', ')}]`,
    );
  }
  return accept.includes(v)
    ? pass(name, `${field}=${v}`)
    : fail(name, `${field}=${v}, expected one of [${accept.join(', ')}]`);
}

function checkCity(
  activity: Record<string, unknown>,
  accept: string[],
): CheckResult {
  const v = activity.city;
  if (typeof v !== 'string') {
    return fail(
      'expect:city',
      `city missing or non-string; expected one of [${accept.join(', ')}]`,
    );
  }
  const norm = v.trim().toLowerCase();
  const match = accept.some((c) => c.trim().toLowerCase() === norm);
  return match
    ? pass('expect:city', `city=${v}`)
    : fail('expect:city', `city=${v}, expected one of [${accept.join(', ')}]`);
}

function checkGeo(
  name: string,
  activity: Record<string, unknown>,
  geo: GeoExpectation,
): CheckResult {
  const lat = activity.lat;
  const lng = activity.lng;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return fail(
      name,
      `lat/lng missing or non-numeric (lat=${JSON.stringify(lat)}, lng=${JSON.stringify(lng)})`,
    );
  }
  const km = haversineKm({ lat, lng }, { lat: geo.lat, lng: geo.lng });
  return km <= geo.toleranceKm
    ? pass(name, `${round2(km)} km from expected (≤ ${geo.toleranceKm} km)`)
    : fail(
        name,
        `${round2(km)} km from expected, exceeds tolerance ${geo.toleranceKm} km`,
      );
}

function checkRestaurantFields(activity: Record<string, unknown>): CheckResult {
  const missing: string[] = [];
  const cuisine = activity.cuisine;
  const priceRange = activity.priceRange;
  if (typeof cuisine !== 'string' || cuisine.trim() === '') missing.push('cuisine');
  if (typeof priceRange !== 'string' || priceRange.trim() === '') {
    missing.push('priceRange');
  }
  return missing.length === 0
    ? pass('expect:restaurant-fields', 'cuisine and priceRange present')
    : fail('expect:restaurant-fields', `missing: ${missing.join(', ')}`);
}

// --- generateActivity: happy path ------------------------------------------

export function checkGenerateHappy(
  value: unknown,
  expect: GenerateHappyExpect,
): CheckResult[] {
  const activity = asActivity(value);
  if (!activity) {
    return [
      fail('schema:required', 'resolver output was not shaped { activity: object }'),
    ];
  }

  const results: CheckResult[] = [checkRequired(activity), checkEnums(activity)];

  if (expect.category) {
    results.push(
      checkValueExpectation('expect:category', activity, 'category', expect.category),
    );
  }
  if (expect.region) {
    results.push(
      checkValueExpectation('expect:region', activity, 'region', expect.region),
    );
  }
  if (expect.parkType) {
    results.push(
      checkValueExpectation('expect:parkType', activity, 'parkType', expect.parkType),
    );
  }
  if (expect.duration) {
    results.push(
      checkValueExpectation('expect:duration', activity, 'duration', expect.duration),
    );
  }
  if (expect.city) results.push(checkCity(activity, expect.city));
  if (expect.geo) results.push(checkGeo('expect:geo', activity, expect.geo));
  if (expect.restaurantFields) results.push(checkRestaurantFields(activity));

  return results;
}

// --- generateActivity: graceful (adversarial) path -------------------------

export function checkGenerateGraceful(
  outcome: ResolverOutcome,
  expect: GenerateGracefulExpect,
): CheckResult[] {
  const { allowedErrors, ifReturned } = expect.graceful;

  if (!outcome.ok) {
    const cls = classifyGeminiError(outcome.error);
    // Transport failure: not the model's behavior — hand the runner an 'error'
    // so the case is excluded from the denominator rather than scored a pass.
    if (cls.infra) {
      return [
        errored(
          'graceful:error',
          `infrastructure failure, not gradeable: ${cls.message}`,
        ),
      ];
    }
    if (cls.code !== 'OTHER' && allowedErrors.includes(cls.code)) {
      return [pass('graceful:error', `rejected with ${cls.code}: ${cls.message}`)];
    }
    return [
      fail(
        'graceful:error',
        `error code ${cls.code} (${cls.message}) not in allowed [${allowedErrors.join(', ')}]`,
      ),
    ];
  }

  // Success path: the resolver returned a record.
  if (ifReturned === null) {
    return [
      fail(
        'graceful:no-fabrication',
        'model fabricated a record for garbage input; expected a graceful rejection',
      ),
    ];
  }

  const activity = asActivity(outcome.value);
  if (!activity) {
    return [
      fail('graceful:shape', 'resolver output was not shaped { activity: object }'),
    ];
  }

  // Mechanical parts only. judgeRealPlace cases get their judge check appended
  // by the runner; geo cases add a coordinate-honesty check here.
  const results: CheckResult[] = [checkEnums(activity)];
  if (ifReturned.geo) {
    results.push(checkGeo('expect:geo', activity, ifReturned.geo));
  }
  return results;
}

// --- alltrailsLookup --------------------------------------------------------

const ALLTRAILS_FIELDS = [
  'allTrailsRating',
  'hikeDistanceMiles',
  'hikeElevationFeet',
] as const;

function asLookup(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const lookup = (value as Record<string, unknown>).lookup;
  if (!lookup || typeof lookup !== 'object') return null;
  return lookup as Record<string, unknown>;
}

function rangeStr(range: NumericRange): string {
  const lo = range.min !== undefined ? String(range.min) : '-inf';
  const hi = range.max !== undefined ? String(range.max) : '+inf';
  return `[${lo}, ${hi}]`;
}

function checkNumericRange(
  name: string,
  v: unknown,
  range: NumericRange,
): CheckResult {
  if (v === null || v === undefined) {
    return range.nullable
      ? pass(name, 'null (allowed)')
      : fail(name, `expected a number in ${rangeStr(range)}, got null`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return fail(name, `expected a number, got ${JSON.stringify(v)}`);
  }
  if (range.min !== undefined && v < range.min) {
    return fail(name, `${v} below min ${range.min}`);
  }
  if (range.max !== undefined && v > range.max) {
    return fail(name, `${v} above max ${range.max}`);
  }
  return pass(name, `${v} within ${rangeStr(range)}`);
}

function checkAllNull(lookup: Record<string, unknown>): CheckResult {
  const nonNull: string[] = [];
  for (const field of ALLTRAILS_FIELDS) {
    const v = lookup[field];
    if (v !== null && v !== undefined) nonNull.push(`${field}=${JSON.stringify(v)}`);
  }
  return nonNull.length === 0
    ? pass('alltrails:allNull', 'all lookup fields null')
    : fail('alltrails:allNull', `expected all fields null, got ${nonNull.join(', ')}`);
}

function checkAlltrailsRanges(
  outcome: ResolverOutcome,
  expect: AlltrailsRangesExpect,
): CheckResult[] {
  if (!outcome.ok) {
    const cls = classifyGeminiError(outcome.error);
    if (cls.infra) {
      return [
        errored(
          'alltrails:ranges',
          `infrastructure failure, not gradeable: ${cls.message}`,
        ),
      ];
    }
    return [
      fail(
        'alltrails:ranges',
        `expected a numeric lookup, but resolver threw ${cls.code}: ${cls.message}`,
      ),
    ];
  }

  const lookup = asLookup(outcome.value);
  if (!lookup) {
    return [
      fail('alltrails:ranges', 'resolver output was not shaped { lookup: object }'),
    ];
  }

  const results: CheckResult[] = [];
  for (const field of ALLTRAILS_FIELDS) {
    const range = expect.lookup[field];
    if (!range) continue; // only grade fields the case specified
    results.push(checkNumericRange(`alltrails:${field}`, lookup[field], range));
  }
  return results;
}

function checkAlltrailsGraceful(
  outcome: ResolverOutcome,
  expect: AlltrailsGracefulExpect,
): CheckResult[] {
  const { allNull, allowedErrors } = expect.graceful;

  if (!outcome.ok) {
    const cls = classifyGeminiError(outcome.error);
    if (cls.infra) {
      return [
        errored(
          'alltrails:graceful',
          `infrastructure failure, not gradeable: ${cls.message}`,
        ),
      ];
    }
    if (cls.code === 'OTHER') {
      return [
        fail('alltrails:graceful', `unexpected non-graceful error: ${cls.message}`),
      ];
    }
    // A graceful throw. If allowedErrors constrains the set, require membership
    // regardless of allNull — allNull describes the acceptable *success* shape,
    // not a license for arbitrary error codes on the throw path.
    if (
      allowedErrors &&
      allowedErrors.length > 0 &&
      !allowedErrors.includes(cls.code)
    ) {
      return [
        fail(
          'alltrails:graceful',
          `error code ${cls.code} (${cls.message}) not in allowed [${allowedErrors.join(', ')}]`,
        ),
      ];
    }
    return [
      pass('alltrails:graceful', `rejected gracefully with ${cls.code}: ${cls.message}`),
    ];
  }

  // Success path.
  const lookup = asLookup(outcome.value);
  if (!lookup) {
    return [
      fail('alltrails:graceful', 'resolver output was not shaped { lookup: object }'),
    ];
  }
  if (allNull) return [checkAllNull(lookup)];
  // allowedErrors-only variant expected a throw; a returned lookup is a failure.
  return [
    fail(
      'alltrails:graceful',
      'expected a graceful error, but the resolver returned a lookup',
    ),
  ];
}

export function checkAlltrails(
  outcome: ResolverOutcome,
  expect: AlltrailsExpect,
): CheckResult[] {
  if ('lookup' in expect) return checkAlltrailsRanges(outcome, expect);
  return checkAlltrailsGraceful(outcome, expect);
}

// --- discover: structural graders ------------------------------------------

function asEvents(value: unknown): Record<string, unknown>[] | null {
  if (!value || typeof value !== 'object') return null;
  const events = (value as Record<string, unknown>).events;
  if (!Array.isArray(events)) return null;
  return events.map((e) =>
    e && typeof e === 'object' ? (e as Record<string, unknown>) : {},
  );
}

function eventStr(e: Record<string, unknown>, key: string): string | null {
  const v = e[key];
  return typeof v === 'string' ? v : null;
}

// Integer calendar-day index via UTC, so day math is immune to DST. The (y, m,
// d) triple is a wall-clock local date; we only use it as a stable ordinal.
function dayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m, d) / 86_400_000);
}

function dayToIso(n: number): string {
  const dt = new Date(n * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Parses YYYY-MM-DD and verifies it is a real calendar date (leap years, month
// lengths). Returns a 0-based month to feed dayNumber directly.
function parseIsoDate(s: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m: m - 1, d };
}

function classifyUrl(u: string): 'ok' | 'redirect' | 'bad' {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return 'bad';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'bad';
  // Gemini grounding citations come back as redirect URLs on this host rather
  // than the true source; accepted, but surfaced in the detail.
  if (parsed.hostname === 'vertexaisearch.cloud.google.com') return 'redirect';
  return 'ok';
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Local-time window for the requested range, as inclusive day-index bounds.
function windowFor(
  range: DiscoverRange,
  now: Date,
): { start: number; end: number } {
  const today = dayNumber(now.getFullYear(), now.getMonth(), now.getDate());
  switch (range) {
    case 'today':
      return { start: today, end: today };
    case 'tomorrow':
      return { start: today + 1, end: today + 1 };
    case 'week':
      return { start: today, end: today + 7 };
    case 'weekend':
    default: {
      // On a Sunday the "current" weekend window would collapse to a single
      // day, but the resolver prompt lets the model answer with the UPCOMING
      // Sat/Sun — so extend a Sunday window through the next weekend.
      const untilSunday = (7 - now.getDay()) % 7; // 0 if today is Sunday
      const end = untilSunday === 0 ? today + 7 : today + untilSunday;
      return { start: today, end };
    }
  }
}

function checkCount(
  events: Record<string, unknown>[],
  expect: DiscoverExpect,
): CheckResult {
  const n = events.length;
  const { minEvents, maxEvents } = expect.structural;
  return n >= minEvents && n <= maxEvents
    ? pass('structural:count', `${n} events (expected ${minEvents}-${maxEvents})`)
    : fail('structural:count', `${n} events, expected ${minEvents}-${maxEvents}`);
}

function checkFieldCoverage(
  events: Record<string, unknown>[],
  expect: DiscoverExpect,
): CheckResult {
  const total = events.length;
  const covered = events.filter((e) => {
    const name = eventStr(e, 'name');
    const start = eventStr(e, 'startDate');
    const src = eventStr(e, 'sourceUrl');
    return Boolean(name?.trim() && start?.trim() && src?.trim());
  }).length;
  const fraction = total === 0 ? 0 : covered / total;
  const min = expect.structural.minFieldCoverage;
  const pct = Math.round(fraction * 100);
  const minPct = Math.round(min * 100);
  return fraction >= min
    ? pass('structural:field-coverage', `${covered}/${total} (${pct}%) >= ${minPct}%`)
    : fail('structural:field-coverage', `${covered}/${total} (${pct}%) < ${minPct}%`);
}

function checkIsoDates(events: Record<string, unknown>[]): CheckResult {
  const bad: string[] = [];
  events.forEach((e, i) => {
    for (const key of ['startDate', 'endDate'] as const) {
      const s = eventStr(e, key);
      if (s === null) continue;
      if (!parseIsoDate(s)) bad.push(`event[${i}].${key}=${JSON.stringify(s)}`);
    }
  });
  return bad.length === 0
    ? pass('structural:iso-dates', 'all present dates are valid YYYY-MM-DD')
    : fail('structural:iso-dates', bad.join('; '));
}

function checkDateWindow(
  events: Record<string, unknown>[],
  range: DiscoverRange,
  now: Date,
): CheckResult {
  const { start: winStart, end: winEnd } = windowFor(range, now);
  const offenders: string[] = [];
  let graded = 0;
  for (const e of events) {
    const startStr = eventStr(e, 'startDate');
    if (startStr === null) continue;
    const start = parseIsoDate(startStr);
    if (!start) continue; // invalid dates are the iso-dates check's job
    graded++;
    const evStart = dayNumber(start.y, start.m, start.d);
    const endStr = eventStr(e, 'endDate');
    const end = endStr ? parseIsoDate(endStr) : null;
    const evEnd = end ? dayNumber(end.y, end.m, end.d) : evStart;
    // ±1 day slack on both edges.
    const overlaps = evStart <= winEnd + 1 && evEnd >= winStart - 1;
    if (!overlaps) {
      offenders.push(`${startStr}${endStr ? `..${endStr}` : ''}`);
    }
  }
  const window = `${dayToIso(winStart)}..${dayToIso(winEnd)} (±1d)`;
  if (graded === 0) {
    return pass('structural:date-window', 'no events with valid dates to grade');
  }
  return offenders.length === 0
    ? pass('structural:date-window', `all ${graded} dated events overlap ${window}`)
    : fail(
        'structural:date-window',
        `${offenders.length}/${graded} events outside ${window}: ${offenders.join(', ')}`,
      );
}

function checkSourceUrls(events: Record<string, unknown>[]): CheckResult {
  const bad: string[] = [];
  const redirects: string[] = [];
  events.forEach((e, i) => {
    const s = eventStr(e, 'sourceUrl');
    if (s === null) return;
    const kind = classifyUrl(s);
    if (kind === 'bad') bad.push(`event[${i}].sourceUrl=${JSON.stringify(s)}`);
    else if (kind === 'redirect') redirects.push(`event[${i}]`);
  });
  const note = redirects.length
    ? ` (${redirects.length} grounding-redirect host(s): ${redirects.join(', ')})`
    : '';
  if (bad.length > 0) {
    return fail(
      'structural:source-urls',
      `invalid url(s): ${bad.join('; ')}${note}`,
    );
  }
  return pass('structural:source-urls', `all present sourceUrls are http(s)${note}`);
}

function checkDedupe(events: Record<string, unknown>[]): CheckResult {
  const counts = new Map<string, number>();
  const dups: string[] = [];
  for (const e of events) {
    const name = eventStr(e, 'name');
    if (!name) continue;
    const key = normalizeName(name);
    if (!key) continue; // empty/punctuation-only names are a coverage concern
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (next === 2) dups.push(name);
  }
  return dups.length === 0
    ? pass('structural:dedupe', 'no duplicate event names')
    : fail('structural:dedupe', `duplicate name(s): ${dups.join('; ')}`);
}

export function checkDiscoverStructural(
  value: unknown,
  expect: DiscoverExpect,
  range: DiscoverRange,
  now: Date,
): CheckResult[] {
  const events = asEvents(value);
  if (!events) {
    return [
      fail('structural:shape', 'resolver output was not shaped { events: [...] }'),
    ];
  }

  const results: CheckResult[] = [
    checkCount(events, expect),
    checkFieldCoverage(events, expect),
    checkIsoDates(events),
  ];

  results.push(
    expect.datesWithinRange
      ? checkDateWindow(events, range, now)
      : skipped('structural:date-window', 'datesWithinRange is false; not graded'),
  );

  results.push(checkSourceUrls(events));

  results.push(
    expect.dedupe
      ? checkDedupe(events)
      : skipped('structural:dedupe', 'dedupe is false; not graded'),
  );

  return results;
}

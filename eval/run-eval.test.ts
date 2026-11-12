// The eval's runner with the resolvers and the judges faked: which cases
// run, how each is graded and scored, the exit code, and the configuration
// it refuses. No Gemini call is made. The graders themselves are tested in
// checks.test.ts and checks.graders.test.ts.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { badGateway, badInput } from '../api/_gqlError.js';
import {
  caseStatus,
  ensureApiKey,
  loadGoldenSet,
  main,
  parseArgs,
  statusGlyph,
} from './run-eval.js';
import type { CaseStatus, CheckResult, GoldenCase } from './types.js';

const fakes = vi.hoisted(() => ({
  generateActivity: vi.fn(),
  alltrailsLookup: vi.fn(),
  discover: vi.fn(),
  rankTripCandidates: vi.fn(),
  judgeDescriptions: vi.fn(),
  judgeRealPlace: vi.fn(),
  judgeDiscoverEvents: vi.fn(),
}));
vi.mock('../api/_resolvers/gemini.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/_resolvers/gemini.js')>()),
  geminiMutation: {
    generateActivity: fakes.generateActivity,
    alltrailsLookup: fakes.alltrailsLookup,
  },
  geminiQuery: { discover: fakes.discover },
  rankTripCandidates: fakes.rankTripCandidates,
}));
// report.ts names the commit with git: answer for it, so no real git runs.
vi.mock('node:child_process', () => ({ execSync: () => Buffer.from('0123456789abcdef\n') }));
vi.mock('./judge.js', () => ({
  judgeDescriptions: fakes.judgeDescriptions,
  judgeRealPlace: fakes.judgeRealPlace,
  judgeDiscoverEvents: fakes.judgeDiscoverEvents,
}));

const check = (name: string, status: CheckResult['status'] = 'pass'): CheckResult => ({
  name,
  status,
  detail: `${name} ${status}`,
});
const record = {
  activity: {
    name: 'Muir Woods',
    shortDescription: 's',
    longDescription: 'l',
    category: 'hiking',
    region: 'north-bay',
    city: 'Mill Valley',
    lat: 37.8912,
    lng: -122.5719,
    duration: '1-2 Hours',
    difficulty: 'easy',
    dogFriendly: false,
    cardLine: 'Old-growth redwoods in a quiet canyon.',
  },
};

const NOTES = 'Coordinates from NPS, as of 2026-10-25.';
const base = { kind: 'happy', notes: NOTES } as const;
const CASES = {
  happy: {
    ...base,
    id: 'gen-muir',
    feature: 'generateActivity',
    input: { title: 'Muir Woods' },
    expect: { category: ['hiking'], judgeDescriptions: true },
  },
  park: {
    ...base,
    id: 'gen-in-park',
    feature: 'generateActivity',
    input: { title: 'Cathedral Grove' },
    expect: { partOf: [] },
  },
  hike: {
    ...base,
    id: 'gen-hike',
    feature: 'generateActivity',
    input: { title: 'Dipsea' },
    expect: { allTrailsTrails: ['us/california/dipsea-trail'] },
  },
  vague: {
    ...base,
    id: 'gen-vague',
    feature: 'generateActivity',
    input: { title: 'a nice beach' },
    expect: {
      graceful: { allowedErrors: ['BAD_USER_INPUT'], ifReturned: { judgeRealPlace: true } },
    },
  },
  nonsense: {
    ...base,
    id: 'gen-nonsense',
    feature: 'generateActivity',
    input: { title: 'asdf qwer' },
    expect: { graceful: { allowedErrors: ['BAD_USER_INPUT'], ifReturned: null } },
    expectedFailure: { reason: 'the schema forces a record' },
  },
  trail: {
    ...base,
    id: 'at-dipsea',
    feature: 'alltrailsLookup',
    input: { url: 'https://www.alltrails.com/trail/us/california/dipsea-trail' },
    expect: { lookup: { allTrailsRating: { min: 4, max: 5 } } },
  },
  events: {
    ...base,
    id: 'disc-week',
    feature: 'discover',
    input: { range: 'week' },
    expect: {
      structural: { minEvents: 0, maxEvents: 10, minFieldCoverage: 0 },
      datesWithinRange: false,
      dedupe: false,
      judgeEvents: { minPlausibleFraction: 0.5 },
    },
  },
  trip: {
    ...base,
    id: 'trip-coast',
    feature: 'tripSuggestions',
    input: {
      prompt: 'a day on the coast',
      catalog: [
        { id: 'beach', name: 'Beach', category: 'beach' },
        { id: 'mall', name: 'Mall', category: 'shopping' },
      ],
    },
    expect: { includeAny: ['beach'], excludeAll: ['mall'], minPicks: 1, maxPicks: 2 },
  },
} as const;
const ALL = Object.values(CASES);

let dir: string;
let log: MockInstance<typeof console.log>;
/** The eval's folder, holding a golden set of `cases`. */
function goldenSet(cases: unknown, meta: unknown = { status: 'reviewed 2026-10-25' }) {
  writeFileSync(join(dir, 'golden-set.json'), JSON.stringify({ _meta: meta, cases }));
  return dir;
}
const results = () =>
  JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8')) as {
    summary: { score: number; graded: number; inconclusive: boolean };
    cases: { id: string; status: CaseStatus; checks: CheckResult[] }[];
  };
const statuses = () => Object.fromEntries(results().cases.map((c) => [c.id, c.status]));
const checksOf = (id: string) => results().cases.find((c) => c.id === id)?.checks ?? [];

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'eval-')), 'eval');
  mkdirSync(dir);
  vi.stubEnv('GEMINI_API_KEY', 'key');
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  // The Dipsea draft links its trail; the rest are Muir Woods.
  fakes.generateActivity.mockImplementation((_: unknown, { input }: { input: { title: string } }) =>
    Promise.resolve(
      input.title === 'Dipsea'
        ? {
            activity: {
              ...record.activity,
              allTrailsUrl: 'https://www.alltrails.com/trail/us/california/dipsea-trail',
            },
          }
        : record,
    ),
  );
  fakes.alltrailsLookup.mockResolvedValue({ lookup: { allTrailsRating: 4.8 } });
  fakes.discover.mockResolvedValue({ events: [] });
  fakes.rankTripCandidates.mockResolvedValue([{ activityId: 'beach' }]);
  fakes.judgeDescriptions.mockResolvedValue(check('judge:descriptions'));
  fakes.judgeRealPlace.mockResolvedValue(check('judge:real-place'));
  fakes.judgeDiscoverEvents.mockResolvedValue(check('judge:events'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  for (const fake of Object.values(fakes)) fake.mockReset();
});

const config = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a configuration error');
};

describe('main', () => {
  it('grades each feature through its resolver and judges, and exits 0 over the bar', async () => {
    expect(await main([], goldenSet(ALL))).toBe(0);
    expect(statuses()).toEqual({
      'gen-muir': 'pass',
      'gen-in-park': 'pass',
      'gen-hike': 'pass',
      'gen-vague': 'pass',
      'gen-nonsense': 'known-failure',
      'at-dipsea': 'pass',
      'disc-week': 'pass',
      'trip-coast': 'pass',
    });
    expect(results().summary.score).toBe(1);
    expect(fakes.generateActivity).toHaveBeenCalledWith(
      undefined,
      { input: { title: 'Muir Woods' } },
      { caller: { email: 'eval@local', role: 'owner' } },
    );
    expect(fakes.judgeDescriptions).toHaveBeenCalledWith(
      record,
      `Requested activity: Muir Woods. Known facts: ${NOTES}`,
    );
    expect(fakes.judgeRealPlace).toHaveBeenCalledTimes(1);
    expect(fakes.discover).toHaveBeenCalledWith(undefined, { range: 'week' }, expect.anything());
    expect(fakes.judgeDiscoverEvents).toHaveBeenCalledWith({ events: [] }, 0.5);
    expect(fakes.rankTripCandidates).toHaveBeenCalledWith(
      'a day on the coast',
      CASES.trip.input.catalog,
      'key',
    );
    expect(checksOf('gen-hike').find((c) => c.name === 'expect:allTrailsUrl')?.status).toBe('pass');
    expect(checksOf('gen-nonsense').at(-1)).toEqual({
      name: 'expected-failure',
      status: 'skipped',
      detail: 'the schema forces a record',
    });
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Gemini output-quality eval — 8 case(s), 4 at a time, threshold 90%');
    expect(printed).toContain('  ✓ gen-muir');
    expect(printed).toContain('  ~ gen-nonsense');
    expect(printed).toContain('Results written to eval/results.json');
  });

  it('skips the judges with --no-judge, grading them neither way', async () => {
    expect(await main(['--no-judge'], goldenSet(ALL))).toBe(0);
    for (const judge of [
      fakes.judgeDescriptions,
      fakes.judgeRealPlace,
      fakes.judgeDiscoverEvents,
    ]) {
      expect(judge).not.toHaveBeenCalled();
    }
    expect(checksOf('gen-muir').at(-1)).toEqual({
      name: 'judge:descriptions',
      status: 'skipped',
      detail: 'not judged (--no-judge)',
    });
    expect(checksOf('gen-vague').at(-1)?.name).toBe('judge:real-place');
    expect(checksOf('disc-week').at(-1)?.name).toBe('judge:events');
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain(', no judge calls');
  });

  it("doesn't pay for a judge once a mechanical check has failed", async () => {
    fakes.generateActivity.mockResolvedValue({
      activity: { ...record.activity, category: 'food' },
    });
    expect(await main(['--only', 'gen-muir'], goldenSet(ALL))).toBe(1);
    expect(fakes.judgeDescriptions).not.toHaveBeenCalled();
    expect(statuses()).toEqual({ 'gen-muir': 'fail' });
  });

  it('fails a case its judge fails, and a resolver whose output is wrong', async () => {
    fakes.judgeDiscoverEvents.mockResolvedValue(check('judge:events', 'fail'));
    fakes.rankTripCandidates.mockResolvedValue([{ activityId: 'mall' }]);
    fakes.alltrailsLookup.mockRejectedValue(badInput('no such trail'));
    expect(await main(['--only', 'disc-week,trip-coast,at-dipsea'], goldenSet(ALL))).toBe(1);
    expect(statuses()).toEqual({ 'at-dipsea': 'fail', 'disc-week': 'fail', 'trip-coast': 'fail' });
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('  ✗ disc-week');
  });

  it('counts a transport failure as infrastructure, and a bad answer as a failure', async () => {
    fakes.discover.mockRejectedValue(new Error('fetch failed'));
    fakes.rankTripCandidates.mockRejectedValue(badGateway('gemini request failed'));
    fakes.generateActivity.mockRejectedValue(badGateway('unparseable reply'));
    expect(await main(['--only', 'disc-week,trip-coast,gen-muir'], goldenSet(ALL))).toBe(1);
    expect(statuses()).toEqual({ 'gen-muir': 'fail', 'disc-week': 'error', 'trip-coast': 'error' });
    expect(checksOf('disc-week')[0]).toEqual({
      name: 'resolved',
      status: 'error',
      detail: 'fetch failed',
    });
    expect(results().summary.inconclusive).toBe(true);
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('  ! disc-week');
  });

  it('runs only the cases asked for: by id, feature, hikes or parks', async () => {
    await main(['--only', 'gen-muir, at-dipsea', '--threshold', '0.5'], goldenSet(ALL));
    expect(Object.keys(statuses())).toEqual(['gen-muir', 'at-dipsea']);
    await main(['--feature', 'alltrailsLookup'], goldenSet(ALL));
    expect(Object.keys(statuses())).toEqual(['at-dipsea']);
    await main(['--hikes'], goldenSet(ALL));
    expect(Object.keys(statuses())).toEqual(['gen-hike']);
    await main(['--parks', '--concurrency', '1'], goldenSet(ALL));
    expect(Object.keys(statuses())).toEqual(['gen-in-park']);
  });

  it("refuses an id that isn't in the set, or a selection of none", async () => {
    await expect(main(['--only', 'gen-x,gen-muir'], goldenSet(ALL))).rejects.toMatchObject({
      message: 'eval: unknown case id(s): gen-x',
      exitCode: 2,
    });
    await expect(
      main(['--only', 'gen-muir', '--feature', 'discover'], goldenSet(ALL)),
    ).rejects.toThrow('eval: no cases selected');
  });

  it('stops a case at its time limit, and the process with it', async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    fakes.discover.mockReturnValue(new Promise(() => {}));
    const run = main(['--only', 'disc-week', '--threshold', '1'], goldenSet(ALL));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await run).toBe(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(checksOf('disc-week')[0]?.detail).toBe('case timed out after 120000ms');
  });
});

describe('parseArgs', () => {
  it('reads the options, and the threshold and concurrency from the environment', () => {
    expect(parseArgs([], {})).toEqual({
      only: null,
      feature: null,
      hikes: false,
      parks: false,
      judge: true,
      threshold: 0.9,
      concurrency: 4,
    });
    expect(parseArgs([], { EVAL_THRESHOLD: '0.75', EVAL_CONCURRENCY: '2' })).toMatchObject({
      threshold: 0.75,
      concurrency: 2,
    });
    expect(
      parseArgs(['--feature', 'discover', '--threshold', '1', '--concurrency', '8'], {}),
    ).toMatchObject({ feature: 'discover', threshold: 1, concurrency: 8 });
  });

  it('refuses arguments it has no use for, with exit 2', () => {
    const cases: [string[], string][] = [
      [['--bogus'], 'eval: unknown argument: --bogus'],
      [['--only'], 'eval: --only requires a comma-separated list of case ids'],
      [['--only', ' , '], 'eval: --only requires at least one case id'],
      [['--feature'], 'eval: --feature requires a value'],
      [['--feature', 'chat'], 'eval: unknown feature: chat'],
      [['--threshold', '0'], 'eval: threshold must be a fraction in (0, 1], got: 0'],
      [['--threshold', '1.5'], 'eval: threshold must be a fraction in (0, 1], got: 1.5'],
      [['--threshold', 'x'], 'eval: threshold must be a fraction in (0, 1], got: NaN'],
      [['--concurrency', '0'], 'eval: concurrency must be a whole number of at least 1, got: 0'],
    ];
    for (const [argv, message] of cases) {
      expect(config(() => parseArgs(argv, {}))).toMatchObject({ message, exitCode: 2 });
    }
  });
});

describe('ensureApiKey', () => {
  it('keeps a key already set', () => {
    ensureApiKey(dir);
    expect(process.env.GEMINI_API_KEY).toBe('key');
  });

  it('reads the key from .env.local, then .env, without quotes or a comment', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    writeFileSync(join(dir, '..', '.env'), 'OTHER=1\nGEMINI_API_KEY="from-env" # dev key\n');
    ensureApiKey(dir);
    expect(process.env.GEMINI_API_KEY).toBe('from-env');
    vi.stubEnv('GEMINI_API_KEY', '');
    writeFileSync(join(dir, '..', '.env.local'), "GEMINI_API_KEY='from-local'\n");
    ensureApiKey(dir);
    expect(process.env.GEMINI_API_KEY).toBe('from-local');
  });

  it('skips an env file without the key, and keeps quotes and #s inside the value', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    writeFileSync(join(dir, '..', '.env.local'), 'OTHER=1\n');
    writeFileSync(join(dir, '..', '.env'), `GEMINI_API_KEY=it's"a#key  # dev key\n`);
    ensureApiKey(dir);
    expect(process.env.GEMINI_API_KEY).toBe(`it's"a#key`);
  });

  it('refuses to run without one', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    writeFileSync(join(dir, '..', '.env.local'), 'GEMINI_API_KEY=\n');
    expect(config(() => ensureApiKey(dir))).toMatchObject({
      message: 'eval: GEMINI_API_KEY is not set — run `vercel env pull .env.local` first',
      exitCode: 2,
    });
  });
});

describe('loadGoldenSet', () => {
  const refused = (cases: unknown, meta?: unknown) =>
    (config(() => loadGoldenSet(goldenSet(cases, meta))) as Error).message;
  const withExpect = (c: object, change: Record<string, unknown>) => ({ ...c, ...change });

  it('reads a well-formed set', () => {
    expect(loadGoldenSet(goldenSet(ALL)).cases).toHaveLength(ALL.length);
    // As many picks at least as at most is a range of one.
    const exact = { ...CASES.trip, expect: { ...CASES.trip.expect, minPicks: 1, maxPicks: 1 } };
    expect(loadGoldenSet(goldenSet([exact])).cases).toHaveLength(1);
  });

  it('refuses a set that is malformed, with the case it trips on', () => {
    writeFileSync(join(dir, 'golden-set.json'), '{');
    expect((config(() => loadGoldenSet(dir)) as Error).message).toMatch(
      /^eval: golden-set\.json is not valid JSON: /,
    );
    expect(refused(ALL, {})).toBe('eval: golden-set.json missing _meta.status or cases[]');
    expect(refused('x')).toBe('eval: golden-set.json missing _meta.status or cases[]');
    expect(refused([{ id: 'x' }])).toMatch(
      /^eval: golden case is missing id\/feature\/input\/expect\/notes: /,
    );
    expect(refused([CASES.happy, CASES.happy])).toBe('eval: duplicate golden case id: gen-muir');
    // Each required field on its own, and the case quoted to its first 120 characters.
    for (const field of ['id', 'feature', 'input', 'expect', 'notes']) {
      const c: Record<string, unknown> = { ...CASES.happy, notes: 'n'.repeat(200) };
      delete c[field];
      expect(refused([c])).toBe(
        `eval: golden case is missing id/feature/input/expect/notes: ${JSON.stringify(c).slice(0, 120)}`,
      );
    }
  });

  it("refuses a case whose shape doesn't fit its feature", () => {
    const cases: [unknown, string][] = [
      [withExpect(CASES.happy, { input: { title: '' } }), 'input.title must be a non-empty string'],
      [withExpect(CASES.happy, { input: { title: 3 } }), 'input.title must be a non-empty string'],
      [
        withExpect(CASES.vague, { expect: { graceful: null } }),
        'graceful.allowedErrors must be an array',
      ],
      [
        withExpect(CASES.vague, { expect: { graceful: { allowedErrors: 'x', ifReturned: null } } }),
        'graceful.allowedErrors must be an array',
      ],
      [
        withExpect(CASES.vague, { expect: { graceful: { allowedErrors: [] } } }),
        'graceful.ifReturned must be null or an object',
      ],
      [withExpect(CASES.trail, { input: { url: 3 } }), 'input.url must be a non-empty string'],
      [withExpect(CASES.trail, { expect: {} }), 'expect needs a lookup or graceful variant'],
      [withExpect(CASES.events, { input: { range: 'year' } }), 'input.range invalid'],
      [
        withExpect(CASES.events, { expect: { judgeEvents: { minPlausibleFraction: 1 } } }),
        'expect.structural.minEvents missing',
      ],
      [
        withExpect(CASES.events, { expect: { structural: { minEvents: 1 } } }),
        'expect.judgeEvents.minPlausibleFraction missing',
      ],
      [
        withExpect(CASES.trip, { input: { prompt: '', catalog: [] } }),
        'input.prompt must be a non-empty string',
      ],
      [
        withExpect(CASES.trip, { input: { prompt: 5, catalog: [] } }),
        'input.prompt must be a non-empty string',
      ],
      [
        withExpect(CASES.trip, { input: { prompt: 'p', catalog: [] } }),
        'input.catalog must be a non-empty array',
      ],
      [
        withExpect(CASES.trip, { expect: { includeAny: [], minPicks: 0, maxPicks: 1 } }),
        'expect.includeAny must be a non-empty array',
      ],
      [
        withExpect(CASES.trip, { expect: { includeAny: ['beach'], minPicks: 2, maxPicks: 1 } }),
        'expect needs 0 <= minPicks <= maxPicks',
      ],
      [
        withExpect(CASES.trip, { expect: { includeAny: ['beach'], minPicks: -1, maxPicks: 1 } }),
        'expect needs 0 <= minPicks <= maxPicks',
      ],
      [
        withExpect(CASES.trip, {
          expect: { includeAny: ['beach'], excludeAll: ['zoo'], minPicks: 0, maxPicks: 1 },
        }),
        "expectation names zoo, which isn't in the catalog",
      ],
      [withExpect(CASES.happy, { feature: 'chat' }), 'unknown feature: chat'],
    ];
    for (const [bad, why] of cases) {
      const id = (bad as { id: string }).id;
      expect(refused([bad])).toBe(`eval: golden case ${id}: ${why}`);
    }
  });
});

describe('caseStatus', () => {
  const xfail = { ...CASES.nonsense } as unknown as GoldenCase;
  const plain = CASES.happy as unknown as GoldenCase;
  it('ranks a failure over an infrastructure error, and leaves an errored xfail errored', () => {
    expect(caseStatus(plain, [check('a', 'fail'), check('b', 'error')])).toBe('fail');
    expect(caseStatus(plain, [check('a', 'pass'), check('b', 'error')])).toBe('error');
    expect(caseStatus(plain, [check('a', 'pass')])).toBe('pass');
    expect(caseStatus(xfail, [check('a', 'error')])).toBe('error');
    expect(caseStatus(xfail, [check('a', 'fail')])).toBe('known-failure');
    expect(caseStatus(xfail, [check('a', 'pass')])).toBe('unexpected-pass');
  });
});

describe('statusGlyph', () => {
  it('marks each status', () => {
    expect(
      (['pass', 'known-failure', 'error', 'fail', 'unexpected-pass'] as const).map(statusGlyph),
    ).toEqual(['✓', '~', '!', '✗', '✗']);
  });
});

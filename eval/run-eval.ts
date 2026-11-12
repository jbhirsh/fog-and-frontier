// CLI entry for the Gemini output-quality eval (issue #122). Calls the
// production resolvers directly with a fabricated owner context (the same
// trick api/graphql.test.ts uses), grades each golden case mechanically —
// judge calls only where prose plausibility can't be checked in code — and
// exits non-zero when the score drops below the threshold or the run is
// inconclusive. Paid Gemini calls: not part of `npm test`.
//
// The golden set (golden-set.json) was reviewed on 2026-10-25 (#280): each
// case checked against the source its notes cite and corrected where it had
// drifted (two pins, a city and a region that accepted too much, stale fees
// and stats, and a nonsense title one letter from a real place). Each case
// cites its data's provenance and an as-of date; review it again when a
// case's place changes. One case is xfail: the response schema forces the
// model to fabricate a record for nonsense input (gen-nonsense) rather than
// decline; a refusal or uncertainty field in ACTIVITY_SCHEMA is the candidate
// fix.
//
// Scores: 100% (22/22 graded, before the two trip-suggestion cases
// were added) on search-grounded gemini-3.8-flash, by the searching judge,
// 2026-10-14 (run 38511460561). Before the judge could search, the same
// resolvers scored 95.5% (run 38501577212): gen-duartes-tavern failed true
// details as unverifiable, which the searching judge confirms. A perfect score
// from a more capable grader is worth watching: a description a person would
// call wrong passing would mean the rubric has become too lenient. The first
// grounded run (90.9%, run 38489973906) failed gen-muir-woods on a real model
// error, putting Bohemian Grove (a private club in Sonoma County) inside Muir
// Woods; the prompt now names a place inside an activity only when a source
// the model found does. The last 2.5 Flash score was 95.5% (21/22, run
// 29061551986, 2026-07-10), when gen-muir-woods once failed for calling the
// trees "thousands of years old" (the oldest are about 1,200, per NPS), a
// model exaggeration left standing.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GqlContext } from '../api/_gqlContext.js';
import {
  MODEL,
  geminiMutation,
  geminiQuery,
  rankTripCandidates,
} from '../api/_resolvers/gemini.js';
import {
  checkAlltrails,
  checkDiscoverStructural,
  checkGenerateGraceful,
  checkGenerateHappy,
  checkTripSuggestions,
  classifyGeminiError,
  withTrailSearch,
} from './checks.js';
import { judgeDescriptions, judgeDiscoverEvents, judgeRealPlace } from './judge.js';
import { withEvents } from './events.js';
import { renderUsage, usageOf, type CaseUsage } from './usage.js';
import { mapPool } from './pool.js';
import { buildResults, renderScorecard, writeResults } from './report.js';
import {
  CASE_TIMEOUT_MS,
  DEFAULT_THRESHOLD,
  type CaseResult,
  type CaseStatus,
  type CheckResult,
  type Feature,
  type GoldenCase,
  type GoldenSet,
  type ResolverOutcome,
} from './types.js';
import { ScriptError, runAsScript } from '../scripts/run-as-script.ts';

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
// The server gate is requireOwnerCtx, which only inspects this object — no
// sign-in or DB involved, so a fabricated owner is enough to call resolvers.
const CTX: GqlContext = { caller: { email: 'eval@local', role: 'owner' } };

// --- CLI / env ---------------------------------------------------------------

interface CliOptions {
  only: string[] | null;
  feature: Feature | null;
  /** only the hikes graded on their AllTrails link */
  hikes: boolean;
  /** only the drafts graded on the park they're in, or none */
  parks: boolean;
  /** skip the judge calls, which search too: about 40% of a full run */
  judge: boolean;
  threshold: number;
  /** how many cases run at once */
  concurrency: number;
}

// Cases run at once by default: enough that the run takes a fraction of the
// time one at a time did, few enough to stay inside Gemini's rate limits (a
// 429 would leave a case ungraded).
const DEFAULT_CONCURRENCY = 4;

export function parseArgs(argv: readonly string[], env = process.env): CliOptions {
  let only: string[] | null = null;
  let feature: Feature | null = null;
  let hikes = false;
  let parks = false;
  let judge = true;
  let threshold = DEFAULT_THRESHOLD;
  let concurrency = DEFAULT_CONCURRENCY;

  const envThreshold = env.EVAL_THRESHOLD;
  if (envThreshold) threshold = Number(envThreshold);
  const envConcurrency = env.EVAL_CONCURRENCY;
  if (envConcurrency) concurrency = Number(envConcurrency);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--only') {
      const value = argv[++i];
      if (!value) exitConfig('--only requires a comma-separated list of case ids');
      only = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (only.length === 0) exitConfig('--only requires at least one case id');
    } else if (arg === '--feature') {
      const value = argv[++i];
      if (!value) exitConfig('--feature requires a value');
      feature = value as Feature;
    } else if (arg === '--hikes') {
      hikes = true;
    } else if (arg === '--parks') {
      parks = true;
    } else if (arg === '--no-judge') {
      judge = false;
    } else if (arg === '--threshold') {
      threshold = Number(argv[++i]);
    } else if (arg === '--concurrency') {
      concurrency = Number(argv[++i]);
    } else {
      exitConfig(`unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    exitConfig(`threshold must be a fraction in (0, 1], got: ${threshold}`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    exitConfig(`concurrency must be a whole number of at least 1, got: ${concurrency}`);
  }
  if (
    feature &&
    !['generateActivity', 'alltrailsLookup', 'discover', 'tripSuggestions'].includes(feature)
  ) {
    exitConfig(`unknown feature: ${feature}`);
  }
  return { only, feature, hikes, parks, judge, threshold, concurrency };
}

// A configuration problem: the run stops before any paid call, with exit 2.
function exitConfig(message: string): never {
  throw new ScriptError(`eval: ${message}`, 2);
}

// Best-effort local-dev key pickup: real env always wins, and only this one
// variable is read — not a general dotenv load. `dir` is the eval's folder,
// beside the env files.
export function ensureApiKey(dir = EVAL_DIR): void {
  if (process.env.GEMINI_API_KEY) return;
  for (const file of ['.env.local', '.env']) {
    const p = path.join(dir, '..', file);
    if (!existsSync(p)) continue;
    const line = readFileSync(p, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('GEMINI_API_KEY='));
    if (line) {
      const value = line
        .slice('GEMINI_API_KEY='.length)
        .trim()
        .replace(/\s+#.*$/, '') // trailing inline comment
        .replace(/^["']|["']$/g, '');
      if (value) {
        process.env.GEMINI_API_KEY = value;
        return;
      }
    }
  }
  exitConfig('GEMINI_API_KEY is not set — run `vercel env pull .env.local` first');
}

// --- golden set --------------------------------------------------------------

export function loadGoldenSet(dir = EVAL_DIR): GoldenSet {
  const raw = readFileSync(path.join(dir, 'golden-set.json'), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    exitConfig(`golden-set.json is not valid JSON: ${(err as Error).message}`);
  }
  const set = parsed as GoldenSet;
  if (!set._meta?.status || !Array.isArray(set.cases)) {
    exitConfig('golden-set.json missing _meta.status or cases[]');
  }
  const seen = new Set<string>();
  for (const c of set.cases) {
    if (!c.id || !c.feature || !c.input || !c.expect || !c.notes) {
      exitConfig(
        `golden case is missing id/feature/input/expect/notes: ${JSON.stringify(c).slice(0, 120)}`,
      );
    }
    if (seen.has(c.id)) exitConfig(`duplicate golden case id: ${c.id}`);
    seen.add(c.id);
    validateCaseShape(c);
  }
  return set;
}

// Feature-specific shape guards — enough that malformed golden data exits 2
// with a named case instead of exploding as an uncaught TypeError mid-grading.
function validateCaseShape(c: GoldenCase): void {
  const bad = (why: string): never => exitConfig(`golden case ${c.id}: ${why}`);
  switch (c.feature) {
    case 'generateActivity': {
      if (typeof c.input.title !== 'string' || !c.input.title)
        bad('input.title must be a non-empty string');
      if ('graceful' in c.expect) {
        if (!Array.isArray(c.expect.graceful?.allowedErrors))
          bad('graceful.allowedErrors must be an array');
        if (c.expect.graceful.ifReturned === undefined)
          bad('graceful.ifReturned must be null or an object');
      }
      break;
    }
    case 'alltrailsLookup': {
      if (typeof c.input.url !== 'string' || !c.input.url)
        bad('input.url must be a non-empty string');
      if (!('lookup' in c.expect) && !('graceful' in c.expect))
        bad('expect needs a lookup or graceful variant');
      break;
    }
    case 'discover': {
      if (!['today', 'tomorrow', 'week', 'weekend'].includes(c.input.range))
        bad('input.range invalid');
      if (typeof c.expect.structural?.minEvents !== 'number')
        bad('expect.structural.minEvents missing');
      if (typeof c.expect.judgeEvents?.minPlausibleFraction !== 'number')
        bad('expect.judgeEvents.minPlausibleFraction missing');
      break;
    }
    case 'tripSuggestions': {
      if (typeof c.input.prompt !== 'string' || !c.input.prompt)
        bad('input.prompt must be a non-empty string');
      if (!Array.isArray(c.input.catalog) || c.input.catalog.length === 0)
        bad('input.catalog must be a non-empty array');
      if (!Array.isArray(c.expect.includeAny) || c.expect.includeAny.length === 0)
        bad('expect.includeAny must be a non-empty array');
      if (!(c.expect.minPicks >= 0 && c.expect.maxPicks >= c.expect.minPicks))
        bad('expect needs 0 <= minPicks <= maxPicks');
      const ids = new Set(c.input.catalog.map((a) => a.id));
      for (const id of [...c.expect.includeAny, ...(c.expect.excludeAll ?? [])]) {
        if (!ids.has(id)) bad(`expectation names ${id}, which isn't in the catalog`);
      }
      break;
    }
    default:
      bad(`unknown feature: ${String((c as { feature: unknown }).feature)}`);
  }
}

// --- resolver invocation -----------------------------------------------------

async function callResolver(goldenCase: GoldenCase): Promise<ResolverOutcome> {
  const run = async (): Promise<unknown> => {
    switch (goldenCase.feature) {
      case 'generateActivity':
        return geminiMutation.generateActivity(undefined, { input: goldenCase.input }, CTX);
      case 'alltrailsLookup':
        return geminiMutation.alltrailsLookup(undefined, { input: goldenCase.input }, CTX);
      case 'discover':
        return geminiQuery.discover(undefined, { range: goldenCase.input.range }, CTX);
      case 'tripSuggestions':
        // The ranking itself, over the case's fixed catalog: no DB.
        return rankTripCandidates(
          goldenCase.input.prompt,
          goldenCase.input.catalog,
          process.env.GEMINI_API_KEY ?? '',
        );
    }
  };
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`case timed out after ${CASE_TIMEOUT_MS}ms`)),
      CASE_TIMEOUT_MS,
    ).unref();
  });
  try {
    return { ok: true, value: await Promise.race([run(), timeout]) };
  } catch (error) {
    return { ok: false, error };
  }
}

// --- grading -----------------------------------------------------------------

// Happy-path cases share one resolver-outcome gate: a transport failure is an
// infra `error` (excluded from the score), while a parity-guard/parse failure
// is a real quality `fail`.
function resolvedCheck(outcome: ResolverOutcome): CheckResult {
  if (outcome.ok) return { name: 'resolved', status: 'pass', detail: 'resolver returned' };
  const classified = classifyGeminiError(outcome.error);
  return {
    name: 'resolved',
    status: classified.infra ? 'error' : 'fail',
    detail: classified.message,
  };
}

// A judge left out of a run (--no-judge): no verdict either way.
const unjudged = (name: string): CheckResult => ({
  name,
  status: 'skipped',
  detail: 'not judged (--no-judge)',
});

export async function gradeCase(
  goldenCase: GoldenCase,
  judge: boolean,
): Promise<{ checks: CheckResult[]; output: unknown; events: Record<string, unknown>[] }> {
  const { result: outcome, events } = await withEvents(goldenCase.id, () =>
    callResolver(goldenCase),
  );
  const output = outcome.ok
    ? outcome.value
    : { error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error) };
  const checks: CheckResult[] = [];

  switch (goldenCase.feature) {
    case 'generateActivity': {
      if ('graceful' in goldenCase.expect) {
        checks.push(...checkGenerateGraceful(outcome, goldenCase.expect));
        if (
          outcome.ok &&
          goldenCase.expect.graceful.ifReturned?.judgeRealPlace &&
          noFailures(checks)
        ) {
          checks.push(judge ? await judgeRealPlace(outcome.value) : unjudged('judge:real-place'));
        }
        break;
      }
      const gate = resolvedCheck(outcome);
      checks.push(gate);
      if (gate.status !== 'pass' || !outcome.ok) break;
      checks.push(...withTrailSearch(checkGenerateHappy(outcome.value, goldenCase.expect), events));
      // Judges are paid calls — skip when a mechanical check already failed
      // the case; the verdict can't change.
      if (goldenCase.expect.judgeDescriptions && noFailures(checks)) {
        const context = `Requested activity: ${goldenCase.input.title}. Known facts: ${goldenCase.notes}`;
        checks.push(
          judge ? await judgeDescriptions(outcome.value, context) : unjudged('judge:descriptions'),
        );
      }
      break;
    }
    case 'alltrailsLookup': {
      checks.push(...checkAlltrails(outcome, goldenCase.expect));
      break;
    }
    case 'discover': {
      const gate = resolvedCheck(outcome);
      checks.push(gate);
      if (gate.status !== 'pass' || !outcome.ok) break;
      checks.push(
        ...checkDiscoverStructural(
          outcome.value,
          goldenCase.expect,
          goldenCase.input.range,
          new Date(),
        ),
      );
      if (noFailures(checks)) {
        checks.push(
          judge
            ? await judgeDiscoverEvents(
                outcome.value,
                goldenCase.expect.judgeEvents.minPlausibleFraction,
              )
            : unjudged('judge:events'),
        );
      }
      break;
    }
    case 'tripSuggestions': {
      const gate = resolvedCheck(outcome);
      checks.push(gate);
      if (gate.status !== 'pass' || !outcome.ok) break;
      checks.push(...checkTripSuggestions(outcome.value, goldenCase.expect));
      break;
    }
  }
  return { checks, output, events };
}

function noFailures(checks: CheckResult[]): boolean {
  return !checks.some((c) => c.status === 'fail');
}

export function caseStatus(goldenCase: GoldenCase, checks: CheckResult[]): CaseStatus {
  const anyFail = checks.some((c) => c.status === 'fail');
  const anyError = checks.some((c) => c.status === 'error');
  // Real failures outrank infra errors: a case that already failed a quality
  // check stays failed even if a judge call also errored. The converse is
  // deliberate too — mechanical passes with an errored judge leave the case
  // `error` (excluded), because a case whose plausibility was never graded
  // wasn't fully graded.
  const base: CaseStatus = anyFail ? 'fail' : anyError ? 'error' : 'pass';
  if (!goldenCase.expectedFailure || base === 'error') return base;
  return base === 'fail' ? 'known-failure' : 'unexpected-pass';
}

// --- main --------------------------------------------------------------------

/**
 * Runs the eval and resolves to its exit code. `dir` holds the golden set
 * and gets results.json: the eval's own folder, but for the tests.
 */
export async function main(argv: readonly string[], dir = EVAL_DIR): Promise<number> {
  const options = parseArgs(argv);
  ensureApiKey(dir);
  const goldenSet = loadGoldenSet(dir);

  let cases = goldenSet.cases;
  if (options.only) {
    // Validate ids against the FULL set before any other filter, so an id
    // excluded by --feature reads as filtered out, not "unknown".
    const missing = options.only.filter((id) => !cases.some((c) => c.id === id));
    if (missing.length > 0) exitConfig(`unknown case id(s): ${missing.join(', ')}`);
    const wanted = new Set(options.only);
    cases = cases.filter((c) => wanted.has(c.id));
  }
  if (options.feature) cases = cases.filter((c) => c.feature === options.feature);
  if (options.hikes) {
    cases = cases.filter((c) => c.feature === 'generateActivity' && 'allTrailsTrails' in c.expect);
  }
  if (options.parks) {
    cases = cases.filter((c) => c.feature === 'generateActivity' && 'partOf' in c.expect);
  }
  if (cases.length === 0) exitConfig('no cases selected');

  console.log(
    `Gemini output-quality eval — ${cases.length} case(s), ${options.concurrency} at a time, threshold ${options.threshold * 100}%${options.judge ? '' : ', no judge calls'}`,
  );
  console.log(`Golden set: ${goldenSet._meta.status}\n`);

  const startedAt = new Date().toISOString();
  const usages: CaseUsage[] = [];
  const results: CaseResult[] = await mapPool(cases, options.concurrency, async (goldenCase) => {
    const start = Date.now();
    const { checks, output, events } = await gradeCase(goldenCase, options.judge);
    usages.push({
      events,
      judgeCalls: checks.filter((c) => c.name.startsWith('judge:') && c.status !== 'skipped')
        .length,
    });
    if (goldenCase.expectedFailure) {
      checks.push({
        name: 'expected-failure',
        status: 'skipped',
        detail: goldenCase.expectedFailure.reason,
      });
    }
    const status = caseStatus(goldenCase, checks);
    const durationMs = Date.now() - start;
    console.log(`  ${statusGlyph(status)} ${goldenCase.id} (${(durationMs / 1000).toFixed(1)}s)`);
    return {
      id: goldenCase.id,
      feature: goldenCase.feature,
      status,
      durationMs,
      checks,
      output,
    };
  });

  const evalResults = buildResults(results, {
    threshold: options.threshold,
    model: MODEL,
    startedAt,
  });
  console.log(`\n${renderScorecard(evalResults)}`);
  console.log(`\n${renderUsage(usageOf(usages))}\n`);
  writeResults(path.join(dir, 'results.json'), evalResults);
  console.log(`Results written to eval/results.json`);

  const failed = evalResults.summary.inconclusive || evalResults.summary.score < options.threshold;

  // A timed-out case leaves its resolver fetch un-aborted (the production
  // resolvers expose no AbortController), and that open socket would hold the
  // event loop long past the verdict — force the exit in that rare path. All
  // output above is already written synchronously.
  const sawTimeout = results.some((r) =>
    r.checks.some((c) => c.detail.includes('timed out after')),
  );
  if (sawTimeout) process.exit(failed ? 1 : 0);
  return failed ? 1 : 0;
}

export function statusGlyph(status: CaseStatus): string {
  switch (status) {
    case 'pass':
      return '✓';
    case 'known-failure':
      return '~';
    case 'error':
      return '!';
    default:
      return '✗';
  }
}

runAsScript(import.meta.url, main);

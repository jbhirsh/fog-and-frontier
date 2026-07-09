// CLI entry for the Gemini output-quality eval (issue #122). Calls the
// production resolvers directly with a fabricated owner context (the same
// trick api/graphql.test.ts uses), grades each golden case mechanically —
// judge calls only where prose plausibility can't be checked in code — and
// exits non-zero when the score drops below the threshold or the run is
// inconclusive. Paid gemini-2.5-flash calls: not part of `npm test`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GqlContext } from '../api/_gqlContext.js';
import { geminiMutation, geminiQuery } from '../api/_resolvers/gemini.js';
import {
  checkAlltrails,
  checkDiscoverStructural,
  checkGenerateGraceful,
  checkGenerateHappy,
  classifyGeminiError,
} from './checks.js';
import { judgeDescriptions, judgeDiscoverEvents, judgeRealPlace } from './judge.js';
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

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'gemini-2.5-flash';

// The server gate is requireOwnerCtx, which only inspects this object — no
// Clerk or DB involved, so a fabricated owner is enough to call resolvers.
const CTX: GqlContext = { caller: { email: 'eval@local', role: 'owner' } };

// --- CLI / env ---------------------------------------------------------------

interface CliOptions {
  only: string[] | null;
  feature: Feature | null;
  threshold: number;
}

function parseArgs(argv: string[]): CliOptions {
  let only: string[] | null = null;
  let feature: Feature | null = null;
  let threshold = DEFAULT_THRESHOLD;

  const envThreshold = process.env.EVAL_THRESHOLD;
  if (envThreshold) threshold = Number(envThreshold);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--only') {
      const value = argv[++i];
      if (!value) exitConfig('--only requires a comma-separated list of case ids');
      only = value.split(',').map((s) => s.trim()).filter(Boolean);
      if (only.length === 0) exitConfig('--only requires at least one case id');
    } else if (arg === '--feature') {
      const value = argv[++i];
      if (!value) exitConfig('--feature requires a value');
      feature = value as Feature;
    } else if (arg === '--threshold') {
      threshold = Number(argv[++i]);
    } else {
      exitConfig(`unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    exitConfig(`threshold must be a fraction in (0, 1], got: ${threshold}`);
  }
  if (feature && !['generateActivity', 'alltrailsLookup', 'discover'].includes(feature)) {
    exitConfig(`unknown feature: ${feature}`);
  }
  return { only, feature, threshold };
}

function exitConfig(message: string): never {
  console.error(`eval: ${message}`);
  process.exit(2);
}

// Best-effort local-dev key pickup: real env always wins, and only this one
// variable is read — not a general dotenv load.
function ensureApiKey(): void {
  if (process.env.GEMINI_API_KEY) return;
  for (const file of ['.env.local', '.env']) {
    const p = path.join(EVAL_DIR, '..', file);
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

function loadGoldenSet(): GoldenSet {
  const raw = readFileSync(path.join(EVAL_DIR, 'golden-set.json'), 'utf8');
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
      exitConfig(`golden case is missing id/feature/input/expect/notes: ${JSON.stringify(c).slice(0, 120)}`);
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
      if (typeof c.input.title !== 'string' || !c.input.title) bad('input.title must be a non-empty string');
      if ('graceful' in c.expect) {
        if (!Array.isArray(c.expect.graceful?.allowedErrors)) bad('graceful.allowedErrors must be an array');
        if (c.expect.graceful.ifReturned === undefined) bad('graceful.ifReturned must be null or an object');
      }
      break;
    }
    case 'alltrailsLookup': {
      if (typeof c.input.url !== 'string' || !c.input.url) bad('input.url must be a non-empty string');
      if (!('lookup' in c.expect) && !('graceful' in c.expect)) bad('expect needs a lookup or graceful variant');
      break;
    }
    case 'discover': {
      if (!['today', 'tomorrow', 'week', 'weekend'].includes(c.input.range)) bad('input.range invalid');
      if (typeof c.expect.structural?.minEvents !== 'number') bad('expect.structural.minEvents missing');
      if (typeof c.expect.judgeEvents?.minPlausibleFraction !== 'number') bad('expect.judgeEvents.minPlausibleFraction missing');
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
    }
  };
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`case timed out after ${CASE_TIMEOUT_MS}ms`)), CASE_TIMEOUT_MS).unref();
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

async function gradeCase(
  goldenCase: GoldenCase,
): Promise<{ checks: CheckResult[]; output: unknown }> {
  const outcome = await callResolver(goldenCase);
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
          checks.push(await judgeRealPlace(outcome.value));
        }
        break;
      }
      const gate = resolvedCheck(outcome);
      checks.push(gate);
      if (gate.status !== 'pass' || !outcome.ok) break;
      checks.push(...checkGenerateHappy(outcome.value, goldenCase.expect));
      // Judges are paid calls — skip when a mechanical check already failed
      // the case; the verdict can't change.
      if (goldenCase.expect.judgeDescriptions && noFailures(checks)) {
        const context = `Requested activity: ${goldenCase.input.title}. Known facts: ${goldenCase.notes}`;
        checks.push(await judgeDescriptions(outcome.value, context));
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
      checks.push(...checkDiscoverStructural(outcome.value, goldenCase.expect, goldenCase.input.range, new Date()));
      if (noFailures(checks)) {
        checks.push(await judgeDiscoverEvents(outcome.value, goldenCase.expect.judgeEvents.minPlausibleFraction));
      }
      break;
    }
  }
  return { checks, output };
}

function noFailures(checks: CheckResult[]): boolean {
  return !checks.some((c) => c.status === 'fail');
}

function caseStatus(goldenCase: GoldenCase, checks: CheckResult[]): CaseStatus {
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  ensureApiKey();
  const goldenSet = loadGoldenSet();

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
  if (cases.length === 0) exitConfig('no cases selected');

  console.log(`Gemini output-quality eval — ${cases.length} case(s), threshold ${options.threshold * 100}%`);
  console.log(`Golden set: ${goldenSet._meta.status}\n`);

  const startedAt = new Date().toISOString();
  const results: CaseResult[] = [];
  for (const goldenCase of cases) {
    const start = Date.now();
    const { checks, output } = await gradeCase(goldenCase);
    if (goldenCase.expectedFailure) {
      checks.push({
        name: 'expected-failure',
        status: 'skipped',
        detail: goldenCase.expectedFailure.reason,
      });
    }
    const status = caseStatus(goldenCase, checks);
    const durationMs = Date.now() - start;
    results.push({
      id: goldenCase.id,
      feature: goldenCase.feature,
      status,
      durationMs,
      checks,
      output,
    });
    console.log(`  ${statusGlyph(status)} ${goldenCase.id} (${(durationMs / 1000).toFixed(1)}s)`);
  }

  const evalResults = buildResults(results, {
    threshold: options.threshold,
    model: MODEL,
    startedAt,
  });
  console.log(`\n${renderScorecard(evalResults)}`);
  writeResults(path.join(EVAL_DIR, 'results.json'), evalResults);
  console.log(`Results written to eval/results.json`);

  const failed =
    evalResults.summary.inconclusive || evalResults.summary.score < options.threshold;
  process.exitCode = failed ? 1 : 0;

  // A timed-out case leaves its resolver fetch un-aborted (the production
  // resolvers expose no AbortController), and that open socket would hold the
  // event loop long past the verdict — force the exit in that rare path. All
  // output above is already written synchronously.
  const sawTimeout = results.some((r) =>
    r.checks.some((c) => c.detail.includes('timed out after')),
  );
  if (sawTimeout) process.exit(failed ? 1 : 0);
}

function statusGlyph(status: CaseStatus): string {
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

await main();

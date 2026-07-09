// The shared contract for the Gemini output-quality eval harness (issue #122).
// checks.ts, judge.ts, report.ts, and run-eval.ts all code against these
// shapes, and eval/golden-set.json must deserialize into GoldenSet. Frozen
// before the modules were built in parallel — extend, don't reshape.

export type Feature = 'generateActivity' | 'alltrailsLookup' | 'discover';
export type DiscoverRange = 'today' | 'tomorrow' | 'week' | 'weekend';

// --- golden-set shapes -------------------------------------------------------

// GraphQL error codes an adversarial case may accept as graceful behavior
// (see api/_gqlError.ts): BAD_GATEWAY = upstream/parity failure, BAD_USER_INPUT
// = input rejected before any paid call.
export type GracefulErrorCode = 'BAD_GATEWAY' | 'BAD_USER_INPUT';

export interface GeoExpectation {
  lat: number;
  lng: number;
  toleranceKm: number;
}

export interface NumericRange {
  min?: number;
  max?: number;
  /** true → a null value for this field also passes */
  nullable?: boolean;
}

export interface GenerateHappyExpect {
  /** accept-any-of value sets; an omitted field is not graded */
  category?: string[];
  region?: string[];
  parkType?: string[];
  duration?: string[];
  /** accept-any-of, matched case-insensitively */
  city?: string[];
  geo?: GeoExpectation;
  /** run the description-plausibility judge on short/longDescription */
  judgeDescriptions?: boolean;
  /** food cases: cuisine and priceRange must be present */
  restaurantFields?: boolean;
}

export interface GenerateGracefulExpect {
  graceful: {
    allowedErrors: GracefulErrorCode[];
    /**
     * null → returning any object at all fails the case (pure-nonsense input
     * must not be resolved into a record); otherwise a returned object must
     * satisfy these requirements (honest coordinates for an out-of-region
     * place, or a judge-verified real place for a vague prompt).
     */
    ifReturned: null | { geo?: GeoExpectation; judgeRealPlace?: boolean };
  };
}

export type GenerateExpect = GenerateHappyExpect | GenerateGracefulExpect;

export interface AlltrailsRangesExpect {
  lookup: {
    allTrailsRating?: NumericRange;
    hikeDistanceMiles?: NumericRange;
    hikeElevationFeet?: NumericRange;
  };
}

export interface AlltrailsGracefulExpect {
  graceful: {
    /** unknown trail: every lookup field must come back null */
    allNull?: true;
    allowedErrors?: GracefulErrorCode[];
  };
}

export type AlltrailsExpect = AlltrailsRangesExpect | AlltrailsGracefulExpect;

export interface DiscoverExpect {
  structural: {
    minEvents: number;
    maxEvents: number;
    /** fraction of events with non-null name, startDate, AND sourceUrl */
    minFieldCoverage: number;
  };
  /** events must overlap the requested window (±1 day slack on both edges) */
  datesWithinRange: boolean;
  /** no two events may share a normalized name */
  dedupe: boolean;
  judgeEvents: { minPlausibleFraction: number };
}

interface GoldenCaseBase {
  /** unique; prefixed gen- / at- / disc- by feature */
  id: string;
  kind: 'happy' | 'adversarial';
  /**
   * xfail: the case is EXPECTED to fail against current model behavior. A
   * predicted failure counts as pass for the threshold and is reported as a
   * KNOWN FINDING; an unexpected pass fails the case — behavior changed and
   * the golden set needs review. Transparent annotation, not tuning: the case
   * stays listed as a finding in README/PR.
   */
  expectedFailure?: { reason: string };
  /** human context — must cite coordinate/data provenance + as-of date */
  notes: string;
}

export interface GenerateCase extends GoldenCaseBase {
  feature: 'generateActivity';
  input: { title: string; notes?: string };
  expect: GenerateExpect;
}

export interface AlltrailsCase extends GoldenCaseBase {
  feature: 'alltrailsLookup';
  input: { url: string };
  expect: AlltrailsExpect;
}

export interface DiscoverCase extends GoldenCaseBase {
  feature: 'discover';
  input: { range: DiscoverRange };
  expect: DiscoverExpect;
}

export type GoldenCase = GenerateCase | AlltrailsCase | DiscoverCase;

export interface GoldenSet {
  _meta: {
    /** stays "DRAFT — pending owner review" until the repo owner verifies */
    status: string;
    coordinateSources: string;
    authoredAt: string;
  };
  cases: GoldenCase[];
}

// --- grading shapes ----------------------------------------------------------

export type CheckStatus = 'pass' | 'fail' | 'error' | 'skipped';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** Outcome of one resolver call, before grading. */
export type ResolverOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown };

/**
 * error           — infrastructure failure (transport 5xx, judge died after
 *                   retry, per-case timeout): excluded from the score
 *                   denominator and reported loudly, so infra flake can't
 *                   fail CI while quality failures still do.
 * known-failure   — failed as predicted by expectedFailure (scores as pass).
 * unexpected-pass — passed despite expectedFailure (scores as fail).
 */
export type CaseStatus =
  | 'pass'
  | 'fail'
  | 'error'
  | 'known-failure'
  | 'unexpected-pass';

export interface CaseResult {
  id: string;
  feature: Feature;
  status: CaseStatus;
  durationMs: number;
  checks: CheckResult[];
  /** raw resolver return or serialized error — the debugging payload */
  output: unknown;
}

export interface SurfaceSummary {
  total: number;
  graded: number;
  passed: number;
  failed: number;
  errored: number;
}

export interface EvalSummary extends SurfaceSummary {
  /** passed / graded (0 when nothing was graded) */
  score: number;
  /**
   * graded < GRADED_FLOOR × total: mass infra errors collapsed the
   * denominator, so the ratio can't be trusted — the run exits non-zero
   * regardless of score.
   */
  inconclusive: boolean;
  bySurface: Record<Feature, SurfaceSummary>;
}

export interface EvalResults {
  startedAt: string;
  gitSha: string | null;
  model: string;
  threshold: number;
  summary: EvalSummary;
  cases: CaseResult[];
}

// --- shared constants --------------------------------------------------------

export const DEFAULT_THRESHOLD = 0.9;
/** minimum fraction of cases that must be graded for a conclusive run */
export const GRADED_FLOOR = 0.8;
/** per-case wall-clock budget for the resolver call */
export const CASE_TIMEOUT_MS = 90_000;

// Scoring aggregation, scorecard rendering, and results persistence for the
// Gemini output-quality eval (issue #122). Pure except for the two functions
// that touch git (resolveGitSha) and the filesystem (writeResults).

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { GRADED_FLOOR } from './types.js';
import type {
  CaseResult,
  EvalResults,
  EvalSummary,
  Feature,
  SurfaceSummary,
} from './types.js';

const FEATURES: Feature[] = ['generateActivity', 'alltrailsLookup', 'discover'];

// --- git provenance ----------------------------------------------------------

/**
 * Current commit SHA for the results file. Prefers the local git HEAD; when git
 * is unavailable (e.g. a checkout-less CI runner) falls back to GITHUB_SHA.
 */
export function resolveGitSha(): string | null {
  try {
    // stderr suppressed so a "not a git repository" message never leaks into
    // the scorecard's console output.
    return execSync('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return process.env.GITHUB_SHA ?? null;
  }
}

// --- scoring -----------------------------------------------------------------

function tally(cases: CaseResult[]): SurfaceSummary {
  const total = cases.length;
  let passed = 0;
  let failed = 0;
  let errored = 0;
  for (const c of cases) {
    // xfail scoring: a case that failed as predicted ('known-failure') counts
    // as passed; one that passed despite the prediction ('unexpected-pass')
    // counts as failed. 'error' is infrastructure flake — excluded from grading.
    if (c.status === 'error') {
      errored += 1;
    } else if (c.status === 'pass' || c.status === 'known-failure') {
      passed += 1;
    } else {
      failed += 1;
    }
  }
  const graded = total - errored;
  return { total, graded, passed, failed, errored };
}

function surfaceScore(s: SurfaceSummary): number {
  return s.graded === 0 ? 0 : s.passed / s.graded;
}

function summarize(cases: CaseResult[]): EvalSummary {
  const overall = tally(cases);
  const bySurface: Record<Feature, SurfaceSummary> = {
    generateActivity: tally(cases.filter(c => c.feature === 'generateActivity')),
    alltrailsLookup: tally(cases.filter(c => c.feature === 'alltrailsLookup')),
    discover: tally(cases.filter(c => c.feature === 'discover')),
  };
  return {
    ...overall,
    score: surfaceScore(overall),
    // Mass infra errors collapse the denominator, so the ratio can't be
    // trusted — the run must exit non-zero regardless of score.
    inconclusive: overall.graded < GRADED_FLOOR * overall.total,
    bySurface,
  };
}

export function buildResults(
  cases: CaseResult[],
  opts: { threshold: number; model: string; startedAt: string },
): EvalResults {
  return {
    startedAt: opts.startedAt,
    gitSha: resolveGitSha(),
    model: opts.model,
    threshold: opts.threshold,
    summary: summarize(cases),
    cases,
  };
}

// --- rendering ---------------------------------------------------------------

/** Score / percentage with one decimal, e.g. 94.7% or 100.0%. */
function pct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Threshold percentage without trailing zeros, e.g. 90% or 92.5%. */
function pctTrim(v: number): string {
  return `${Math.round(v * 1000) / 10}%`;
}

interface Column {
  head: string;
  width: number;
  align: 'left' | 'right';
}

const COLS: Column[] = [
  { head: 'SURFACE', width: 18, align: 'left' },
  { head: 'GRADED', width: 8, align: 'right' },
  { head: 'PASSED', width: 8, align: 'right' },
  { head: 'FAILED', width: 8, align: 'right' },
  { head: 'ERRORED', width: 9, align: 'right' },
  { head: 'SCORE', width: 9, align: 'right' },
];

const TABLE_WIDTH = COLS.reduce((sum, col) => sum + col.width, 0);

function row(cells: string[]): string {
  return cells
    .map((cell, i) => {
      const col = COLS[i];
      return col.align === 'left'
        ? cell.padEnd(col.width)
        : cell.padStart(col.width);
    })
    .join('');
}

function surfaceRow(label: string, s: SurfaceSummary): string {
  return row([
    label,
    String(s.graded),
    String(s.passed),
    String(s.failed),
    String(s.errored),
    pct1(surfaceScore(s)),
  ]);
}

/**
 * The runner records the expected-failure reason in one of the case's checks;
 * pull it back out for the KNOWN FINDING line. Prefers a check whose name
 * flags it as the xfail marker, then any failing check, then any detail.
 */
function xfailReason(c: CaseResult): string {
  const named = c.checks.find(chk =>
    /xfail|expected[-\s]?failure|known/i.test(chk.name),
  );
  if (named?.detail) return named.detail;
  const failing = c.checks.find(
    chk => chk.status === 'fail' || chk.status === 'error',
  );
  if (failing?.detail) return failing.detail;
  return c.checks.find(chk => chk.detail)?.detail ?? '(reason not recorded)';
}

/** Single-line, length-capped JSON of the raw resolver output for debugging. */
function outputSnippet(value: unknown, max = 500): string {
  let s: string;
  try {
    const json = JSON.stringify(value);
    s = json === undefined ? String(value) : json;
  } catch {
    // circular structures etc.
    s = String(value);
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function renderScorecard(results: EvalResults): string {
  const { summary } = results;
  const lines: string[] = [];

  // Header.
  const sha = results.gitSha ? results.gitSha.slice(0, 7) : 'unknown';
  lines.push('Gemini output-quality eval');
  lines.push(
    `model ${results.model}   commit ${sha}   started ${results.startedAt}   threshold ${pctTrim(results.threshold)}`,
  );
  lines.push('');

  // Loud banners up top so a CI reader sees trouble before any detail. The
  // inconclusive banner is bordered ("louder") because it forces a non-zero
  // exit regardless of score.
  if (summary.errored > 0) {
    lines.push(
      `⚠ ${summary.errored} case(s) errored (infrastructure) — excluded from score`,
    );
  }
  if (summary.inconclusive) {
    const border = '═'.repeat(TABLE_WIDTH);
    lines.push(border);
    lines.push(
      `✖ RUN INCONCLUSIVE: only ${summary.graded}/${summary.total} cases graded (< 80%) — exit will be non-zero regardless of score`,
    );
    lines.push(border);
  }
  if (summary.errored > 0 || summary.inconclusive) lines.push('');

  // Per-surface table + TOTAL.
  const divider = '─'.repeat(TABLE_WIDTH);
  lines.push(row(COLS.map(col => col.head)));
  lines.push(divider);
  for (const f of FEATURES) {
    lines.push(surfaceRow(f, summary.bySurface[f]));
  }
  lines.push(divider);
  lines.push(surfaceRow('TOTAL', summary));
  lines.push('');

  // Expected failures — reported transparently, never silently tuned away.
  const known = results.cases.filter(c => c.status === 'known-failure');
  for (const c of known) {
    lines.push(`KNOWN FINDING (expected failure): ${c.id} — ${xfailReason(c)}`);
  }
  if (known.length > 0) lines.push('');

  // Errored cases — surfaced with detail so infra flake stays debuggable
  // rather than vanishing behind a bare count.
  const errored = results.cases.filter(c => c.status === 'error');
  if (errored.length > 0) {
    lines.push('ERRORED CASES (infrastructure — excluded from score)');
    for (const c of errored) {
      lines.push('');
      lines.push(`• ${c.id} [${c.feature}]`);
      for (const chk of c.checks.filter(
        chk => chk.status === 'error' || chk.status === 'fail',
      )) {
        lines.push(`  ✗ ${chk.name}: ${chk.detail}`);
      }
      lines.push(`  output: ${outputSnippet(c.output)}`);
    }
    lines.push('');
  }

  // Findings — genuine quality failures that count against the score.
  const findings = results.cases.filter(
    c => c.status === 'fail' || c.status === 'unexpected-pass',
  );
  if (findings.length > 0) {
    lines.push('FINDINGS');
    for (const c of findings) {
      lines.push('');
      lines.push(`✗ ${c.id} [${c.feature}]`);
      const bad = c.checks.filter(
        chk => chk.status === 'fail' || chk.status === 'error',
      );
      if (bad.length === 0) {
        lines.push(
          c.status === 'unexpected-pass'
            ? '  ✗ unexpected pass — case was expected to fail; golden set needs review'
            : '  ✗ (no failing check recorded)',
        );
      } else {
        for (const chk of bad) {
          lines.push(`  ✗ ${chk.name}: ${chk.detail}`);
        }
      }
      lines.push(`  output: ${outputSnippet(c.output)}`);
    }
    lines.push('');
  }

  // Verdict. Inconclusive always fails, even when the raw ratio clears the bar.
  const pass = !summary.inconclusive && summary.score >= results.threshold;
  lines.push(
    `SCORE: ${pct1(summary.score)} (${summary.passed}/${summary.graded} graded, threshold ${pctTrim(results.threshold)}) → ${pass ? 'PASS' : 'FAIL'}`,
  );

  return `${lines.join('\n')}\n`;
}

// --- persistence -------------------------------------------------------------

export function writeResults(filePath: string, results: EvalResults): void {
  writeFileSync(filePath, `${JSON.stringify(results, null, 2)}\n`);
}

// Unit tests for the pure scoring aggregation in eval/report.ts — specifically
// the xfail tallying rules (known-failure scores as pass, unexpected-pass as
// fail) and the inconclusive floor, per the #123 review.

import { describe, expect, it } from 'vitest';
import { buildResults } from './report.js';
import type { CaseResult, CaseStatus, Feature } from './types.js';

const OPTS = { threshold: 0.9, model: 'test-model', startedAt: '2026-07-18T00:00:00.000Z' };

function caseResult(feature: Feature, status: CaseStatus, id: string): CaseResult {
  return { id, feature, status, durationMs: 1, checks: [], output: null };
}

describe('xfail tallying (buildResults summary)', () => {
  it('counts known-failure as passed, unexpected-pass as failed, and excludes errors', () => {
    const { summary } = buildResults(
      [
        caseResult('generateActivity', 'pass', 'gen-ok'),
        caseResult('generateActivity', 'known-failure', 'gen-xfail'),
        caseResult('alltrailsLookup', 'unexpected-pass', 'at-surprise'),
        caseResult('discover', 'fail', 'disc-bad'),
        caseResult('discover', 'error', 'disc-flake'),
      ],
      OPTS,
    );

    expect(summary).toMatchObject({
      total: 5,
      graded: 4, // the errored case is out of the denominator
      passed: 2, // pass + known-failure
      failed: 2, // fail + unexpected-pass
      errored: 1,
    });
    expect(summary.score).toBe(0.5);
    // 4/5 graded sits exactly on the 80% floor — still conclusive.
    expect(summary.inconclusive).toBe(false);

    // Per-surface tallies apply the same rules.
    expect(summary.bySurface.generateActivity).toEqual({
      total: 2, graded: 2, passed: 2, failed: 0, errored: 0,
    });
    expect(summary.bySurface.alltrailsLookup).toEqual({
      total: 1, graded: 1, passed: 0, failed: 1, errored: 0,
    });
    expect(summary.bySurface.discover).toEqual({
      total: 2, graded: 1, passed: 0, failed: 1, errored: 1,
    });
  });

  it('scores a fully-predicted run as 100%', () => {
    const { summary } = buildResults(
      [
        caseResult('generateActivity', 'pass', 'gen-ok'),
        caseResult('generateActivity', 'known-failure', 'gen-xfail'),
      ],
      OPTS,
    );
    expect(summary.score).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('flags the run inconclusive when errors collapse graded below the 80% floor', () => {
    const { summary } = buildResults(
      [
        caseResult('generateActivity', 'pass', 'gen-1'),
        caseResult('generateActivity', 'pass', 'gen-2'),
        caseResult('alltrailsLookup', 'pass', 'at-1'),
        caseResult('discover', 'error', 'disc-1'),
        caseResult('discover', 'error', 'disc-2'),
      ],
      OPTS,
    );
    expect(summary.graded).toBe(3); // 3/5 < 80%
    expect(summary.inconclusive).toBe(true);
    // The raw ratio is perfect — inconclusiveness must not depend on it.
    expect(summary.score).toBe(1);
  });
});

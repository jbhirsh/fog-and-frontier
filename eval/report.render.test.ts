// The scorecard, the results file and the commit they name, from
// eval/report.ts. Scoring itself is tested in report.test.ts.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildResults, renderScorecard, writeResults } from './report.js';
import type { CaseResult, CaseStatus, CheckResult, Feature } from './types.js';

const git = vi.hoisted(() => ({ execSync: vi.fn(() => Buffer.from('0123456789abcdef\n')) }));
vi.mock('node:child_process', () => ({ execSync: git.execSync }));

afterEach(() => {
  vi.unstubAllEnvs();
  git.execSync.mockImplementation(() => Buffer.from('0123456789abcdef\n'));
});

const OPTS = { threshold: 0.9, model: 'test-model', startedAt: '2026-07-18T00:00:00.000Z' };
const check = (name: string, status: CheckResult['status'], detail: string): CheckResult => ({
  name,
  status,
  detail,
});
const caseResult = (
  id: string,
  status: CaseStatus,
  checks: CheckResult[] = [],
  output: unknown = null,
  feature: Feature = 'generateActivity',
): CaseResult => ({ id, feature, status, durationMs: 1, checks, output });

describe('buildResults', () => {
  it("names the commit from git, else GitHub's SHA, else none", () => {
    expect(buildResults([], OPTS).gitSha).toBe('0123456789abcdef');
    git.execSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    vi.stubEnv('GITHUB_SHA', 'fedcba');
    expect(buildResults([], OPTS).gitSha).toBe('fedcba');
    vi.stubEnv('GITHUB_SHA', undefined);
    expect(buildResults([], OPTS).gitSha).toBeNull();
  });
});

describe('renderScorecard', () => {
  it('prints the whole card for a plain passing run, with no banner or gap above the table', () => {
    expect(renderScorecard(buildResults([caseResult('gen-ok', 'pass')], OPTS))).toBe(
      [
        'Gemini output-quality eval',
        'model test-model   commit 0123456   started 2026-07-18T00:00:00.000Z   threshold 90%',
        '',
        'SURFACE             GRADED  PASSED  FAILED  ERRORED    SCORE',
        '─'.repeat(60),
        'generateActivity         1       1       0        0   100.0%',
        'alltrailsLookup          0       0       0        0     0.0%',
        'discover                 0       0       0        0     0.0%',
        'tripSuggestions          0       0       0        0     0.0%',
        '─'.repeat(60),
        'TOTAL                    1       1       0        0   100.0%',
        '',
        'SCORE: 100.0% (1/1 graded, threshold 90%) → PASS',
        '',
      ].join('\n'),
    );
  });

  it('prints known findings and errored cases in full, each surface counting only its own', () => {
    const card = renderScorecard(
      buildResults(
        [
          caseResult('gen-ok', 'pass'),
          caseResult('trip-ok', 'pass', [], null, 'tripSuggestions'),
          caseResult('gen-k1', 'known-failure', [
            check('city', 'pass', 'first detail'),
            check('name', 'error', 'judge timed out'),
          ]),
          caseResult('gen-k2', 'known-failure', [check('expectedfailure', 'skipped', 'no dash')]),
          caseResult('gen-k3', 'known-failure', [
            check('expected failure', 'skipped', 'with a space'),
          ]),
          caseResult(
            'disc-err',
            'error',
            [
              check('resolved', 'error', 'HTTP 503'),
              check('shape', 'fail', 'no places'),
              check('ok', 'pass', 'fine'),
            ],
            '  padded\t text  ',
            'discover',
          ),
        ],
        OPTS,
      ),
    );
    expect(card).toBe(
      [
        'Gemini output-quality eval',
        'model test-model   commit 0123456   started 2026-07-18T00:00:00.000Z   threshold 90%',
        '',
        '⚠ 1 case(s) errored (infrastructure) — excluded from score',
        '',
        'SURFACE             GRADED  PASSED  FAILED  ERRORED    SCORE',
        '─'.repeat(60),
        'generateActivity         4       4       0        0   100.0%',
        'alltrailsLookup          0       0       0        0     0.0%',
        'discover                 0       0       0        1     0.0%',
        'tripSuggestions          1       1       0        0   100.0%',
        '─'.repeat(60),
        'TOTAL                    5       5       0        1   100.0%',
        '',
        'KNOWN FINDING (expected failure): gen-k1 — judge timed out',
        'KNOWN FINDING (expected failure): gen-k2 — no dash',
        'KNOWN FINDING (expected failure): gen-k3 — with a space',
        '',
        'ERRORED CASES (infrastructure — excluded from score)',
        '',
        '• disc-err [discover]',
        '  ✗ resolved: HTTP 503',
        '  ✗ shape: no places',
        '  output: " padded\\t text "',
        '',
        'SCORE: 100.0% (5/5 graded, threshold 90%) → PASS',
        '',
      ].join('\n'),
    );
  });

  it('passes a score exactly at the bar, and trims what String() makes of an unprintable output', () => {
    const loop: Record<string, unknown> = { toString: () => '  loop \n output  ' };
    loop.self = loop;
    const card = renderScorecard(
      buildResults(
        [
          caseResult('gen-ok', 'pass'),
          caseResult('gen-bad', 'fail', [check('city', 'fail', 'wrong')], loop),
          caseResult('gen-ok2', 'pass'),
          // 500 characters once quoted: exactly the cap, so printed whole.
          caseResult('gen-long', 'fail', [check('city', 'fail', 'wrong')], 'y'.repeat(498)),
        ],
        { ...OPTS, threshold: 0.5 },
      ),
    );
    expect(card).toContain('  output: loop output\n');
    expect(card).toContain(`  output: "${'y'.repeat(498)}"\n`);
    expect(card).toContain('SCORE: 50.0% (2/4 graded, threshold 50%) → PASS');
    expect(git.execSync).toHaveBeenCalledWith('git rev-parse HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it('heads the card with the run, tables each surface, and passes a score over the bar', () => {
    const card = renderScorecard(buildResults([caseResult('gen-ok', 'pass')], OPTS));
    expect(card).toContain(
      'model test-model   commit 0123456   started 2026-07-18T00:00:00.000Z   threshold 90%',
    );
    expect(card).toContain('generateActivity         1       1       0        0   100.0%');
    expect(card).toContain('discover                 0       0       0        0     0.0%');
    expect(card.trimEnd().split('\n').at(-1)).toBe(
      'SCORE: 100.0% (1/1 graded, threshold 90%) → PASS',
    );
    expect(card).not.toContain('FINDINGS');
    expect(card).not.toContain('⚠');
  });

  it("names a run's commit unknown without one, and trims the threshold", () => {
    git.execSync.mockImplementation(() => {
      throw new Error('no git');
    });
    // CI sets GITHUB_SHA, which the report falls back to without git.
    vi.stubEnv('GITHUB_SHA', undefined);
    const card = renderScorecard(buildResults([], { ...OPTS, threshold: 0.925 }));
    expect(card).toContain('commit unknown');
    expect(card).toContain('threshold 92.5%');
  });

  it('lists each finding with its failing checks and output, and fails under the bar', () => {
    const card = renderScorecard(
      buildResults(
        [
          caseResult('gen-ok', 'pass'),
          caseResult(
            'gen-bad',
            'fail',
            [check('city', 'fail', 'expected Oakland'), check('name', 'pass', 'ok')],
            { name: 'Lake\n  Merritt' },
          ),
          caseResult('gen-surprise', 'unexpected-pass', [check('name', 'pass', 'ok')]),
          caseResult('gen-silent', 'fail', []),
        ],
        OPTS,
      ),
    );
    expect(card).toContain(
      'FINDINGS\n\n✗ gen-bad [generateActivity]\n  ✗ city: expected Oakland\n',
    );
    expect(card).toContain('  output: {"name":"Lake\\n Merritt"}');
    expect(card).toContain(
      '✗ gen-surprise [generateActivity]\n  ✗ unexpected pass — case was expected to fail; golden set needs review',
    );
    expect(card).toContain('✗ gen-silent [generateActivity]\n  ✗ (no failing check recorded)');
    expect(card).toContain('SCORE: 25.0% (1/4 graded, threshold 90%) → FAIL');
  });

  it('gives a known failure its recorded reason', () => {
    const reasons = (checks: CheckResult[]) =>
      renderScorecard(buildResults([caseResult('gen-x', 'known-failure', checks)], OPTS));
    expect(
      reasons([
        check('city', 'fail', 'wrong city'),
        check('expected-failure', 'skipped', 'schema forces a record'),
      ]),
    ).toContain('KNOWN FINDING (expected failure): gen-x — schema forces a record');
    expect(reasons([check('ok', 'pass', ''), check('city', 'fail', 'wrong city')])).toContain(
      '— wrong city',
    );
    expect(reasons([check('ok', 'pass', 'resolver returned')])).toContain('— resolver returned');
    expect(reasons([])).toContain('— (reason not recorded)');
  });

  it('warns of errored cases, details each, and calls a run with too few graded inconclusive', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const card = renderScorecard(
      buildResults(
        [
          caseResult('gen-ok', 'pass'),
          caseResult(
            'disc-1',
            'error',
            [check('resolved', 'error', 'HTTP 503')],
            circular,
            'discover',
          ),
          // Nothing JSON can write: printed as it is.
          caseResult('disc-2', 'error', [], Symbol('no output'), 'discover'),
          caseResult('disc-3', 'error', [], 'x'.repeat(600), 'discover'),
        ],
        OPTS,
      ),
    );
    expect(card).toContain('⚠ 3 case(s) errored (infrastructure) — excluded from score');
    expect(card).toContain('✖ RUN INCONCLUSIVE: only 1/4 cases graded (< 80%)');
    expect(card).toContain(
      '• disc-1 [discover]\n  ✗ resolved: HTTP 503\n  output: [object Object]',
    );
    expect(card).toContain('• disc-2 [discover]\n  output: Symbol(no output)');
    expect(card).toContain(`  output: "${'x'.repeat(499)}…`);
    // A perfect ratio still fails an inconclusive run.
    expect(card).toContain('SCORE: 100.0% (1/1 graded, threshold 90%) → FAIL');
  });
});

describe('writeResults', () => {
  it('writes the results as indented JSON', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'eval-')), 'results.json');
    const results = buildResults([caseResult('gen-ok', 'pass')], OPTS);
    writeResults(file, results);
    expect(readFileSync(file, 'utf8')).toBe(`${JSON.stringify(results, null, 2)}\n`);
  });
});

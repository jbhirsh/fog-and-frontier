import { describe, expect, it } from 'vitest';
import { LABEL, MAX_BODY, decide, findIssue, fitBody, parseArgs, sync } from './tracking-issue.mjs';

describe('findIssue', () => {
  const issues = [
    { number: 3, title: 'Dead code (weekly audit)' },
    { number: 4, title: 'Dead code (weekly audit) extra' },
  ];

  it('finds the issue by its exact title', () => {
    expect(findIssue(issues, 'Dead code (weekly audit)')).toEqual(issues[0]);
  });

  it('ignores titles that only start the same, and finds nothing for none', () => {
    expect(findIssue(issues, 'Dead code')).toBeNull();
    expect(findIssue([], 'Dead code (weekly audit)')).toBeNull();
  });
});

describe('decide', () => {
  const existing = { number: 7, title: 't' };

  it('opens an issue for new findings, or updates the open one', () => {
    expect(decide({ findings: 2, existing: null })).toEqual({ kind: 'create' });
    expect(decide({ findings: 1, existing })).toEqual({ kind: 'update', number: 7 });
  });

  it('closes the open issue once a sweep is clean, and otherwise does nothing', () => {
    expect(decide({ findings: 0, existing })).toEqual({ kind: 'close', number: 7 });
    expect(decide({ findings: 0, existing: null })).toEqual({ kind: 'none' });
  });
});

describe('fitBody', () => {
  it('keeps a body that fits', () => {
    const body = 'x'.repeat(MAX_BODY);
    expect(fitBody(body, 'https://run')).toBe(body);
  });

  it('cuts a long body short and points at the run', () => {
    const fitted = fitBody('x'.repeat(MAX_BODY + 1), 'https://run');
    expect(fitted.startsWith('x'.repeat(MAX_BODY) + '\n\n…cut short.')).toBe(true);
    expect(fitted).toContain('The full report is in https://run.');
    expect(fitted).not.toContain('x'.repeat(MAX_BODY + 1));
  });

  it('cuts without a pointer when there is no run', () => {
    expect(fitBody('x'.repeat(MAX_BODY + 5))).toBe(`${'x'.repeat(MAX_BODY)}\n\n…cut short.`);
  });
});

describe('parseArgs', () => {
  it('reads the title, the count and the report', () => {
    expect(parseArgs(['--title', 'T', '--findings', '3', '--body-file', 'r.md'])).toEqual({
      title: 'T',
      findings: 3,
      bodyFile: 'r.md',
    });
  });

  it('needs no report when nothing was found', () => {
    expect(parseArgs(['--findings', '0', '--title', 'T'])).toEqual({
      title: 'T',
      findings: 0,
      bodyFile: undefined,
    });
  });

  it('refuses a bad command line', () => {
    expect(() => parseArgs(['--findings', '1'])).toThrow('--title is needed');
    expect(() => parseArgs(['--title', 'T'])).toThrow('whole number');
    expect(() => parseArgs(['--title', 'T', '--findings', '-1'])).toThrow('whole number');
    expect(() => parseArgs(['--title', 'T', '--findings', '1.5'])).toThrow('whole number');
    // An empty count (a failed step's output) or junk is refused, never read as 0.
    expect(() => parseArgs(['--title', 'T', '--findings', ''])).toThrow('whole number');
    expect(() => parseArgs(['--title', 'T', '--findings', ' '])).toThrow('whole number');
    expect(() => parseArgs(['--title', 'T', '--findings', '0x1'])).toThrow('whole number');
    expect(() => parseArgs(['--title', 'T', '--findings', '3 '])).toThrow('whole number');
    expect(() => parseArgs(['--title', 'T', '--findings', '2'])).toThrow('need --body-file');
    expect(() => parseArgs(['--title'])).toThrow('--title needs a value');
    expect(() => parseArgs(['--colour', 'red'])).toThrow('unknown option --colour');
  });
});

describe('sync', () => {
  const today = new Date('2026-10-26T06:00:00Z');
  const fakeGh = (open) => {
    const calls = [];
    const run = (args, input) => {
      calls.push({ args, input });
      return args[0] === 'issue' && args[1] === 'list' ? JSON.stringify(open) : '';
    };
    return { calls, run };
  };

  it('makes sure the label exists and lists only open labelled issues', () => {
    const gh = fakeGh([]);
    sync({ title: 'T', findings: 0 }, gh.run, today);
    expect(gh.calls[0].args.slice(0, 4)).toEqual(['label', 'create', LABEL, '--force']);
    expect(gh.calls[1].args).toEqual(
      expect.arrayContaining(['issue', 'list', '--label', LABEL, '--state', 'open']),
    );
  });

  it('opens a labelled issue with the report piped in', () => {
    const gh = fakeGh([{ number: 1, title: 'Other' }]);
    expect(sync({ title: 'T', findings: 2, body: 'report' }, gh.run, today)).toBe(
      'opened "T" (2 found)',
    );
    expect(gh.calls[2]).toEqual({
      args: ['issue', 'create', '--title', 'T', '--label', LABEL, '--body-file', '-'],
      input: 'report',
    });
  });

  it('rewrites the open issue with the latest report', () => {
    const gh = fakeGh([{ number: 9, title: 'T' }]);
    expect(sync({ title: 'T', findings: 1, body: 'new' }, gh.run, today)).toBe(
      'updated #9 (1 found)',
    );
    expect(gh.calls[2]).toEqual({ args: ['issue', 'edit', '9', '--body-file', '-'], input: 'new' });
  });

  it('closes the open issue with a dated comment once clean', () => {
    const gh = fakeGh([{ number: 9, title: 'T' }]);
    expect(sync({ title: 'T', findings: 0 }, gh.run, today)).toBe('closed #9');
    expect(gh.calls[2].args).toEqual([
      'issue',
      'close',
      '9',
      '--comment',
      'The 2026-10-26 weekly audit found nothing, so this is resolved.',
    ]);
  });

  it('touches no issue when clean with none open', () => {
    const gh = fakeGh([]);
    expect(sync({ title: 'T', findings: 0 }, gh.run, today)).toBe('nothing found for "T"');
    expect(gh.calls).toHaveLength(2);
  });
});

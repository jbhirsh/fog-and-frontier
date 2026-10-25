import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { narrow, scopeLines } from './mutation-incremental.mjs';

// A mutant on lines `start` to `end`, as Stryker's report places it.
const at = (id, start, end = start) => ({
  id,
  location: { start: { line: start, column: 1 }, end: { line: end, column: 5 } },
});

const report = {
  schemaVersion: '1.0',
  files: {
    'src/a.ts': { language: 'typescript', source: 'a', mutants: [at('1', 2), at('2', 9)] },
    'src/b.ts': { language: 'typescript', source: 'b', mutants: [at('3', 1)] },
    'src/c.ts': { language: 'typescript', source: 'c', mutants: [at('4', 1)] },
  },
  testFiles: { 'src/a.test.ts': { tests: [] } },
};

describe('scopeLines', () => {
  it("collects each file's ranges, a file named whole anywhere staying whole", () => {
    const lines = scopeLines([
      'src/a.ts:1-2',
      'src/a.ts:7-7',
      'src/b.ts',
      'src/b.ts:3-4',
      'src/c.ts:5-6',
      'src/c.ts',
    ]);
    expect(lines.get('src/a.ts')).toEqual([
      [1, 2],
      [7, 7],
    ]);
    expect(lines.get('src/b.ts')).toBeNull();
    expect(lines.get('src/c.ts')).toBeNull();
    expect(lines.has('src/d.ts')).toBe(false);
  });
});

describe('narrow', () => {
  it('drops the files out of scope and keeps a whole file whole', () => {
    const out = narrow(report, ['src/a.ts', 'src/c.ts']);
    expect(Object.keys(out.files)).toEqual(['src/a.ts', 'src/c.ts']);
    expect(out.files['src/a.ts']).toBe(report.files['src/a.ts']);
    expect(out.testFiles).toBe(report.testFiles);
    expect(out.schemaVersion).toBe('1.0');
  });

  it('keeps only the mutants lying wholly on a file’s named lines', () => {
    const lined = {
      files: {
        'src/a.ts': {
          language: 'typescript',
          mutants: [
            at('before', 3),
            at('first', 4),
            at('last', 5),
            at('spills', 5, 6),
            at('starts-before', 3, 4),
            at('second-range', 9, 12),
            at('after', 13),
            { id: 'unplaced' },
          ],
        },
      },
    };
    const out = narrow(lined, ['src/a.ts:4-5', 'src/a.ts:9-12']);
    expect(out.files['src/a.ts'].mutants.map((m) => m.id)).toEqual([
      'first',
      'last',
      'second-range',
    ]);
    expect(out.files['src/a.ts'].language).toBe('typescript');
  });

  it('copes with a report that has no files, or a file with no mutants', () => {
    expect(narrow({}, ['src/a.ts']).files).toEqual({});
    expect(
      narrow({ files: { 'src/a.ts': {} } }, ['src/a.ts:1-2']).files['src/a.ts'].mutants,
    ).toEqual([]);
  });
});

describe('command line', () => {
  const script = path.resolve('.github/scripts/mutation-incremental.mjs');
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('narrows the incremental file in place', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mutation-incremental-'));
    const file = path.join(dir, 'stryker-incremental.json');
    writeFileSync(file, JSON.stringify(report));
    const out = spawnSync(process.execPath, [script, file, 'src/a.ts:1-3,src/b.ts'], {
      encoding: 'utf8',
    });
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    const narrowed = JSON.parse(readFileSync(file, 'utf8'));
    expect(Object.keys(narrowed.files)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(narrowed.files['src/a.ts'].mutants.map((m) => m.id)).toEqual(['1']);
    expect(narrowed.testFiles).toEqual(report.testFiles);
  });

  it('refuses a missing argument', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mutation-incremental-'));
    const out = spawnSync(process.execPath, [script, path.join(dir, 'x.json')], {
      encoding: 'utf8',
    });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('Usage');
  });
});

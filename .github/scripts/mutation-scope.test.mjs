import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  addedRanges,
  formatOnly,
  mutateEntries,
  scope,
  subjects,
  wiringChanged,
} from './mutation-scope.mjs';

// A fake repository: base and head contents, a "formatter" that collapses
// runs of spaces, standing in for Prettier, and the lines each file changed
// (`lines`, else line 1 of a file the base has; a new file has none).
function repo({ base = {}, head = {}, ignored = [], lines = {} } = {}) {
  return {
    ranges: (file) => (file in base ? (lines[file] ?? [[1, 1]]) : null),
    readBase: (file) => base[file] ?? null,
    readHead: (file) => {
      if (!(file in head)) throw new Error(`no ${file}`);
      return head[file];
    },
    format: async (source, file) => (ignored.includes(file) ? null : source.replace(/ +/g, ' ')),
    exists: (file) => file in head || file in base,
  };
}

const mutate = ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/legacy.ts'];

describe('subjects', () => {
  const exists = (f) => ['src/a.ts', 'src/b.tsx', 'src/x.helpers.ts', 'src/x.ts'].includes(f);

  it('maps a test to the source it covers, and a source to itself', () => {
    expect(subjects('src/a.test.ts', exists)).toEqual(['src/a.ts']);
    expect(subjects('src/b.test.tsx', exists)).toEqual(['src/b.tsx']);
    expect(subjects('src/__tests__/a.test.ts', exists)).toEqual(['src/a.ts']);
    expect(subjects('src/a.ts', exists)).toEqual(['src/a.ts']);
  });

  it('strips an infix only when no source has the full name', () => {
    expect(subjects('src/x.helpers.test.ts', exists)).toEqual(['src/x.helpers.ts']);
    expect(subjects('src/a.cache.test.ts', exists)).toEqual(['src/a.ts']);
    expect(subjects('src/gone.test.ts', exists)).toEqual([]);
  });
});

describe('formatOnly', () => {
  it('is true when formatting the base gives the head exactly', async () => {
    const r = repo({ base: { 'src/a.ts': 'let  a = 1;' }, head: { 'src/a.ts': 'let a = 1;' } });
    expect(await formatOnly('src/a.ts', r)).toBe(true);
  });

  it('is false for a real change, a new file, an ignored file or a read that fails', async () => {
    const r = repo({
      base: { 'src/a.ts': 'let  a = 1;', 'src/gql.ts': 'x  y', 'src/gone.ts': 'z' },
      head: { 'src/a.ts': 'let a = 2;', 'src/new.ts': 'let b;', 'src/gql.ts': 'x y' },
      ignored: ['src/gql.ts'],
    });
    expect(await formatOnly('src/a.ts', r)).toBe(false);
    expect(await formatOnly('src/new.ts', r)).toBe(false);
    expect(await formatOnly('src/gql.ts', r)).toBe(false);
    expect(await formatOnly('src/gone.ts', r)).toBe(false);
  });

  it('counts a formatter that throws as a real change', async () => {
    const r = {
      ...repo({ base: { 'src/a.ts': 'x' }, head: { 'src/a.ts': 'x' } }),
      format: async () => {
        throw new Error('syntax error');
      },
    };
    expect(await formatOnly('src/a.ts', r)).toBe(false);
  });
});

describe('scope', () => {
  const r = repo({
    base: {
      'src/fmt.ts': 'a  b',
      'src/real.ts': 'a',
      'src/covered.ts': 'c',
      'src/covered.test.ts': 'it(  1)',
      'src/tested.ts': 't',
      'src/tested.test.ts': 'it(1)',
      'src/legacy.ts': 'l',
    },
    head: {
      'src/fmt.ts': 'a b',
      'src/real.ts': 'b',
      'src/new.ts': 'n',
      'src/covered.ts': 'c',
      'src/covered.test.ts': 'it( 1)',
      'src/tested.ts': 't',
      'src/tested.test.ts': 'it(2)',
      'src/legacy.ts': 'm',
      'README.md': 'x',
    },
  });

  it('leaves out format-only changes, narrows real ones to their lines and keeps new files whole', async () => {
    expect(await scope(['src/fmt.ts', 'src/real.ts', 'src/new.ts'], { mutate, ...r })).toEqual([
      'src/real.ts:1-1',
      'src/new.ts',
    ]);
  });

  it('names each changed block of a file, and nothing for one that only lost lines', async () => {
    const lined = repo({
      base: { 'src/a.ts': 'a', 'src/b.ts': 'b' },
      head: { 'src/a.ts': 'A', 'src/b.ts': '' },
      lines: {
        'src/a.ts': [
          [3, 3],
          [11, 14],
        ],
        'src/b.ts': [],
      },
    });
    expect(await scope(['src/a.ts', 'src/b.ts'], { mutate, ...lined })).toEqual([
      'src/a.ts:3-3',
      'src/a.ts:11-14',
    ]);
  });

  it('keeps the source of a changed test whole, whichever is listed first', async () => {
    const both = ['src/tested.ts', 'src/tested.test.ts'];
    expect(await scope(both, { mutate, ...r })).toEqual(['src/tested.ts']);
    expect(await scope([...both].reverse(), { mutate, ...r })).toEqual(['src/tested.ts']);
  });

  it('maps a really changed test to its source, and a reformatted one to nothing', async () => {
    expect(await scope(['src/tested.test.ts', 'src/covered.test.ts'], { mutate, ...r })).toEqual([
      'src/tested.ts',
    ]);
  });

  it('keeps to the globs, and lists a file once', async () => {
    expect(
      await scope(['src/legacy.ts', 'README.md', 'src/tested.ts', 'src/tested.test.ts'], {
        mutate,
        ...r,
      }),
    ).toEqual(['src/tested.ts']);
  });
});

describe('addedRanges', () => {
  it('reads the new side of each hunk, a missing count meaning one line', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -3 +3 @@ export function x() {',
      '-a',
      '+b',
      '@@ -10,0 +11,4 @@',
      '+c',
      '+d',
      '+e',
      '+f',
      '@@ -20,2 +24 @@',
      '-g',
      '-h',
      '+i',
    ].join('\n');
    expect(addedRanges(diff)).toEqual([
      [3, 3],
      [11, 14],
      [24, 24],
    ]);
  });

  it('adds nothing for a hunk that only deletes, or for no diff', () => {
    expect(addedRanges('@@ -5,2 +4,0 @@\n-a\n-b\n')).toEqual([]);
    expect(addedRanges('')).toEqual([]);
  });

  it('reads only hunk headers, not a changed line that looks like one', () => {
    expect(addedRanges('@@ -1 +1 @@\n-x\n+@@ -1 +9,9 @@\n')).toEqual([[1, 1]]);
  });
});

describe('mutateEntries', () => {
  it('names a file whole, each changed block, or nothing', () => {
    expect(mutateEntries('src/a.ts', null)).toEqual(['src/a.ts']);
    expect(
      mutateEntries('src/a.ts', [
        [3, 3],
        [11, 14],
      ]),
    ).toEqual(['src/a.ts:3-3', 'src/a.ts:11-14']);
    expect(mutateEntries('src/a.ts', [])).toEqual([]);
  });
});

describe('wiringChanged', () => {
  it("is true for a change to anything Stryker's setup rests on", () => {
    for (const file of [
      'stryker.config.json',
      'vite.config.ts',
      'src/test/setup.ts',
      'tsconfig.json',
      'tsconfig.app.json',
      'package.json',
      'package-lock.json',
      'patches/@stryker-mutator+vitest-runner+10.0.0.patch',
      '.github/workflows/mutation.yml',
      '.github/scripts/mutation-scope.mjs',
      '.github/scripts/mutation-scope.test.mjs',
      '.github/scripts/mutation-incremental.mjs',
      '.github/scripts/mutation-incremental.test.mjs',
    ]) {
      expect(wiringChanged(['README.md', file]), file).toBe(true);
    }
  });

  it('is false for pictures, docs, other workflows and scripts, and source', () => {
    expect(
      wiringChanged([
        'docs/screenshots/catalog.png',
        'README.md',
        'CLAUDE.md',
        '.github/workflows/ci.yml',
        '.github/scripts/pr-visuals.mjs',
        'src/test/render.tsx',
        'src/lib/viewMode.ts',
        'api/tsconfig.json',
        'scripts/package.json',
      ]),
    ).toBe(false);
  });

  it('is false for nothing', () => {
    expect(wiringChanged([])).toBe(false);
  });
});

// A throwaway repository, its PR branch a commit on the base. No GIT_*
// variable from outside reaches git (a hook's would point it at this
// repository), nor the user's git config (signing, hooks, aliases).
describe('command line, against a base in git', () => {
  const script = path.resolve('.github/scripts/mutation-scope.mjs');
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  let dir;

  function git(...args) {
    const out = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
    if (out.status !== 0) throw new Error(out.stderr);
    return out.stdout;
  }

  function write(files) {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), text);
    }
  }

  it('mutates changed lines, a covered file and a new file whole, and skips a reformat', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mutation-scope-'));
    try {
      git('init', '-q', '-b', 'main');
      write({
        'stryker.config.json': '{"mutate":["src/**/*.ts","!src/**/*.test.ts"]}',
        'src/changed.ts': 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
        'src/shrunk.ts': 'export const a = 1;\nexport const b = 2;\n',
        'src/fmt.ts': 'export const a   =  "x"',
        'src/covered.ts': 'export const a = 1;\nexport const b = 2;\n',
        'src/covered.test.ts': 'it("a", () => {});\n',
      });
      git('add', '.');
      git('commit', '-q', '-m', 'base');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('checkout', '-q', '-b', 'pr');
      write({
        'src/changed.ts':
          'export const a = 1;\nexport const b = 20;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;\n',
        'src/shrunk.ts': 'export const a = 1;\n',
        'src/fmt.ts': 'export const a = "x";\n',
        'src/covered.test.ts': 'it("a", () => {});\nit("b", () => {});\n',
        'src/new.ts': 'export const n = 1;\n',
      });
      git('add', '.');
      git('commit', '-q', '-m', 'pr');
      const changed = git('diff', '--name-only', '--diff-filter=d', 'origin/main...HEAD');
      const out = spawnSync(process.execPath, [script], {
        cwd: dir,
        env: { ...env, BASE_REF: 'main' },
        input: changed,
        encoding: 'utf8',
      });
      expect(out.stderr).toBe('');
      expect(out.status).toBe(0);
      expect(out.stdout).toBe('src/changed.ts:2-2,src/changed.ts:4-5,src/covered.ts,src/new.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('command line, --wiring', () => {
  const script = path.resolve('.github/scripts/mutation-scope.mjs');
  const run = (input) =>
    spawnSync(process.execPath, [script, '--wiring'], { input, encoding: 'utf8' });

  it("prints whether the changed files touch Stryker's setup", () => {
    const touched = run('docs/a.png\npackage-lock.json\n');
    expect(touched.status).toBe(0);
    expect(touched.stdout).toBe('true\n');
    expect(run('docs/a.png\nsrc/lib/viewMode.ts\n').stdout).toBe('false\n');
    expect(run('').stdout).toBe('false\n');
  });
});

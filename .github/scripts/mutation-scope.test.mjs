import { describe, expect, it } from 'vitest';
import { formatOnly, scope, subjects } from './mutation-scope.mjs';

// A fake repository: base and head contents, and a "formatter" that
// collapses runs of spaces, standing in for Prettier.
function repo({ base = {}, head = {}, ignored = [] } = {}) {
  return {
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

  it('leaves out format-only changes and keeps real changes and new files', async () => {
    expect(await scope(['src/fmt.ts', 'src/real.ts', 'src/new.ts'], { mutate, ...r })).toEqual([
      'src/real.ts',
      'src/new.ts',
    ]);
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

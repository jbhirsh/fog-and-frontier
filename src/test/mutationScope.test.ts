import { describe, expect, it } from 'vitest';
import strykerConfigSource from '../../stryker.config.json?raw';
import viteConfigSource from '../../vite.config.ts?raw';

// Stryker mutates the files the coverage gate measures: the `mutate` globs in
// stryker.config.json mirror `test.coverage.include` / `exclude` in
// vite.config.ts, coverage backlog included. A file added to the backlog must
// leave the mutation scope too (it has no tests to kill mutants with), and one
// that leaves the backlog must come back in. This keeps the two lists in step.
const { mutate } = JSON.parse(strykerConfigSource) as { mutate: string[] };
const coverageBlock = viteConfigSource.split('coverage: {')[1];

// The quoted globs in vite.config.ts's coverage `include` / `exclude` array,
// with `//` comments dropped first (their apostrophes would confuse the match).
function coverageGlobs(key: 'include' | 'exclude'): string[] {
  const body = coverageBlock
    .split(`${key}: [`)[1]
    .split(']')[0]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('mutation scope', () => {
  it('mutates exactly what coverage measures', () => {
    const include = coverageGlobs('include');
    const exclude = coverageGlobs('exclude');
    expect(include.length).toBeGreaterThan(0);
    expect(exclude.length).toBeGreaterThan(0);

    const mutateInclude = mutate.filter((g) => !g.startsWith('!'));
    const mutateExclude = mutate
      .filter((g) => g.startsWith('!') && g !== '!**/*.d.ts')
      .map((g) => g.slice(1));

    expect([...mutateInclude].sort()).toEqual([...include].sort());
    expect([...mutateExclude].sort()).toEqual([...exclude].sort());
  });
});

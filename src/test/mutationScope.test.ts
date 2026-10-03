import { describe, expect, it } from 'vitest';
import strykerConfigSource from '../../stryker.config.json?raw';
import { coverageGlobs } from './coverageGlobs';

// Stryker mutates the files the coverage gate measures: the `mutate` globs in
// stryker.config.json mirror `test.coverage.include` / `exclude` in
// vite.config.ts, coverage backlog included. A file added to the backlog must
// leave the mutation scope too (it has no tests to kill mutants with), and one
// that leaves the backlog must come back in. This keeps the two lists in step.
const { mutate } = JSON.parse(strykerConfigSource) as { mutate: string[] };

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

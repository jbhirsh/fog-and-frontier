// Prints the comma-separated --mutate list for a PR's Stryker run: the files
// the PR changed (one path per line on stdin) that stryker.config.json's
// `mutate` globs cover. A `!` glob excludes, as in Stryker. Reading the globs
// from the config keeps the PR scope and the weekly full sweep in step, so
// there is no second copy of the file list to drift.
//
// A changed test file stands for the source file it covers (`x.test.ts`,
// `x.cache.test.ts` or `__tests__/x.test.ts` next to `x.ts`/`x.tsx`), so a
// PR that only weakens a test is still mutation-tested against that code.
//
// Prints nothing when no changed file is in scope; the workflow then runs
// its smoke scope instead.
import { existsSync, readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';

const { mutate } = JSON.parse(readFileSync('stryker.config.json', 'utf8'));
const include = mutate.filter((g) => !g.startsWith('!'));
const exclude = mutate.filter((g) => g.startsWith('!')).map((g) => g.slice(1));

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

function subjects(file) {
  if (!TEST_FILE.test(file)) return [file];
  const base = file.replace(TEST_FILE, '').replace('/__tests__/', '/');
  const bases = [base, base.replace(/\.[\w-]+$/, '')];
  return bases
    .flatMap((b) => [`${b}.ts`, `${b}.tsx`])
    .filter((candidate) => existsSync(candidate));
}

const changed = readFileSync(0, 'utf8').split('\n').filter(Boolean);
const inScope = new Set(
  changed
    .flatMap(subjects)
    .filter(
      (file) =>
        include.some((g) => matchesGlob(file, g)) &&
        !exclude.some((g) => matchesGlob(file, g)),
    ),
);
process.stdout.write([...inScope].join(','));

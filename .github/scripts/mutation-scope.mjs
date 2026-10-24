// Prints the comma-separated --mutate list for a PR's Stryker run: the files
// the PR changed (one path per line on stdin) that stryker.config.json's
// `mutate` globs cover. A `!` glob excludes, as in Stryker. Reading the globs
// from the config keeps the PR scope and the weekly full sweep in step, so
// there is no second copy of the file list to drift.
//
//   git diff --name-only --diff-filter=d origin/main...HEAD \
//     | BASE_REF=main node .github/scripts/mutation-scope.mjs
//
// A file whose change is formatting only is left out: its base version (at
// the merge base with origin/$BASE_REF), run through Prettier with the repo's
// config, is byte for byte what the PR has. A reformat then doesn't turn the
// PR's run into a full sweep that outlasts the job's timeout. New files, real
// changes, a file Prettier ignores and anything that can't be read stay in.
//
// A changed test file stands for the source file it covers (`x.test.ts`,
// `x.cache.test.ts` or `__tests__/x.test.ts` next to `x.ts`/`x.tsx`), so a
// PR that only weakens a test is still mutation-tested against that code; a
// test that was only reformatted stands for nothing. An infix is stripped
// only when no source matches the full name, so `x.helpers.test.ts` covers
// `x.helpers.ts` alone, not `x.ts` as well.
//
// Prints nothing when no changed file is in scope; the workflow then runs
// its smoke scope instead.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { pathToFileURL } from 'node:url';

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** The source files a changed file stands for: itself, or a test's subject. */
export function subjects(file, exists = existsSync) {
  if (!TEST_FILE.test(file)) return [file];
  const base = file.replace(TEST_FILE, '').replace('/__tests__/', '/');
  const sources = (b) => [`${b}.ts`, `${b}.tsx`].filter((c) => exists(c));
  // `x.helpers.test.ts` covers `x.helpers.ts`; only when no such file exists
  // is the infix a test variant (`x.cache.test.ts` covers `x.ts`).
  const exact = sources(base);
  return exact.length > 0 ? exact : sources(base.replace(/\.[\w-]+$/, ''));
}

/**
 * Whether `file` changed only in formatting: `readBase` gives its base
 * version (null when it's new), `readHead` the PR's, and `format` the base
 * version as Prettier writes it (null when Prettier ignores the file). Any
 * failure counts as a real change.
 */
export async function formatOnly(file, { readBase, readHead, format }) {
  try {
    const base = readBase(file);
    if (base === null) return false;
    const formatted = await format(base, file);
    return formatted !== null && formatted === readHead(file);
  } catch {
    return false;
  }
}

/** The --mutate list for the changed files, given the globs and the readers. */
export async function scope(changed, { mutate, exists = existsSync, ...readers }) {
  const include = mutate.filter((g) => !g.startsWith('!'));
  const exclude = mutate.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
  const real = [];
  for (const file of changed) {
    if (!(await formatOnly(file, readers))) real.push(file);
  }
  const inScope = new Set(
    real
      .flatMap((file) => subjects(file, exists))
      .filter(
        (file) =>
          include.some((g) => matchesGlob(file, g)) && !exclude.some((g) => matchesGlob(file, g)),
      ),
  );
  return [...inScope];
}

/** Readers over git and Prettier, comparing against the merge base with `baseRef`. */
export async function gitReaders(baseRef) {
  const prettier = await import('prettier');
  const mergeBase = execFileSync('git', ['merge-base', `origin/${baseRef}`, 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  return {
    readBase: (file) => {
      try {
        return execFileSync('git', ['show', `${mergeBase}:${file}`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 64 * 1024 * 1024,
        });
      } catch {
        return null;
      }
    },
    readHead: (file) => readFileSync(file, 'utf8'),
    format: async (source, file) => {
      const info = await prettier.getFileInfo(file, { ignorePath: '.prettierignore' });
      if (info.ignored || !info.inferredParser) return null;
      const config = (await prettier.resolveConfig(file)) ?? {};
      return prettier.format(source, { ...config, filepath: file });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { mutate } = JSON.parse(readFileSync('stryker.config.json', 'utf8'));
  const changed = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const readers = process.env.BASE_REF
    ? await gitReaders(process.env.BASE_REF)
    : { readBase: () => null, readHead: () => null, format: async () => null };
  process.stdout.write((await scope(changed, { mutate, ...readers })).join(','));
}

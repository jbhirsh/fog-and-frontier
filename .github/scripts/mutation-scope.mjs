// Prints the comma-separated --mutate list for a PR's Stryker run: the files
// the PR changed (one path per line on stdin) that stryker.config.json's
// `mutate` globs cover, narrowed to the lines it changed (below). A `!` glob
// excludes, as in Stryker. Reading the globs from the config keeps the PR
// scope and the weekly full sweep in step, so there is no second copy of the
// file list to drift.
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
// Of a source file that was there at the merge base, only the lines the PR
// adds or changes are mutated: one `file:first-last` entry per block, read
// from `git diff -U0` (Stryker's --mutate takes line ranges). The rest of
// the file is code the PR didn't write, and a PR touching many files would
// otherwise mutate every line of each: in jbhirsh/BoardGames one touching
// 77 components came to 5,176 mutants and outran its job. A file new to the
// branch is mutated whole, and one whose change only deletes lines has
// nothing left to mutate. A file a changed test stands for stays whole too,
// since a weakened test can let any of its mutants survive; so does every
// file when BASE_REF isn't set.
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

/**
 * The line ranges a diff with no context lines (`git diff -U0`) adds to its
 * new side, as `[first, last]` pairs; a hunk that only deletes adds none.
 * @param {string} diff
 * @returns {Array<[number, number]>}
 */
export function addedRanges(diff) {
  const ranges = [];
  for (const [, start, count] of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const lines = count === undefined ? 1 : Number(count);
    if (lines > 0) ranges.push([Number(start), Number(start) + lines - 1]);
  }
  return ranges;
}

/**
 * `file` as --mutate entries: whole when `ranges` is null, else one
 * `file:first-last` per range, so none when it only lost lines.
 * @param {string} file
 * @param {Array<[number, number]> | null} ranges
 */
export function mutateEntries(file, ranges) {
  return ranges === null ? [file] : ranges.map(([first, last]) => `${file}:${first}-${last}`);
}

/**
 * The --mutate list for the changed files, given the globs and the readers:
 * `ranges` gives the lines a file adds or changes (null for a new file).
 */
export async function scope(changed, { mutate, exists = existsSync, ranges, ...readers }) {
  const include = mutate.filter((g) => !g.startsWith('!'));
  const exclude = mutate.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
  const inGlobs = (file) =>
    include.some((g) => matchesGlob(file, g)) && !exclude.some((g) => matchesGlob(file, g));
  // Each in-scope file once, in the order first met: null when it's mutated
  // whole, else its changed line ranges.
  const lines = new Map();
  for (const file of changed) {
    if (await formatOnly(file, readers)) continue;
    const isTest = TEST_FILE.test(file);
    for (const subject of subjects(file, exists).filter(inGlobs)) {
      if (lines.get(subject) === null) continue;
      lines.set(subject, isTest ? null : ranges(subject));
    }
  }
  return [...lines].flatMap(([file, r]) => mutateEntries(file, r));
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
    ranges: (file) => {
      try {
        execFileSync('git', ['cat-file', '-e', `${mergeBase}:${file}`], { stdio: 'ignore' });
      } catch {
        return null;
      }
      return addedRanges(
        execFileSync('git', ['diff', '-U0', '--no-ext-diff', '--no-color', mergeBase, '--', file], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      );
    },
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
    : { readBase: () => null, readHead: () => null, format: async () => null, ranges: () => null };
  process.stdout.write((await scope(changed, { mutate, ...readers })).join(','));
}

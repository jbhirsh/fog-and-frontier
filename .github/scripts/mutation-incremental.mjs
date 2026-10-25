// Limits a PR's restored Stryker incremental results to this run's --mutate
// scope, rewriting the file in place:
//
//   node .github/scripts/mutation-incremental.mjs reports/stryker-incremental.json "$MUTATE_SCOPE"
//
// Stryker carries every file in the incremental file into its report and
// score, in scope or not, and within a file it mutates only part of, every
// earlier mutant outside that part: a file the PR no longer changes must not
// keep failing it, and an earlier push's well-tested code must not lift new
// code over the threshold. So a file the scope doesn't name is dropped, and
// one it names by lines (`a.ts:10-20`, what mutation-scope.mjs prints for an
// edited file) keeps only the mutants lying wholly on those lines, the rule
// Stryker mutates by. A file named whole anywhere in the scope stays whole.
// Test files (`testFiles`) are kept: Stryker needs them to tell which tests
// changed.
//
// The kept mutants' lines are the earlier push's, the ranges this one's; a
// mutant whose line has since moved out of range is dropped and re-tested,
// which costs time but never a wrong score.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The scope's entries by file: null for a whole file, else the `[first,
 * last]` line ranges named for it.
 * @param {string[]} scope
 * @returns {Map<string, Array<[number, number]> | null>}
 */
export function scopeLines(scope) {
  const byFile = new Map();
  for (const entry of scope) {
    const lines = /^(.+):(\d+)-(\d+)$/.exec(entry);
    const file = lines ? lines[1] : entry;
    if (!lines || byFile.get(file) === null) byFile.set(file, null);
    else byFile.set(file, [...(byFile.get(file) ?? []), [Number(lines[2]), Number(lines[3])]]);
  }
  return byFile;
}

/** The incremental report with only the files, and lines, named in `scope` left in it. */
export function narrow(report, scope) {
  const wanted = scopeLines(scope);
  const files = {};
  for (const [name, file] of Object.entries(report.files ?? {})) {
    if (!wanted.has(name)) continue;
    const ranges = wanted.get(name);
    files[name] = ranges
      ? {
          ...file,
          mutants: (file.mutants ?? []).filter(({ location }) =>
            ranges.some(
              ([first, last]) => location?.start.line >= first && location.end.line <= last,
            ),
          ),
        }
      : file;
  }
  return { ...report, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, scope] = process.argv.slice(2);
  if (!file || scope === undefined) {
    console.error('Usage: mutation-incremental.mjs <incremental file> <comma-separated scope>');
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify(narrow(report, scope.split(',').filter(Boolean))));
}

// Counts (and, for links, writes up) what the weekly audit's tools found, for
// tracking-issue.mjs (weekly-audit.yml). Each reads the tool's JSON report:
//
//   node .github/scripts/audit-report.mjs knip <knip.json>
//   node .github/scripts/audit-report.mjs jscpd <jscpd-report.json>
//   node .github/scripts/audit-report.mjs lychee <lychee.json> <report.md>
//
// and prints the number of findings; for lychee it also writes the report,
// since its own Markdown doesn't say which doc each broken link is in.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const NOT_FINDINGS = new Set(['file', 'owners']);

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  if (value === true) return 1;
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((sum, inner) => sum + countValue(inner), 0);
  }
  return 0;
}

/**
 * Knip's findings in its JSON report: unused files, plus every unused
 * dependency, export, type, member, duplicate and the like, file by file.
 */
export function knipCount(report) {
  const files = Array.isArray(report.files) ? report.files.length : 0;
  return (report.issues ?? []).reduce(
    (sum, issue) =>
      sum +
      Object.entries(issue)
        .filter(([key]) => !NOT_FINDINGS.has(key))
        .reduce((n, [, value]) => n + countValue(value), 0),
    files,
  );
}

/** jscpd's clones, from jscpd-report.json. */
export function jscpdCount(report) {
  return report.statistics?.total?.clones ?? 0;
}

/**
 * The broken links in lychee's JSON report (`error_map`, which older
 * releases called `fail_map`: doc → failures, each with its url and
 * status), and a report listing them by doc.
 */
export function lycheeReport(report, { runUrl } = {}) {
  const docs = Object.entries(report.error_map ?? report.fail_map ?? {})
    .filter(([, failures]) => failures.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const count = docs.reduce((sum, [, failures]) => sum + failures.length, 0);
  const status = (s) => {
    if (typeof s === 'string') return s;
    if (s?.code) return `${s.code}${s.text ? ` ${s.text}` : ''}`;
    return s?.text ?? JSON.stringify(s);
  };
  const lines = [
    'Links in the docs that no longer resolve: dead pages, missing files or images, or anchors that ' +
      'no heading matches. Fix or remove each; a host that refuses scripts goes in a `.lycheeignore` (one URL pattern per line).',
  ];
  for (const [doc, failures] of docs) {
    lines.push('', `**${doc}**`, '');
    for (const f of failures) lines.push(`- ${f.url} — ${status(f.status)}`);
  }
  if (runUrl) lines.push('', `From ${runUrl}.`);
  return { count, markdown: lines.join('\n') };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const [tool, input, out] = argv;
  const report = JSON.parse(readFileSync(input, 'utf8'));
  if (tool === 'knip') return knipCount(report);
  if (tool === 'jscpd') return jscpdCount(report);
  if (tool === 'lychee') {
    if (!out) throw new Error('lychee needs the report path to write');
    const runUrl = env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined;
    const { count, markdown } = lycheeReport(report, { runUrl });
    writeFileSync(out, `${markdown}\n`);
    return count;
  }
  throw new Error(`unknown tool ${tool}: knip, jscpd or lychee`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(main());
}

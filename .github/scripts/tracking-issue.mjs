// Keeps one issue per weekly-audit finding (weekly-audit.yml): opens it when
// a sweep finds something, rewrites its body with the latest report on the
// next one, and closes it with a comment once a sweep comes back clean. Each
// is found by its exact title among the open issues labelled `weekly-audit`.
//
//   node .github/scripts/tracking-issue.mjs --title "Dead code (weekly audit)" \
//     --findings <n> [--body-file report.md]
//
// Runs `gh`, so GH_TOKEN needs issues: write. The run stays green whatever it
// finds: the issue is the alert.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LABEL = 'weekly-audit';

/** The open issue with exactly this title, from `gh issue list --json`. */
export function findIssue(issues, title) {
  return issues.find((issue) => issue.title === title) ?? null;
}

/** What to do with the issue, given this sweep's findings. */
export function decide({ findings, existing }) {
  if (findings > 0) {
    return existing ? { kind: 'update', number: existing.number } : { kind: 'create' };
  }
  return existing ? { kind: 'close', number: existing.number } : { kind: 'none' };
}

/** GitHub refuses an issue body over 65,536 characters. */
export const MAX_BODY = 60_000;

/** The body, cut short with a pointer to the full report if it's too long. */
export function fitBody(body, runUrl) {
  if (body.length <= MAX_BODY) return body;
  const where = runUrl ? ` The full report is in ${runUrl}.` : '';
  return `${body.slice(0, MAX_BODY)}\n\n…cut short.${where}`;
}

/** Reads the command line (without node and the script). */
export function parseArgs(argv) {
  const options = { title: '', findings: NaN, bodyFile: undefined };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--title') options.title = value;
    // Digits only: Number('') is 0, which would close the issue as clean.
    else if (flag === '--findings') options.findings = /^\d+$/.test(value) ? Number(value) : NaN;
    else if (flag === '--body-file') options.bodyFile = value;
    else throw new Error(`unknown option ${flag}`);
  }
  if (!options.title) throw new Error('--title is needed');
  if (!Number.isInteger(options.findings) || options.findings < 0) {
    throw new Error('--findings must be a whole number');
  }
  if (options.findings > 0 && !options.bodyFile) throw new Error('findings need --body-file');
  return options;
}

/**
 * Applies the decision through `gh` (`run` takes its arguments and what to
 * pipe in, and returns stdout), and says what it did.
 */
export function sync({ title, findings, body = '' }, run, today = new Date()) {
  run([
    'label',
    'create',
    LABEL,
    '--force',
    '--color',
    'c5def5',
    '--description',
    'Opened by the weekly audit',
  ]);
  const open = JSON.parse(
    run([
      'issue',
      'list',
      '--label',
      LABEL,
      '--state',
      'open',
      '--limit',
      '100',
      '--json',
      'number,title',
    ]),
  );
  const action = decide({ findings, existing: findIssue(open, title) });
  const date = today.toISOString().slice(0, 10);
  switch (action.kind) {
    case 'create':
      run(['issue', 'create', '--title', title, '--label', LABEL, '--body-file', '-'], body);
      return `opened "${title}" (${findings} found)`;
    case 'update':
      run(['issue', 'edit', String(action.number), '--body-file', '-'], body);
      return `updated #${action.number} (${findings} found)`;
    case 'close':
      run([
        'issue',
        'close',
        String(action.number),
        '--comment',
        `The ${date} weekly audit found nothing, so this is resolved.`,
      ]);
      return `closed #${action.number}`;
    default:
      return `nothing found for "${title}"`;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const runUrl = GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : undefined;
  // Read before touching any issue, so a missing report fails cleanly.
  const body = options.bodyFile ? fitBody(readFileSync(options.bodyFile, 'utf8'), runUrl) : '';
  const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input });
  console.log(`tracking-issue: ${sync({ ...options, body }, gh)}`);
}

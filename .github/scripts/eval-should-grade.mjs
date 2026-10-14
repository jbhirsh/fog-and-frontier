// Decides whether a run of the paid Gemini eval (eval.yml) should grade, so
// it spends money only when the AI code changed. Prints `run=true|false` for
// $GITHUB_OUTPUT and a one-line reason to stderr.
//
//   node eval-should-grade.mjs <ai-path>...
//
// Reads the GitHub context from the environment: GITHUB_EVENT_NAME, ACTION
// (the pull_request action), DRAFT, BASE_REF, HEAD_REF, PR_NUMBER, AFTER
// (the PR head), WORKFLOW_FILE (this workflow's file name), GITHUB_RUN_ID,
// and GITHUB_API_URL / GITHUB_REPOSITORY / GITHUB_TOKEN to read this
// workflow's earlier runs. The rules, in `decide`:
//   - manual dispatch always grades;
//   - a draft never does;
//   - opening ready, reopening, or marking a draft ready grades if the PR
//     changes the AI code at all;
//   - a push to a ready PR skips only when the PR's AI changes are the same
//     as at the head of this workflow's last finished run on the PR, and
//     that run passed. Anything else grades: changed AI code, or a last run
//     that failed, errored or was cancelled. A head that never got a run (a
//     merge conflict or a skip-ci marker stops one) is passed over, so the
//     comparison is always with a head that was actually checked.
//
// "The PR's AI changes" is its diff of the AI paths from where it branched
// off the base, without line numbers or context, so rebasing on (or merging
// in) a base that moved doesn't count as a change.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * @param {{ event: string, action?: string, draft?: boolean, prChanges: string,
 *   last?: { passed: boolean, prChanges: string | null } | null }} input
 *   prChanges: the PR's AI changes at its head ('' for none).
 *   last: this workflow's last finished run on the PR (null if none):
 *   whether it passed, and the PR's AI changes at its head (null when that
 *   commit can't be found).
 * @returns {{ grade: boolean, reason: string }}
 */
export function decide({ event, action, draft, prChanges, last }) {
  if (event !== 'pull_request') return { grade: true, reason: `${event}: always grades` };
  if (draft) return { grade: false, reason: 'draft: grades once marked ready' };
  if (prChanges === '') return { grade: false, reason: 'the PR changes no AI code' };
  if (action !== 'synchronize') return { grade: true, reason: `${action}: the PR changes AI code` };
  if (!last) return { grade: true, reason: 'push: no earlier finished run to compare with' };
  if (!last.passed) return { grade: true, reason: 'push: the last finished run did not pass' };
  if (last.prChanges == null) {
    return { grade: true, reason: 'push: the last run’s head is gone, so the PR is graded as a whole' };
  }
  return prChanges === last.prChanges
    ? { grade: false, reason: 'push: the AI code is unchanged since the last run, which passed' }
    : { grade: true, reason: 'push: changed the AI code since the last run' };
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    // rules-text/ alone is most of a megabyte, past the 1 MiB default.
    maxBuffer: 512 * 1024 * 1024,
  });
}

function exists(cwd, sha) {
  try {
    git(cwd, 'cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

// The PR's AI changes at `sha`: its diff of the AI paths from its merge base
// with the base branch. No context lines (-U0), hunk headers without their
// line numbers, and no `index` lines (blob hashes), so a base that moved
// around the PR's edits leaves it unchanged. --binary makes a binary edit
// show its content rather than "Binary files differ".
export function prChangesAt(cwd, sha, baseRef, paths) {
  const base = git(cwd, 'merge-base', `origin/${baseRef}`, sha).trim();
  return git(cwd, 'diff', '--no-color', '--binary', '-U0', base, sha, '--', ...paths)
    .split('\n')
    .filter((line) => !line.startsWith('index '))
    .map((line) => (line.startsWith('@@') ? line.replace(/^@@ [^@]* @@/, '@@') : line))
    .join('\n');
}

/**
 * This workflow's last finished run on the PR, other than this one:
 * `{ sha, passed }`, or null if there is none. Throws if GitHub can't be
 * read; the caller grades then.
 */
export async function lastRun({ api, repo, token, workflow, branch, pr, runId }, fetchImpl = fetch) {
  const url =
    `${api}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs` +
    `?branch=${encodeURIComponent(branch)}&event=pull_request&per_page=50`;
  const r = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error(`runs: HTTP ${r.status}`);
  const { workflow_runs: runs = [] } = await r.json();
  // Newest first. A run from a fork carries no pull_requests; one from an
  // earlier PR on a reused branch name names that PR, so it's left out.
  const run = runs.find(
    (x) =>
      String(x.id) !== String(runId) &&
      x.status === 'completed' &&
      (x.pull_requests?.length ? x.pull_requests.some((p) => String(p.number) === String(pr)) : true),
  );
  return run ? { sha: run.head_sha, passed: run.conclusion === 'success' } : null;
}

/**
 * Reads the run's context from `env`, the repository at `cwd` and (for a
 * push) this workflow's last finished run, and returns the decision. If
 * either can't be read, it grades rather than block the check or skip blind.
 */
export async function evaluate(env, paths, cwd, findLastRun = lastRun) {
  const { GITHUB_EVENT_NAME: event, ACTION: action, DRAFT, BASE_REF, AFTER } = env;
  if (event !== 'pull_request' || DRAFT === 'true') {
    return decide({ event, action, draft: DRAFT === 'true', prChanges: '' });
  }
  try {
    const prChanges = prChangesAt(cwd, AFTER, BASE_REF, paths);
    if (prChanges === '' || action !== 'synchronize') {
      return decide({ event, action, draft: false, prChanges });
    }
    const found = await findLastRun({
      api: env.GITHUB_API_URL ?? 'https://api.github.com',
      repo: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN,
      workflow: env.WORKFLOW_FILE,
      branch: env.HEAD_REF,
      pr: env.PR_NUMBER,
      runId: env.GITHUB_RUN_ID,
    });
    let last = null;
    if (found) {
      // A force-pushed-over head may only be fetchable by its SHA.
      if (!exists(cwd, found.sha)) {
        try {
          git(cwd, 'fetch', '--no-tags', '--quiet', 'origin', found.sha);
        } catch {
          // Gone: decide() grades the PR as a whole.
        }
      }
      last = {
        passed: found.passed,
        prChanges: exists(cwd, found.sha) ? prChangesAt(cwd, found.sha, BASE_REF, paths) : null,
      };
    }
    return decide({ event, action, draft: false, prChanges, last });
  } catch {
    return { grade: true, reason: 'the PR or its earlier runs could not be read, so it is graded' };
  }
}

async function main() {
  const { grade, reason } = await evaluate(process.env, process.argv.slice(2), process.cwd());
  console.error(`${grade ? 'Grading' : 'Skipping the eval'}: ${reason}`);
  console.log(`run=${grade}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

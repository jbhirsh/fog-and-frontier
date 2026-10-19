import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decide, evaluate, lastRun } from './eval-should-grade.mjs';

const pr = (over) => ({ event: 'pull_request', action: 'synchronize', draft: false, ...over });
const passedAt = (prChanges) => ({ passed: true, prChanges });

describe('decide', () => {
  it('always grades a manual run', () => {
    expect(decide({ event: 'workflow_dispatch', prChanges: '' }).grade).toBe(true);
  });

  it('never grades a draft, even one changing the AI code', () => {
    for (const action of ['opened', 'synchronize', 'reopened']) {
      expect(decide(pr({ action, draft: true, prChanges: 'diff' })).grade).toBe(false);
    }
  });

  it('grades a PR that opens ready, reopens, or is marked ready with AI changes', () => {
    for (const action of ['opened', 'reopened', 'ready_for_review']) {
      expect(decide(pr({ action, prChanges: 'diff', last: passedAt('diff') })).grade).toBe(true);
    }
  });

  it('skips a PR with no AI changes, however it arrives', () => {
    for (const action of ['opened', 'ready_for_review', 'synchronize']) {
      expect(decide(pr({ action, prChanges: '' })).grade).toBe(false);
    }
  });

  it('grades a push that changed the AI code, including its first AI change', () => {
    expect(decide(pr({ prChanges: 'diff b', last: passedAt('diff a') })).grade).toBe(true);
    expect(decide(pr({ prChanges: 'diff', last: passedAt('') })).grade).toBe(true);
  });

  it('skips a push that left the AI code as it was at a passing run', () => {
    expect(decide(pr({ prChanges: 'diff', last: passedAt('diff') }))).toEqual({
      grade: false,
      reason: 'push: the AI code is unchanged since the last run, which passed',
    });
  });

  it('grades an unchanged push when the last run did not pass, or there was none', () => {
    const failed = { passed: false, prChanges: 'diff' };
    expect(decide(pr({ prChanges: 'diff', last: failed })).grade).toBe(true);
    expect(decide(pr({ prChanges: 'diff', last: null })).grade).toBe(true);
    expect(decide(pr({ prChanges: 'diff' })).grade).toBe(true);
  });

  it('grades the whole PR when the last run’s head is gone', () => {
    expect(decide(pr({ prChanges: 'diff', last: passedAt(null) }))).toEqual({
      grade: true,
      reason: 'push: the last run’s head is gone, so the PR is graded as a whole',
    });
  });
});

describe('lastRun', () => {
  const args = {
    api: 'https://api.test',
    repo: 'o/r',
    token: 't',
    workflow: 'eval.yml',
    branch: 'feature/x',
    pr: 7,
    runId: 100,
  };
  const respond = (runs, ok = true) =>
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 403,
      json: () => Promise.resolve({ workflow_runs: runs }),
    });
  const run = (over) => ({
    id: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: 'abc',
    pull_requests: [{ number: 7 }],
    ...over,
  });

  it('asks for the workflow’s pull_request runs on the branch', async () => {
    const fetchImpl = respond([run()]);
    expect(await lastRun(args, fetchImpl)).toEqual({ sha: 'abc', passed: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/repos/o/r/actions/workflows/eval.yml/runs?branch=feature%2Fx&event=pull_request&per_page=50',
      { headers: { authorization: 'Bearer t', accept: 'application/vnd.github+json' } },
    );
  });

  it('takes the newest finished run of this PR, not this run or an unfinished one', async () => {
    const runs = [
      run({ id: 100, head_sha: 'this-run' }),
      run({ id: 99, status: 'in_progress', head_sha: 'running' }),
      run({ id: 98, pull_requests: [{ number: 3 }], head_sha: 'other-pr' }),
      run({ id: 97, conclusion: 'cancelled', head_sha: 'cancelled' }),
      run({ id: 96, head_sha: 'older' }),
    ];
    expect(await lastRun(args, respond(runs))).toEqual({ sha: 'cancelled', passed: false });
  });

  it('counts a fork’s run, which names no PR, and anything but success as not passed', async () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', null]) {
      const runs = [run({ pull_requests: [], conclusion })];
      expect(await lastRun(args, respond(runs))).toEqual({ sha: 'abc', passed: false });
    }
  });

  it('is null with no earlier run, and throws when GitHub can’t be read', async () => {
    expect(await lastRun(args, respond([]))).toBeNull();
    await expect(lastRun(args, respond([], false))).rejects.toThrow('HTTP 403');
  });
});

// Real git histories in throwaway repos: a bare "origin" and a clone that
// plays the CI checkout. No network: origin is a local directory, and the
// user's git config is kept out (signing, hooks, aliases).
describe('evaluate', () => {
  const AI = ['api/ai.ts', 'eval'];
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // Git hands its hooks GIT_DIR, GIT_INDEX_FILE and the like, naming this
  // repository, and the pre-push hook runs this suite. Left in place they
  // send every git command here, the script's own included, to this
  // repository instead of the throwaway ones: `init --bare` once marked it
  // bare. So no GIT_* variable from outside reaches these tests.
  const outside = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.startsWith('GIT_')),
  );
  beforeAll(() => {
    for (const name of Object.keys(outside)) delete process.env[name];
  });
  afterAll(() => {
    Object.assign(process.env, outside);
  });

  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
    ),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  const sh = (cwd, ...args) =>
    execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

  function repo() {
    const root = mkdtempSync(path.join(tmpdir(), 'eval-grade-'));
    dirs.push(root);
    const origin = path.join(root, 'origin.git');
    const cwd = path.join(root, 'w');
    sh(root, 'init', '-q', '--bare', origin);
    sh(root, 'init', '-q', '-b', 'main', cwd);
    const git = (...args) => sh(cwd, ...args);
    git('remote', 'add', 'origin', origin);
    const commit = (message, files) => {
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
        writeFileSync(path.join(cwd, file), text);
      }
      git('add', '-A');
      git('commit', '-q', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    const lines = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n';
    commit('base', {
      'api/ai.ts': lines,
      'eval/run.ts': 'x\n',
      'README.md': 'r\n',
      'src/app.ts': 's\n',
    });
    git('push', '-q', 'origin', 'main');
    git('fetch', '-q', 'origin');
    return { root, origin, cwd, git, commit, lines };
  }

  // The last argument stands in for the GitHub API: this workflow's last
  // finished run on the PR, `{ sha, passed }`, or null for none.
  const run = (cwd, vars, last = null) =>
    evaluate(
      { GITHUB_EVENT_NAME: 'pull_request', DRAFT: 'false', BASE_REF: 'main', ...vars },
      AI,
      cwd,
      async () => last,
    );
  // A push to `after`, the last finished run having been on `sha`.
  const pushed = async (cwd, sha, after, passed = true) =>
    (await run(cwd, { ACTION: 'synchronize', AFTER: after }, { sha, passed })).grade;

  it('skips a PR that touches no AI code, opened or marked ready', async () => {
    const { cwd, git, commit } = repo();
    git('checkout', '-q', '-b', 'pr');
    const head = commit('docs', { 'README.md': 'r2\n' });
    expect((await run(cwd, { ACTION: 'opened', AFTER: head })).grade).toBe(false);
    expect((await run(cwd, { ACTION: 'ready_for_review', AFTER: head })).grade).toBe(false);
  });

  it('grades a ready PR that touches AI code, but not as a draft', async () => {
    const { cwd, git, commit, lines } = repo();
    git('checkout', '-q', '-b', 'pr');
    const head = commit('ai', { 'api/ai.ts': lines.replace('c\n', 'C\n') });
    expect((await run(cwd, { ACTION: 'ready_for_review', AFTER: head })).grade).toBe(true);
    expect((await run(cwd, { ACTION: 'opened', AFTER: head, DRAFT: 'true' })).grade).toBe(false);
  });

  it('on a push, grades when the AI changes moved or the last run didn’t pass', async () => {
    const { cwd, git, commit, lines } = repo();
    git('checkout', '-q', '-b', 'pr');
    const docs = commit('docs', { 'README.md': 'r2\n' });
    const firstAi = commit('ai', { 'api/ai.ts': lines.replace('c\n', 'C\n') });
    const moreDocs = commit('more docs', { 'src/app.ts': 's2\n' });
    const moreAi = commit('eval', { 'eval/run.ts': 'y\n' });
    expect(await pushed(cwd, docs, firstAi)).toBe(true);
    expect(await pushed(cwd, firstAi, moreDocs)).toBe(false);
    // The grade on firstAi failed, errored or was cancelled: a docs push
    // mustn't turn the check green.
    expect(await pushed(cwd, firstAi, moreDocs, false)).toBe(true);
    expect(await pushed(cwd, moreDocs, moreAi)).toBe(true);
    // No run to compare with at all.
    expect((await run(cwd, { ACTION: 'synchronize', AFTER: moreDocs }, null)).grade).toBe(true);
  });

  it('compares with the last run’s head, past commits that never got a run', async () => {
    const { cwd, git, commit, lines } = repo();
    git('checkout', '-q', '-b', 'pr');
    const graded = commit('ai', { 'api/ai.ts': lines.replace('c\n', 'C\n') });
    // Pushed while the PR had a conflict, or with a skip-ci marker: no run.
    commit('more ai', { 'api/ai.ts': lines.replace('c\n', 'C2\n') });
    const docs = commit('docs', { 'README.md': 'r2\n' });
    expect(await pushed(cwd, graded, docs)).toBe(true);
    // A no-run commit that left the AI code alone is passed over too.
    git('reset', '-q', '--hard', graded);
    commit('docs only', { 'README.md': 'r3\n' });
    const later = commit('more docs', { 'src/app.ts': 's3\n' });
    expect(await pushed(cwd, graded, later)).toBe(false);
  });

  it('skips a reworded amend, a rebase and a merge that only bring in main', async () => {
    const { cwd, git, commit, lines } = repo();
    git('checkout', '-q', '-b', 'pr');
    const first = commit('ai', { 'api/ai.ts': lines.replace('g\n', 'G\n') });
    git('commit', '-q', '--amend', '-m', 'reworded');
    const amended = git('rev-parse', 'HEAD');
    // main moves: an AI path the PR doesn't touch, and the PR's own AI file
    // above its change, adding lines that shift it down.
    git('checkout', '-q', 'main');
    commit('main moves', {
      'eval/run.ts': 'z\n',
      'api/ai.ts': `top\n${lines.replace('d\n', 'D\nD2\n')}`,
    });
    git('push', '-q', 'origin', 'main');
    git('fetch', '-q', 'origin');
    git('checkout', '-q', 'pr');
    git('rebase', '-q', 'main');
    const rebased = git('rev-parse', 'HEAD');
    expect(await pushed(cwd, first, amended)).toBe(false);
    expect(await pushed(cwd, amended, rebased)).toBe(false);

    git('checkout', '-q', '-b', 'docs-pr', 'origin/main~1');
    const docs = commit('docs', { 'README.md': 'r2\n' });
    git('merge', '-q', '--no-edit', 'origin/main');
    expect(await pushed(cwd, docs, git('rev-parse', 'HEAD'))).toBe(false);
  });

  it('sees a second edit to a binary file', async () => {
    const { cwd, git, commit } = repo();
    git('checkout', '-q', '-b', 'pr');
    const one = commit('bin', { 'eval/data.bin': Buffer.from([0, 1, 2, 0]) });
    const two = commit('bin 2', { 'eval/data.bin': Buffer.from([0, 9, 9, 0]) });
    expect(await pushed(cwd, one, two)).toBe(true);
  });

  it('reads a diff larger than a megabyte', async () => {
    const { cwd, git, commit } = repo();
    git('checkout', '-q', '-b', 'pr');
    const big = commit('big', { 'eval/big.txt': 'rulebook line\n'.repeat(150_000) });
    // Read, not graded by the can't-read fallback.
    expect(await run(cwd, { ACTION: 'ready_for_review', AFTER: big })).toEqual({
      grade: true,
      reason: 'ready_for_review: the PR changes AI code',
    });
  });

  it('grades when the PR’s history or its earlier runs can’t be read', async () => {
    const { cwd, git, commit, lines } = repo();
    const unreadable = { grade: true, reason: 'the PR or its earlier runs could not be read, so it is graded' };
    expect(await run(cwd, { ACTION: 'opened', AFTER: 'f'.repeat(40) })).toEqual(unreadable);
    git('checkout', '-q', '-b', 'pr');
    const head = commit('ai', { 'api/ai.ts': lines.replace('c\n', 'C\n') });
    const offline = async () => {
      throw new Error('runs: HTTP 403');
    };
    const ctx = { GITHUB_EVENT_NAME: 'pull_request', DRAFT: 'false', BASE_REF: 'main', ACTION: 'synchronize', AFTER: head };
    expect(await evaluate(ctx, AI, cwd, offline)).toEqual(unreadable);
  });

  it('grades the PR as a whole when the last run’s head can’t be found', async () => {
    const { cwd, git, commit, lines } = repo();
    git('checkout', '-q', '-b', 'pr');
    const head = commit('ai', { 'api/ai.ts': lines.replace('c\n', 'C\n') });
    expect(
      await run(cwd, { ACTION: 'synchronize', AFTER: head }, { sha: '1'.repeat(40), passed: true }),
    ).toEqual({
      grade: true,
      reason: 'push: the last run’s head is gone, so the PR is graded as a whole',
    });
  });

  it('fetches a force-pushed-over head that only origin still has', async () => {
    const { root, origin, git, commit, lines } = repo();
    git('checkout', '-q', '-b', 'pr');
    const old = commit('ai', { 'api/ai.ts': lines.replace('c\n', 'C\n') });
    git('push', '-q', 'origin', 'pr');
    git('commit', '-q', '--amend', '-m', 'reworded');
    git('push', '-q', '-f', 'origin', 'pr');
    const head = git('rev-parse', 'HEAD');
    // A fresh checkout, like CI's, without the old head (--no-local: a local
    // clone would copy every object, the old head included).
    const ci = path.join(root, 'ci');
    sh(root, 'clone', '-q', '--no-local', origin, ci);
    sh(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    sh(ci, 'fetch', '-q', 'origin', 'pr');
    expect(await pushed(ci, old, head)).toBe(false);
  });

  it('looks up the last run only for a push, with the run’s context', async () => {
    const { cwd, git, commit, lines } = repo();
    git('checkout', '-q', '-b', 'pr');
    const one = commit('ai', { 'api/ai.ts': lines.replace('c\n', 'C\n') });
    const two = commit('docs', { 'README.md': 'r2\n' });
    const find = vi.fn().mockResolvedValue({ sha: one, passed: true });
    const ctx = {
      GITHUB_EVENT_NAME: 'pull_request',
      DRAFT: 'false',
      BASE_REF: 'main',
      HEAD_REF: 'pr',
      PR_NUMBER: '7',
      ACTION: 'synchronize',
      AFTER: two,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 't',
      GITHUB_RUN_ID: '100',
      WORKFLOW_FILE: 'eval.yml',
    };
    expect((await evaluate(ctx, AI, cwd, find)).grade).toBe(false);
    expect(find).toHaveBeenCalledWith({
      api: 'https://api.github.com',
      repo: 'o/r',
      token: 't',
      workflow: 'eval.yml',
      branch: 'pr',
      pr: '7',
      runId: '100',
    });
    find.mockClear();
    await evaluate({ ...ctx, ACTION: 'ready_for_review' }, AI, cwd, find);
    expect(find).not.toHaveBeenCalled();
  });

  it('always grades a manual run, without reading the repo', async () => {
    const ctx = { GITHUB_EVENT_NAME: 'workflow_dispatch' };
    expect((await evaluate(ctx, AI, '/nonexistent')).grade).toBe(true);
  });
});

describe('the command line', () => {
  it('prints run=… for $GITHUB_OUTPUT and the reason to stderr', () => {
    // Vitest runs from the repository root.
    const script = path.resolve('.github/scripts/eval-should-grade.mjs');
    const out = execFileSync('node', [script, 'api'], {
      env: { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out).toBe('run=true\n');
  });
});

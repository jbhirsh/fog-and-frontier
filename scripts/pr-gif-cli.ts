// Before/after GIFs of a UI change in one command, looking as they do on the
// live site:
//
//   node --experimental-strip-types scripts/pr-gif-cli.ts <scenario.ts> --dir <folder> [options]
//
// "Before" is main and "after" this checkout, working-tree changes included,
// each a local production build: main's in a temporary git worktree with
// node_modules symlinked in, each served by `vite preview` on a free port.
// They're built in the test mode, for the visual tests' sign-in flags, and
// as Vercel builds production (VERCEL_ENV), so covers ask for the image CDN.
// The scenario's setup stubs the API and signs in as needed; over the stub,
// every read goes to production's API (liveSite), so both show production's
// catalog, road miles and completions, and every photo comes through
// production's image CDN (cachePhotos), the map's tiles from OpenStreetMap
// (CARTO's need a key only Vercel has). A read production refuses without a
// real sign-in gets the stub's answer.
//
// The pointer and keys are drawn in and each frame is shown for as long as it
// lasted (scripts/pr-gif.ts). It then stops the servers it started (by their
// PIDs), removes its worktrees, commits the GIFs to the screenshots branch
// under <folder>/ and pushes it, and prints a Before/After table for the PR
// description, linked by that commit's SHA so a later push can't change what
// the PR shows.
//
// A scenario is a module whose default export is a Scenario (scripts/pr-gif.ts):
// where to open, what to record, and the mouse and keyboard steps. See
// scripts/gif-scenarios/.
//
// Options:
//   --dir <folder>        the folder on the screenshots branch: the PR's number
//   --side-by-side        also join the two into one GIF, labelled, playing in step
//   --after-only          only "after", for UI that's new: nothing to show before
//   --base <ref>          what "before" is built from (origin/main); an
//                         origin/ ref is fetched first
//   --production <url>    the live site whose API and image CDN the builds use
//                         (https://fog-and-frontier.vercel.app)
//   --mode <mode>         the Vite build mode (test, for the sign-in flags)
//   --scale <n>           device pixels per CSS pixel (2), as a high-density
//                         screen draws the page
//   --chromium <path>     a Chromium to use (or PR_GIF_CHROMIUM), if Playwright's
//                         own isn't installed
//   --branch <name>       the pictures branch (screenshots)
//   --repo <owner/name>   for the links (from the origin remote)
//   --no-push             commit, but leave pushing to you
//   --keep                keep the work directory (frames, builds) to look at
//   --allow-missing-photos  publish even if some photos failed to load (by
//                         default a photo that fails stops the run before
//                         anything is committed; photos that did load are
//                         cached in ~/.cache/pr-gif/photos for next time)

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PHOTO_CACHE,
  PRODUCTION,
  cachePhotos,
  describeFailed,
  framesToGif,
  liveSite,
  recordFrames,
  showPointer,
  sideBySide,
  waitForPhotos,
  type Scenario,
} from './pr-gif.ts';

/** Over this, a PR description may not show a GIF. */
export const GIF_WARN_BYTES = 5 * 1024 * 1024;

export interface Options {
  scenario: string;
  dir: string;
  sideBySide: boolean;
  afterOnly: boolean;
  scale: number;
  chromium: string | undefined;
  branch: string;
  repo: string | undefined;
  push: boolean;
  keep: boolean;
  production: string;
  base: string;
  mode: string;
  allowMissingPhotos: boolean;
}

export const USAGE =
  'usage: node --experimental-strip-types scripts/pr-gif-cli.ts <scenario.ts> --dir <folder> ' +
  '[--side-by-side | --after-only] [--scale 2] [--chromium <path>] [--branch screenshots] [--repo owner/name] ' +
  '[--no-push] [--keep] [--base origin/main] [--production <url>] [--mode test] [--allow-missing-photos]';

/** Reads the command line (without node and the script). */
export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = {}): Options {
  const options: Options = {
    scenario: '',
    dir: '',
    sideBySide: false,
    afterOnly: false,
    scale: 2,
    chromium: env.PR_GIF_CHROMIUM || undefined,
    branch: 'screenshots',
    repo: undefined,
    push: true,
    keep: false,
    production: PRODUCTION,
    base: 'origin/main',
    mode: 'test',
    allowMissingPhotos: false,
  };
  const fail = (why: string): never => {
    throw new Error(`${why}\n${USAGE}`);
  };
  const args = [...argv];
  const value = (flag: string) => {
    const next = args.shift();
    if (next === undefined || next.startsWith('--')) fail(`${flag} needs a value`);
    return next as string;
  };
  const url = (flag: string) => {
    const given = value(flag);
    if (!/^https?:\/\/[^/\s]+/.test(given)) fail(`${flag} must be an http(s) URL`);
    return given.replace(/\/+$/, '');
  };
  while (args.length > 0) {
    const arg = args.shift() as string;
    switch (arg) {
      case '--dir':
        options.dir = value(arg);
        break;
      case '--side-by-side':
        options.sideBySide = true;
        break;
      case '--after-only':
        options.afterOnly = true;
        break;
      case '--scale': {
        const scale = Number(value(arg));
        if (!(scale > 0)) fail('--scale must be a number above 0');
        options.scale = scale;
        break;
      }
      case '--chromium':
        options.chromium = value(arg);
        break;
      case '--branch':
        options.branch = value(arg);
        break;
      case '--repo': {
        const repo = value(arg);
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('--repo must be owner/name');
        options.repo = repo;
        break;
      }
      case '--no-push':
        options.push = false;
        break;
      case '--keep':
        options.keep = true;
        break;
      case '--production':
        options.production = url(arg);
        break;
      case '--base':
        options.base = value(arg);
        break;
      case '--mode':
        options.mode = value(arg);
        break;
      case '--allow-missing-photos':
        options.allowMissingPhotos = true;
        break;
      default:
        if (arg.startsWith('--')) fail(`unknown option ${arg}`);
        if (options.scenario) fail(`one scenario at a time (got ${options.scenario} and ${arg})`);
        options.scenario = arg;
    }
  }
  if (!options.scenario) fail('which scenario?');
  if (!options.dir) fail('--dir is needed: the folder on the screenshots branch (the PR number)');
  if (!/^[\w.-]+$/.test(options.dir)) fail('--dir is one folder name: letters, digits, . _ -');
  if (options.afterOnly && options.sideBySide) fail('--after-only has nothing to put beside it');
  return options;
}

/** owner/name from a remote URL: GitHub's own, or a proxy's that ends in them. */
export function repoFromRemote(url: string): string {
  const match = /[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) throw new Error(`can't tell the repository from ${url}; pass --repo owner/name`);
  return `${match[1]}/${match[2]}`;
}

/** The raw link to a file on the pictures branch, fixed at one commit. */
export function rawUrl(repo: string, sha: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;
}

/** The GIFs' names on the pictures branch. */
export function gifNames(name: string) {
  return {
    before: `${name}-before.gif`,
    after: `${name}-after.gif`,
    side: `${name}-side-by-side.gif`,
  };
}

/** The Before/After table for the PR description, and the joined GIF if made. */
export function markdown({
  repo,
  sha,
  dir,
  name,
  before,
  sideBySide: joined,
  afterOnly = false,
}: {
  repo: string;
  sha: string;
  dir: string;
  name: string;
  /** What "before" was built from. */
  before: string;
  sideBySide: boolean;
  /** New UI: only an "after". */
  afterOnly?: boolean;
}): string {
  const files = gifNames(name);
  const img = (file: string, width: number) =>
    `<img src="${rawUrl(repo, sha, `${dir}/${file}`)}" width="${width}">`;
  if (afterOnly) return ['| After |', '|---|', `| ${img(files.after, 420)} |`].join('\n');
  const lines = [
    `| Before (${before}) | After |`,
    '|---|---|',
    `| ${img(files.before, 420)} | ${img(files.after, 420)} |`,
  ];
  if (joined) lines.push('', img(files.side, 840));
  return lines.join('\n');
}

/** The branch an origin/ ref names, to fetch first; null for anything else. */
export function remoteBranch(ref: string): string | null {
  return ref.startsWith('origin/') ? ref.slice('origin/'.length) : null;
}

/** A GIF's size for the log, and a warning when it's too big to show. */
export function sizeNote(file: string, bytes: number): string {
  const size = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  return bytes > GIF_WARN_BYTES
    ? `pr-gif: ${file} is ${size}, over 5 MB, which a PR may not show: record a shorter flow, or a narrower one (width)`
    : `pr-gif: ${file} is ${size}`;
}

/** A port nothing is listening on, from the OS. */
export function freePort(): Promise<number> {
  return new Promise((done, failed) => {
    const server = createServer();
    server.once('error', failed);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/**
 * Runs `vite build` in `cwd` into `outDir`, as Vercel builds production
 * (VERCEL_ENV), so covers ask for the image CDN as they do there.
 */
function build(root: string, cwd: string, outDir: string, mode: string) {
  console.log(`pr-gif: building ${cwd} (${mode})`);
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', mode, '--outDir', outDir, '--emptyOutDir'],
    { cwd, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, VERCEL_ENV: 'production' } },
  );
}

/**
 * Serves `outDir` with `vite preview` on a free port, and resolves once it
 * answers. On localhost: tests/visual/helpers.ts's mockApis lets anything
 * that isn't through to the network.
 */
async function serve(
  root: string,
  cwd: string,
  outDir: string,
  servers: ChildProcess[],
): Promise<string> {
  const port = await freePort();
  const server = spawn(
    process.execPath,
    [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', outDir, '--port', String(port), '--strictPort'],
    { cwd, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  servers.push(server);
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`vite preview for ${outDir} exited (${server.exitCode})`);
    try {
      if ((await fetch(url)).ok) return url;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`vite preview for ${outDir} didn't answer at ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Stops the servers this started, by their PIDs, and waits for them to go. */
async function stopServers(servers: ChildProcess[]) {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((done) => {
          if (server.exitCode !== null || server.signalCode !== null) return done();
          server.once('exit', () => done());
          server.kill('SIGTERM');
        }),
    ),
  );
}

function report(gif: string) {
  const note = sizeNote(basename(gif), statSync(gif).size);
  if (note.includes('over 5 MB')) console.warn(note);
  else console.log(note);
}

async function record(
  scenario: Scenario,
  url: string,
  options: Options,
  frames: string,
  gif: string,
): Promise<void> {
  const { chromium } = await import('@playwright/test');
  // Ctrl-C is this script's to handle: Playwright's own would exit before
  // the servers and worktrees are cleaned up.
  const browser = await chromium.launch({ executablePath: options.chromium, handleSIGINT: false });
  try {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      deviceScaleFactor: options.scale,
      serviceWorkers: 'block',
    });
    await showPointer(context);
    const page = await context.newPage();
    await scenario.setup?.(page);
    // After the scenario's stub, so these routes come first.
    await liveSite(page, `${options.production}/api/graphql`);
    // Last, so photos come from the cache before any other route.
    const photos = await cachePhotos(page, { production: options.production });
    const side = basename(gif, '.gif');
    const refuseGaps = () => {
      if (!photos.failed.size || options.allowMissingPhotos) return;
      throw new Error(
        `pr-gif: ${photos.failed.size} photo${photos.failed.size === 1 ? '' : 's'} didn't load for ${side}: ${describeFailed(photos.failed)}. ` +
          `Nothing was committed. Photos that did load are cached in ${PHOTO_CACHE}; try again once the host lets this machine back in, ` +
          'or pass --allow-missing-photos.',
      );
    };
    await page.goto(url + scenario.path);
    await scenario.ready?.(page);
    await waitForPhotos(page);
    // Before recording anything, if the photos in view already failed.
    refuseGaps();
    const stop = recordFrames(page, scenario.clip, frames);
    let result;
    try {
      await scenario.run(page);
    } finally {
      result = await stop();
    }
    // And any that failed on the way, as the flow scrolled or opened them.
    refuseGaps();
    console.log(
      `pr-gif: ${basename(gif)}: ${result.frames} frames at ${result.fps.toFixed(1)} a second`,
    );
    framesToGif(frames, gif, { width: scenario.width ?? 600 });
    report(gif);
  } finally {
    await browser.close();
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv, process.env);
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const { runnerImport } = await import('vite');
  const { module } = await runnerImport<{ default: Scenario }>(resolve(options.scenario));
  const scenario = module.default;
  const repo = options.repo ?? repoFromRemote(git(root, 'remote', 'get-url', 'origin'));
  const work = mkdtempSync(join(tmpdir(), 'pr-gif-'));
  const files = gifNames(scenario.name);
  const servers: ChildProcess[] = [];
  const worktrees: string[] = [];
  const cleanUp = async () => {
    await stopServers(servers);
    for (const tree of worktrees) {
      try {
        git(root, 'worktree', 'remove', '--force', tree);
      } catch {
        // Already gone.
      }
    }
    if (options.keep) console.log(`pr-gif: kept ${work}`);
    else rmSync(work, { recursive: true, force: true });
  };
  const interrupted = () => {
    void cleanUp().finally(() => process.exit(130));
  };
  process.once('SIGINT', interrupted);
  try {
    let beforeUrl: string | undefined;
    if (!options.afterOnly) {
      // Before: the base, in a worktree that borrows this checkout's node_modules.
      const fetchBase = remoteBranch(options.base);
      if (fetchBase) git(root, 'fetch', '--quiet', 'origin', fetchBase);
      const baseTree = join(work, 'base');
      git(root, 'worktree', 'add', '--detach', '--quiet', baseTree, options.base);
      worktrees.push(baseTree);
      symlinkSync(join(root, 'node_modules'), join(baseTree, 'node_modules'), 'dir');
      build(root, baseTree, join(work, 'dist-before'), options.mode);
      beforeUrl = await serve(root, baseTree, join(work, 'dist-before'), servers);
    }
    build(root, root, join(work, 'dist-after'), options.mode);
    const afterUrl = await serve(root, root, join(work, 'dist-after'), servers);
    const before = `\`${options.base.replace(/^origin\//, '')}\``;
    const head = git(root, 'rev-parse', '--short', 'HEAD');
    const from = `local builds of ${options.afterOnly ? '' : `${options.base} and `}${head} (with any uncommitted changes), reading ${options.production}`;
    console.log(`pr-gif: ${beforeUrl ? `before ${beforeUrl}, ` : ''}after ${afterUrl}`);

    const out = join(work, 'gifs');
    const made: string[] = [];
    if (beforeUrl) {
      await record(scenario, beforeUrl, options, join(work, 'frames-before'), join(out, files.before));
      made.push(files.before);
    }
    await record(scenario, afterUrl, options, join(work, 'frames-after'), join(out, files.after));
    made.push(files.after);
    if (options.sideBySide) {
      sideBySide(join(work, 'frames-before'), join(work, 'frames-after'), join(out, files.side), {
        width: Math.max(2 * (scenario.width ?? 600), 800),
      });
      report(join(out, files.side));
      made.push(files.side);
    }
    await stopServers(servers);

    // The pictures branch: commit the GIFs under <dir>/, then push.
    git(root, 'fetch', '--quiet', 'origin', options.branch);
    const shots = join(work, 'shots');
    git(root, 'worktree', 'add', '--detach', '--quiet', shots, `origin/${options.branch}`);
    worktrees.push(shots);
    mkdirSync(join(shots, options.dir), { recursive: true });
    for (const file of made) copyFileSync(join(out, file), join(shots, options.dir, file));
    git(shots, 'add', ...made.map((file) => `${options.dir}/${file}`));
    git(
      shots,
      'commit',
      '--quiet',
      '-m',
      `Add the ${scenario.name} GIFs for ${options.dir}`,
      '-m',
      `${options.afterOnly ? 'A recording' : 'Before and after recordings'} of ${options.scenario}, from ${from}, made by scripts/pr-gif-cli.ts.`,
    );
    const sha = git(shots, 'rev-parse', 'HEAD');
    if (options.push) {
      try {
        git(shots, 'push', '--quiet', 'origin', `HEAD:${options.branch}`);
      } catch (error) {
        // The commit outlives its worktree (it's in this repository), and
        // the work directory is kept, so nothing needs recording again.
        options.keep = true;
        throw new Error(
          `pr-gif: pushing ${sha} failed; push it with: git push origin ${sha}:${options.branch} (GIFs in ${out})`,
          { cause: error },
        );
      }
      console.log(`pr-gif: pushed ${sha.slice(0, 7)} to ${options.branch}`);
    } else {
      console.log(
        `pr-gif: committed ${sha} but didn't push it: git push origin ${sha}:${options.branch}`,
      );
    }
    console.log(
      `\n${markdown({ repo, sha, dir: options.dir, name: scenario.name, before, sideBySide: options.sideBySide, afterOnly: options.afterOnly })}\n`,
    );
    // Kept for a look: the GIFs too, since the worktree they were copied to goes.
    if (options.keep) console.log(`pr-gif: GIFs in ${out}`);
  } finally {
    process.off('SIGINT', interrupted);
    await cleanUp();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof Error && error.cause instanceof Error) console.error(error.cause.message);
    process.exitCode = 1;
  });
}

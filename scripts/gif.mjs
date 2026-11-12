// `npm run gif -- <scenario.ts> [options]`: a PR's before/after GIFs,
// recorded by the GIF tool in jbhirsh/ci, which this app shares with the
// owner's other apps (gif/cli.mjs there says what it does and which options
// it takes; this app's settings for it are the `gif` key of
// .github/ci.json).
//
// This only fetches the tool and runs it: it makes sure jbhirsh/ci is cloned
// beside this checkout, as ../ci (cloned if missing, `git pull --ff-only` if
// there, so it follows main as CI does; a pull that fails, offline say, runs
// what's there), then runs ../ci/gif/cli.mjs with APP_ROOT set to this
// checkout. CI_TOOLING_DIR points it at another clone instead, left as it is
// (one being changed, say).
//
// The scenarios (scripts/gif-scenarios/) and the setup module
// (scripts/gif-setup.ts) are this app's own, typed by scripts/gif-types.ts:
// the shapes the tool hands them, written here rather than imported from
// ../ci, so typecheck, lint and knip pass in a checkout (CI's) that has no
// ../ci. The tool's self-test (gif/selftest.mjs, run by jbhirsh/ci's CI
// against this app) loads each and checks it against the tool's own idea of
// those shapes, so the copy can't drift unnoticed.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAsScript } from './run-as-script.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Fetches the GIF tool (unless CI_TOOLING_DIR names a clone) and runs it with
 * these arguments; resolves to its exit code.
 * @param {readonly string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {string} root the checkout, beside which ../ci is cloned: given
 *   always, so a test can't reach a real one
 * @returns {Promise<number>}
 */
export function run(argv, env, root) {
  const given = env.CI_TOOLING_DIR;
  const tooling = given ? path.resolve(given) : path.resolve(root, '..', 'ci');
  /** Runs git, its output shown; says whether it worked. */
  const git = (/** @type {string[]} */ args) =>
    spawnSync('git', args, { stdio: 'inherit', env }).status === 0;

  if (!given) {
    if (existsSync(path.join(tooling, '.git'))) {
      if (!git(['-C', tooling, 'pull', '--ff-only', '--quiet'])) {
        console.warn(`gif: couldn't update ${tooling}; running it as it is`);
      }
    } else if (!git(['clone', '--quiet', 'https://github.com/jbhirsh/ci', tooling])) {
      console.error(`gif: couldn't clone jbhirsh/ci into ${tooling}`);
      return Promise.resolve(1);
    }
  }
  const cli = path.join(tooling, 'gif', 'cli.mjs');
  if (!existsSync(cli)) {
    console.error(`gif: ${cli} isn't there: is ${tooling} a clone of jbhirsh/ci?`);
    return Promise.resolve(1);
  }
  const result = spawnSync(process.execPath, [cli, ...argv], {
    stdio: 'inherit',
    env: { ...env, APP_ROOT: root },
  });
  return Promise.resolve(result.status ?? 1);
}

/**
 * `npm run gif`: runs the tool for this checkout, with this process's
 * environment.
 * @param {readonly string[]} argv
 */
export function main(argv) {
  return run(argv, process.env, ROOT);
}

runAsScript(import.meta.url, main);

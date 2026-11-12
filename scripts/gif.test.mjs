import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, run } from './gif.mjs';

afterEach(() => vi.restoreAllMocks());

/**
 * A checkout beside a folder for ../ci, a fake git on PATH that logs its
 * arguments and exits with GIT_EXIT, and a fake GIF tool that logs its
 * arguments and APP_ROOT.
 */
function setup({ cloned = true, tool = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gif-'));
  const root = path.join(dir, 'app');
  const ci = path.join(dir, 'ci');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'log');
  mkdirSync(root);
  mkdirSync(bin);
  if (cloned) mkdirSync(path.join(ci, '.git'), { recursive: true });
  if (tool) {
    mkdirSync(path.join(ci, 'gif'), { recursive: true });
    writeFileSync(
      path.join(ci, 'gif', 'cli.mjs'),
      `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(log)}, 'gif ' + process.argv.slice(2).join(' ') + ' ' + process.env.APP_ROOT + '\\n');
process.exit(Number(process.env.GIF_EXIT ?? 0));
`,
    );
  }
  const git = path.join(bin, 'git');
  writeFileSync(
    git,
    `#!/bin/sh\necho "git $*" >> ${JSON.stringify(log)}\nexit "\${GIT_EXIT:-0}"\n`,
  );
  chmodSync(git, 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const logged = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  return { dir, root, ci, env, logged };
}

describe('main', () => {
  it('pulls ../ci, then runs its GIF tool with the arguments and this checkout', async () => {
    const { root, ci, env, logged } = setup();
    expect(await run(['scenario.ts', '--dir', '42'], env, root)).toBe(0);
    expect(logged()).toEqual([
      `git -C ${ci} pull --ff-only --quiet`,
      `gif scenario.ts --dir 42 ${root}`,
    ]);
  });

  it("clones jbhirsh/ci when it isn't there", async () => {
    const { root, ci, env, logged } = setup({ cloned: false });
    expect(await run([], env, root)).toBe(0);
    expect(logged()[0]).toBe(`git clone --quiet https://github.com/jbhirsh/ci ${ci}`);
  });

  it("stops when the clone fails, and runs what's there when a pull does", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clone = setup({ cloned: false });
    expect(await run([], { ...clone.env, GIT_EXIT: '1' }, clone.root)).toBe(1);
    expect(clone.logged()).toHaveLength(1);
    const pull = setup();
    expect(await run(['s.ts'], { ...pull.env, GIT_EXIT: '1' }, pull.root)).toBe(0);
    expect(warn).toHaveBeenCalledWith(`gif: couldn't update ${pull.ci}; running it as it is`);
    expect(pull.logged()[1]).toBe(`gif s.ts ${pull.root}`);
  });

  it('runs a clone CI_TOOLING_DIR names as it is, without git', async () => {
    const { root, ci, env, logged } = setup({ cloned: false });
    expect(await run(['s.ts'], { ...env, CI_TOOLING_DIR: ci }, root)).toBe(0);
    expect(logged()).toEqual([`gif s.ts ${root}`]);
  });

  it("exits with the tool's code, and 1 when the tool isn't there", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = setup();
    expect(await run([], { ...tool.env, GIF_EXIT: '3' }, tool.root)).toBe(3);
    const none = setup({ tool: false });
    expect(await run([], none.env, none.root)).toBe(1);
    expect(error).toHaveBeenCalledWith(
      `gif: ${path.join(none.ci, 'gif', 'cli.mjs')} isn't there: is ${none.ci} a clone of jbhirsh/ci?`,
    );
  });

  it('runs for this checkout from main, here with CI_TOOLING_DIR set so ../ci is left alone', async () => {
    const { ci, env, logged } = setup({ cloned: false });
    vi.stubEnv('PATH', env.PATH);
    vi.stubEnv('CI_TOOLING_DIR', ci);
    try {
      expect(await main(['s.ts'])).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(logged()).toEqual([`gif s.ts ${path.resolve(import.meta.dirname, '..')}`]);
  });
});

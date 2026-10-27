import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAsScript } from './run-as-script.ts';

const argv = process.argv;
const entry = resolve('scripts/some-script.ts');
const url = pathToFileURL(entry).href;

afterEach(() => {
  process.argv = argv;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('runAsScript', () => {
  it('runs main with the arguments when node was started on the script', async () => {
    process.argv = ['node', entry, 'draft', '--all'];
    const main = vi.fn(() => Promise.resolve());
    runAsScript(url, main);
    await vi.waitFor(() => expect(main).toHaveBeenCalledWith(['draft', '--all']));
    expect(process.exitCode).toBeUndefined();
  });

  it('leaves main alone when another file was started, or none', () => {
    const main = vi.fn(() => Promise.resolve());
    process.argv = ['node', resolve('scripts/other.ts')];
    runAsScript(url, main);
    process.argv = ['node'];
    runAsScript(url, main);
    expect(main).not.toHaveBeenCalled();
  });

  it("prints a failure's message and sets exit code 1", async () => {
    process.argv = ['node', entry];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    runAsScript(url, () => Promise.reject(new Error('usage: x')));
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(error).toHaveBeenCalledWith('usage: x');
    // Something thrown that isn't an Error is printed as it is.
    const thrown: unknown = 'plain';
    runAsScript(url, () =>
      Promise.resolve().then(() => {
        throw thrown;
      }),
    );
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('plain'));
  });
});

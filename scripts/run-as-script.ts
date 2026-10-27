// Runs a script's main when node was started on that script, not when a
// test imports it, and reports a failure as its message and exit code 1
// rather than a stack trace.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function runAsScript(url: string, main: (argv: string[]) => Promise<unknown>): void {
  const entry = process.argv[1];
  if (!entry || url !== pathToFileURL(resolve(entry)).href) return;
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

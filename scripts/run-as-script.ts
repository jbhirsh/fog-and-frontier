// Runs a script's main when node was started on that script, not when a
// test imports it. A number main resolves to is the exit code; a failure is
// reported as its message, with its `exitCode` (a ScriptError's) or 1, rather
// than a stack trace. exitCode, not exit(): a piped stdout finishes flushing.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A failure that exits with its own code, such as 2 for a usage error. */
export class ScriptError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function runAsScript(url: string, main: (argv: string[]) => Promise<unknown>): void {
  const entry = process.argv[1];
  if (!entry || url !== pathToFileURL(resolve(entry)).href) return;
  main(process.argv.slice(2)).then(
    (code) => {
      if (typeof code === 'number') process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = error instanceof ScriptError ? error.exitCode : 1;
    },
  );
}

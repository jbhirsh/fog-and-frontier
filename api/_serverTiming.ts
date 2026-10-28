// Files in api/ that start with `_` are not exposed as routes by Vercel.
//
// Where a GraphQL request's time went on the server, sent back as a
// Server-Timing header, which the browser's network panel shows beside the
// request's own timings: setting up the schema (only a cold instance's
// first request waits for it), checking who's signed in (a Clerk lookup,
// and an owner's `users` row), and running the operation.

export type RequestTiming = {
  /** Waiting for the schema batch: nonzero only on a cold instance. */
  schemaMs: number;
  /** Resolving the caller from the Bearer token. */
  authMs: number;
  /** Parsing, validating and resolving the operation. */
  execMs: number;
};

function entry(name: string, ms: number, desc: string): string {
  return `${name};dur=${ms.toFixed(1)};desc="${desc}"`;
}

export function serverTimingHeader(timing: RequestTiming): string {
  return [
    entry('schema', timing.schemaMs, 'Schema setup'),
    entry('auth', timing.authMs, 'Sign-in check'),
    entry('exec', timing.execMs, 'Operation'),
  ].join(', ');
}

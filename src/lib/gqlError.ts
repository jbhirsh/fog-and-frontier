import { CombinedGraphQLErrors } from '@apollo/client/errors';

// Centralized GraphQL error mapping — the single replacement for the old
// per-call `jsonOrThrow` (issue #91). Apollo surfaces resolver errors as a
// `CombinedGraphQLErrors` (HTTP 200 + `errors[]`); transport/network failures
// arrive as plain Errors with no `errors` array.
//
// The server sets two extension fields on each GraphQL error (see the plan's
// error model):
//   • `extensions.code`    — Apollo category: UNAUTHENTICATED / FORBIDDEN /
//                            NOT_FOUND / CONFLICT / BAD_USER_INPUT /
//                            BAD_GATEWAY / INTERNAL
//   • `extensions.appCode` — REST discriminator: trip_past / voting_locked /
//                            not_adder / not_voting / not_planning / duplicate /
//                            already_member / creator_cannot_leave

export type GqlErrorInfo = {
  /** Apollo error category from `extensions.code`, or null for network errors. */
  code: string | null;
  /** REST discriminator from `extensions.appCode`, or null when absent. */
  appCode: string | null;
  /** Human-readable message (first GraphQL error, else the Error message). */
  message: string;
};

export function gqlErrorInfo(error: unknown): GqlErrorInfo {
  if (CombinedGraphQLErrors.is(error)) {
    const first = error.errors[0];
    const ext: Record<string, unknown> = first?.extensions ?? {};
    const code = typeof ext.code === 'string' ? ext.code : null;
    const appCode = typeof ext.appCode === 'string' ? ext.appCode : null;
    return { code, appCode, message: first?.message ?? error.message };
  }
  return {
    code: null,
    appCode: null,
    message: error instanceof Error ? error.message : 'Request failed',
  };
}

/** REST discriminator (`extensions.appCode`) for switch-on-code flows like
 * add-to-trip (trip_past vs duplicate). Null for network errors / no appCode. */
export function appCodeOf(error: unknown): string | null {
  return gqlErrorInfo(error).appCode;
}

/** Apollo category (`extensions.code`). Null for network/transport errors. */
export function errorCodeOf(error: unknown): string | null {
  return gqlErrorInfo(error).code;
}

// Trip read-state, mirroring the old REST mapping (401→unauthorized,
// 404→not-found, else failed). Note: `trip(id)` returns *null* (not an error)
// for missing/non-member trips — callers map `data.trip === null` to
// 'not-found' themselves; this maps the *error* channel only.
export type TripLoadError = 'unauthorized' | 'not-found' | 'failed';

export function tripLoadErrorFrom(error: unknown): TripLoadError {
  const { code } = gqlErrorInfo(error);
  if (code === 'UNAUTHENTICATED') return 'unauthorized';
  if (code === 'NOT_FOUND') return 'not-found';
  return 'failed';
}

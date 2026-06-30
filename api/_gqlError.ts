import { GraphQLError } from 'graphql';

// Files in api/ that start with `_` are not exposed as routes by Vercel.
//
// Error model for the consolidated GraphQL API (issue #91). Every intentional
// (expected, client-facing) failure is a `GraphQLError` with two extensions:
//
//   extensions.code    — the Apollo error category (UNAUTHENTICATED, FORBIDDEN,
//                        NOT_FOUND, CONFLICT, BAD_USER_INPUT, BAD_GATEWAY). This
//                        is what `formatError` keys on to decide user-vs-server
//                        (server errors get logged via #20's logServerError).
//   extensions.appCode — the fine-grained REST discriminator the client used to
//                        read off the JSON body (`trip_past`, `voting_locked`,
//                        …). Preserved verbatim so the client error mapping is a
//                        faithful port of the old `response.code` switch.
//
// A GraphQLError thrown from a resolver returns HTTP 200 + `errors[]` (Apollo's
// transport), so these never reach the express error-middleware; they are
// "expected" and not logged.

// The Apollo/GraphQL error category. UNAUTHENTICATED / FORBIDDEN / BAD_USER_INPUT
// are Apollo built-ins; NOT_FOUND / CONFLICT / BAD_GATEWAY are custom codes we
// add for a faithful mapping of the REST status codes (404 / 409 / 502).
export type ErrorCategory =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BAD_USER_INPUT'
  | 'BAD_GATEWAY'
  | 'INTERNAL';

// The REST discriminator carried on `extensions.appCode`. Mirrors the `code`
// field the old JSON error bodies set, so the client can branch on it exactly
// as before.
export type AppCode =
  | 'trip_past'
  | 'voting_locked'
  | 'not_adder'
  | 'not_voting'
  | 'not_planning'
  | 'duplicate'
  | 'already_member'
  | 'creator_cannot_leave';

export function gqlError(
  message: string,
  category: ErrorCategory,
  appCode?: AppCode,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: appCode
      ? { code: category, appCode }
      : { code: category },
  });
}

// 401 — anonymous caller (no/invalid token).
export function unauthenticated(message = 'unauthorized'): GraphQLError {
  return gqlError(message, 'UNAUTHENTICATED');
}

// 403 — authenticated but not permitted (non-owner, non-creator, not the adder).
export function forbidden(
  message = 'forbidden',
  appCode?: AppCode,
): GraphQLError {
  return gqlError(message, 'FORBIDDEN', appCode);
}

// 404 — missing, or existence deliberately hidden from a non-member.
export function notFound(message = 'not found'): GraphQLError {
  return gqlError(message, 'NOT_FOUND');
}

// 409 — state conflict (trip past, voting locked, duplicate, already a member …).
export function conflict(message: string, appCode?: AppCode): GraphQLError {
  return gqlError(message, 'CONFLICT', appCode);
}

// 400 — write validation failure (malformed input, oversize JSON, bad URL …).
export function badInput(message: string): GraphQLError {
  return gqlError(message, 'BAD_USER_INPUT');
}

// 502 — upstream (Gemini) failure.
export function badGateway(message = 'upstream request failed'): GraphQLError {
  return gqlError(message, 'BAD_GATEWAY');
}

// The set of categories that represent an *expected*, client-facing error.
// `formatError` logs anything NOT in this set (INTERNAL, parse/validation, etc.)
// via logServerError, preserving the #20 observability contract.
export const USER_FACING_CODES: ReadonlySet<string> = new Set<ErrorCategory>([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'BAD_USER_INPUT',
  'BAD_GATEWAY',
]);

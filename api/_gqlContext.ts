import type { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { callerFromSession, type CurrentUser } from './_auth.js';
import { auth } from './_betterAuth.js';
import { logServerError } from './_log.js';
import {
  getTripDetail,
  getTripRow,
  isTripMember,
  type MemberContext,
  type Trip,
} from './_trips.js';
import { forbidden, notFound, unauthenticated } from './_gqlError.js';
import type { RequestTiming } from './_serverTiming.js';

// Files in api/ that start with `_` are not exposed as routes by Vercel.
//
// GraphQL request context + auth guards (issue #91). The context reads the
// caller once, from the session cookie Better Auth set at sign-in
// (_betterAuth.ts). Guards THROW a GraphQLError instead of writing a `res`.
// They are the server-side auth gate for every resolver: `requireOwnerCtx`
// for site-wide writes and paid calls, `requireMemberCtx` /
// `requireCreatorCtx` for trip-scoped actions, and `requireUserCtx` for any
// signed-in account (claiming an invite, and suggesting an activity with its
// capped Gemini draft, #73).

export type GqlContext = {
  caller: CurrentUser | null;
  /** How long getting here took, for the Server-Timing header (graphql.ts). */
  timing?: Pick<RequestTiming, 'schemaMs' | 'authMs'>;
};

// Better Auth's session cookie, under either of its names (`__Secure-` on
// https). A request without one is signed out, with no lookup to make.
const SESSION_COOKIE = /(^|;\s*)(__Secure-)?better-auth\.session_token=/;

/** Whether a request carries a session cookie at all. */
export function hasSessionCookie(cookie: string | undefined): boolean {
  return typeof cookie === 'string' && SESSION_COOKIE.test(cookie);
}

// Builds the per-request context: the caller the session cookie names, after
// Better Auth checks it against its session table. A session it can't read
// (a deployment missing its auth settings, the database down) leaves the
// caller signed out, logged, rather than failing the public catalog with it.
export async function buildContext(req: Request): Promise<GqlContext> {
  if (!hasSessionCookie(req.headers.cookie)) return { caller: null };
  try {
    const session = await auth().api.getSession({ headers: fromNodeHeaders(req.headers) });
    return { caller: callerFromSession(session) };
  } catch (err) {
    logServerError(err, { route: '/api/graphql', detail: 'session lookup failed' });
    return { caller: null };
  }
}

// Any authenticated account (owner or editor). Anon → UNAUTHENTICATED.
export function requireUserCtx(ctx: GqlContext): CurrentUser {
  if (!ctx.caller) throw unauthenticated();
  return ctx.caller;
}

// Site owner (the real gate for catalog writes + paid Gemini calls). Anon →
// UNAUTHENTICATED, signed-in non-owner → FORBIDDEN.
export function requireOwnerCtx(ctx: GqlContext): CurrentUser {
  if (!ctx.caller) throw unauthenticated();
  if (ctx.caller.role !== 'owner') throw forbidden();
  return ctx.caller;
}

// Trip member. Anon → UNAUTHENTICATED; non-member or missing trip → NOT_FOUND
// (existence hidden, #51 privacy). Returns the member context.
export async function requireMemberCtx(ctx: GqlContext, tripId: string): Promise<MemberContext> {
  if (!ctx.caller) throw unauthenticated();
  const trip = await getTripRow(tripId);
  const member = await isTripMember(tripId, ctx.caller.email);
  if (!trip || !member) throw notFound();
  return {
    email: ctx.caller.email,
    role: ctx.caller.role,
    isCreator: trip.creator_email === ctx.caller.email,
  };
}

// Trip creator (delete, lifecycle transitions, removing other members). A
// non-creator member gets FORBIDDEN — they can see the trip, so 404 wouldn't
// hide anything.
export async function requireCreatorCtx(ctx: GqlContext, tripId: string): Promise<MemberContext> {
  const member = await requireMemberCtx(ctx, tripId);
  if (!member.isCreator) throw forbidden();
  return member;
}

// Resolver for `trip(id)`: null for a missing trip OR a non-member (hides
// existence), UNAUTHENTICATED for anon, so a non-member can't tell a private
// trip from a non-existent one.
export async function loadTripForMemberOrNull(
  ctx: GqlContext,
  tripId: string,
): Promise<Trip | null> {
  if (!ctx.caller) throw unauthenticated();
  const member = await isTripMember(tripId, ctx.caller.email);
  if (!member) return null;
  return getTripDetail(tripId);
}

import type { Request } from 'express';
import { getCurrentUserFromToken, type CurrentUser } from './_auth.js';
import {
  getTripDetail,
  getTripRow,
  isTripMember,
  type MemberContext,
  type Trip,
} from './_trips.js';
import { forbidden, notFound, unauthenticated } from './_gqlError.js';

// Files in api/ that start with `_` are not exposed as routes by Vercel.
//
// GraphQL request context + auth guards (issue #91). The context authenticates
// once from the Bearer token (preserving the owner `users`-row upsert side
// effect via getCurrentUserFromToken). Guards THROW a GraphQLError instead of
// writing a `res` — they replace the REST `requireOwner`/`requireMember`/
// `requireCreator` helpers one-for-one.

export type GqlContext = { caller: CurrentUser | null };

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim() || null;
}

// Builds the per-request context. Resolves the caller from the Bearer token;
// for an owner this also upserts the `users` row (callers must have run
// ensureTripsSchema() first — graphql.ts does, at startup).
export async function buildContext(req: Request): Promise<GqlContext> {
  const caller = await getCurrentUserFromToken(bearer(req));
  return { caller };
}

// Any authenticated account (owner or editor). Anon → UNAUTHENTICATED.
export function requireUserCtx(ctx: GqlContext): CurrentUser {
  if (!ctx.caller) throw unauthenticated();
  return ctx.caller;
}

// Site owner (the real gate for catalog writes + paid Gemini calls). Anon →
// UNAUTHENTICATED, signed-in non-owner → FORBIDDEN (mirrors the REST 401/403).
export function requireOwnerCtx(ctx: GqlContext): CurrentUser {
  if (!ctx.caller) throw unauthenticated();
  if (ctx.caller.role !== 'owner') throw forbidden();
  return ctx.caller;
}

// Trip member. Anon → UNAUTHENTICATED; non-member or missing trip → NOT_FOUND
// (existence hidden, #51 privacy). Returns the member context.
export async function requireMemberCtx(
  ctx: GqlContext,
  tripId: string,
): Promise<MemberContext> {
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
export async function requireCreatorCtx(
  ctx: GqlContext,
  tripId: string,
): Promise<MemberContext> {
  const member = await requireMemberCtx(ctx, tripId);
  if (!member.isCreator) throw forbidden();
  return member;
}

// Resolver for `trip(id)`: null for a missing trip OR a non-member (hides
// existence), UNAUTHENTICATED for anon. Mirrors the REST GET behavior where a
// non-member can't tell a private trip from a non-existent one.
export async function loadTripForMemberOrNull(
  ctx: GqlContext,
  tripId: string,
): Promise<Trip | null> {
  if (!ctx.caller) throw unauthenticated();
  const member = await isTripMember(tripId, ctx.caller.email);
  if (!member) return null;
  return getTripDetail(tripId);
}

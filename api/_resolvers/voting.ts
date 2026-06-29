import { badInput, notFound } from '../_gqlError.js';
import { mapTripVote } from '../_gqlMap.js';
import {
  castVote,
  getTripRow,
  transitionToPast,
  transitionToPlanning,
  transitionToVoting,
  type TripStatus,
} from '../_trips.js';
import {
  requireCreatorCtx,
  requireMemberCtx,
  type GqlContext,
} from '../_gqlContext.js';

// Voting + lifecycle. castVote is member-gated and open only during `voting`;
// transitionTrip is creator-gated and dispatches on `to`.

async function castVoteResolver(
  _parent: unknown,
  {
    input,
  }: { input: { tripId: string; tripActivityId: string; value: number } },
  ctx: GqlContext,
) {
  if (input.value !== -1 && input.value !== 0 && input.value !== 1) {
    throw badInput('value must be -1, 0, or 1');
  }
  const member = await requireMemberCtx(ctx, input.tripId);
  const trip = await getTripRow(input.tripId);
  if (!trip) throw notFound('not found');
  const vote = await castVote(
    trip,
    input.tripActivityId,
    input.value,
    member.email,
  );
  return { vote: vote ? mapTripVote(vote) : null };
}

type TransitionInput = {
  id: string;
  to: TripStatus;
  keptActivityIds?: string[] | null;
  completedActivityIds?: string[] | null;
};

async function transitionTrip(
  _parent: unknown,
  { input }: { input: TransitionInput },
  ctx: GqlContext,
) {
  await requireCreatorCtx(ctx, input.id);
  const trip = await getTripRow(input.id);
  if (!trip) throw notFound('not found');

  if (input.to === 'planning') {
    const { kept } = await transitionToPlanning(trip, input.keptActivityIds ?? []);
    return { ok: true, status: 'planning', kept };
  }
  if (input.to === 'voting') {
    await transitionToVoting(trip);
    return { ok: true, status: 'voting' };
  }
  // to === 'past'
  const result = await transitionToPast(trip, input.completedActivityIds ?? []);
  return {
    ok: true,
    status: 'past',
    markedPastAt: result.markedPastAt,
    completedActivityIds: result.completedActivityIds,
    uncompletedActivityIds: result.uncompletedActivityIds,
  };
}

export const votingMutation = { castVote: castVoteResolver, transitionTrip };

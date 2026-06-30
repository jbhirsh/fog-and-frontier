import { notFound } from '../_gqlError.js';
import { mapTripActivity } from '../_gqlMap.js';
import {
  addCandidate,
  getTripActivityRow,
  getTripRow,
  patchTripActivity,
  removeCandidate,
} from '../_trips.js';
import { requireMemberCtx, type GqlContext } from '../_gqlContext.js';

// Candidate (trip_activities) mutations. addTripActivity is keyed by tripId;
// assignSlot/setDisplayOrder/removeTripActivity are keyed by taId, so they load
// the row first to resolve the trip, then gate on membership.

async function addTripActivity(
  _parent: unknown,
  { input }: { input: { tripId: string; activityId: string } },
  ctx: GqlContext,
) {
  const member = await requireMemberCtx(ctx, input.tripId);
  const trip = await getTripRow(input.tripId);
  if (!trip) throw notFound('trip not found');
  const created = await addCandidate(trip, input.activityId, member.email);
  return { tripActivity: mapTripActivity(created) };
}

// Loads the candidate row + its trip and verifies membership. Shared by the
// three taId-keyed mutations.
async function loadTaForMember(taId: string, ctx: GqlContext) {
  const ta = await getTripActivityRow(taId);
  if (!ta) throw notFound('not found');
  const member = await requireMemberCtx(ctx, ta.trip_id);
  const trip = await getTripRow(ta.trip_id);
  if (!trip) throw notFound('trip not found');
  return { ta, trip, member };
}

async function assignSlot(
  _parent: unknown,
  {
    input,
  }: {
    input: {
      taId: string;
      dayIndex?: number | null;
      startTime?: string | null;
      displayOrder?: number | null;
    };
  },
  ctx: GqlContext,
) {
  const { ta, trip } = await loadTaForMember(input.taId, ctx);
  // Forward only the keys the client sent so absent-vs-null is preserved (a
  // displayOrder-only assignSlot stays allowed during voting).
  const patch: {
    dayIndex?: number | null;
    startTime?: string | null;
    displayOrder?: number | null;
  } = {};
  if ('dayIndex' in input) patch.dayIndex = input.dayIndex;
  if ('startTime' in input) patch.startTime = input.startTime;
  if ('displayOrder' in input) patch.displayOrder = input.displayOrder;
  const updated = await patchTripActivity(ta, trip, patch);
  return { tripActivity: mapTripActivity(updated) };
}

async function setDisplayOrder(
  _parent: unknown,
  { input }: { input: { taId: string; displayOrder: number } },
  ctx: GqlContext,
) {
  const { ta, trip } = await loadTaForMember(input.taId, ctx);
  const updated = await patchTripActivity(ta, trip, {
    displayOrder: input.displayOrder,
  });
  return { tripActivity: mapTripActivity(updated) };
}

async function removeTripActivity(
  _parent: unknown,
  { input }: { input: { taId: string } },
  ctx: GqlContext,
) {
  const { ta, trip, member } = await loadTaForMember(input.taId, ctx);
  await removeCandidate(ta, trip, member);
  return { deletedId: input.taId };
}

export const tripActivitiesMutation = {
  addTripActivity,
  assignSlot,
  setDisplayOrder,
  removeTripActivity,
};

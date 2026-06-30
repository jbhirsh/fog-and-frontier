import { notFound } from '../_gqlError.js';
import { dateToIso, mapTrip, mapTripListItem } from '../_gqlMap.js';
import {
  createTrip,
  deleteTripById,
  getTripDetail,
  listTrips,
  patchTrip,
  type TripStatus,
} from '../_trips.js';
import {
  loadTripForMemberOrNull,
  requireCreatorCtx,
  requireMemberCtx,
  requireOwnerCtx,
  requireUserCtx,
  type GqlContext,
} from '../_gqlContext.js';

// Trip CRUD. `trips` is member-scoped (any authed); `trip(id)` returns null for
// missing/non-member (hides existence); create is owner-only; patch is any
// member; delete is creator-only.

async function trips(_parent: unknown, _args: unknown, ctx: GqlContext) {
  const caller = requireUserCtx(ctx);
  const list = await listTrips(caller.email);
  return list.map(mapTripListItem);
}

async function trip(
  _parent: unknown,
  { id }: { id: string },
  ctx: GqlContext,
) {
  const t = await loadTripForMemberOrNull(ctx, id);
  return t ? mapTrip(t) : null;
}

type CreateTripInput = {
  title: unknown;
  startDate: unknown;
  endDate: unknown;
  description?: string | null;
  coverImageUrl?: string | null;
  initialActivityIds?: string[] | null;
  status?: TripStatus | null;
};

async function createTripResolver(
  _parent: unknown,
  { input }: { input: CreateTripInput },
  ctx: GqlContext,
) {
  const owner = requireOwnerCtx(ctx);
  // startDate/endDate are required Date scalars → always Date objects here.
  const created = await createTrip(
    {
      title: input.title,
      startDate: dateToIso(input.startDate) ?? null,
      endDate: dateToIso(input.endDate) ?? null,
      description: input.description,
      coverImageUrl: input.coverImageUrl,
      initialActivityIds: input.initialActivityIds,
      status: input.status,
    },
    owner.email,
  );
  return { trip: mapTrip(created) };
}

type PatchTripInput = {
  id: string;
  patch: {
    title?: unknown;
    description?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    coverImageUrl?: unknown;
  };
};

async function patchTripResolver(
  _parent: unknown,
  { input }: { input: PatchTripInput },
  ctx: GqlContext,
) {
  await requireMemberCtx(ctx, input.id);
  const p = input.patch;
  // Preserve absent-vs-null: only forward keys the client actually sent.
  const patch: {
    title?: unknown;
    description?: unknown;
    startDate?: string | null;
    endDate?: string | null;
    coverImageUrl?: unknown;
  } = {};
  if ('title' in p) patch.title = p.title;
  if ('description' in p) patch.description = p.description;
  if ('startDate' in p) patch.startDate = dateToIso(p.startDate);
  if ('endDate' in p) patch.endDate = dateToIso(p.endDate);
  if ('coverImageUrl' in p) patch.coverImageUrl = p.coverImageUrl;

  await patchTrip(input.id, patch);
  // Payload is a full Trip — reload detail (header + activities/members/…).
  const full = await getTripDetail(input.id);
  if (!full) throw notFound('not found');
  return { trip: mapTrip(full) };
}

async function deleteTripResolver(
  _parent: unknown,
  { input }: { input: { id: string } },
  ctx: GqlContext,
) {
  await requireCreatorCtx(ctx, input.id);
  await deleteTripById(input.id);
  return { deletedId: input.id };
}

export const tripsQuery = { trips, trip };
export const tripsMutation = {
  createTrip: createTripResolver,
  patchTrip: patchTripResolver,
  deleteTrip: deleteTripResolver,
};

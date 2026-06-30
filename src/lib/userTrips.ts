import { useCallback, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import type { Activity } from '../data/types';
import { apolloClient } from './apolloClient';
import { appCodeOf, tripLoadErrorFrom, type TripLoadError } from './gqlError';
import { useAuthState } from './authShim';
import { rowToActivity } from './userActivities';
import { applyCompletionMirror } from './userCompleted';
import {
  ADD_TRIP_ACTIVITY,
  ASSIGN_SLOT,
  CAST_VOTE,
  CLAIM_INVITE,
  CREATE_TRIP,
  DELETE_TRIP,
  INVITE_MEMBER,
  PATCH_TRIP,
  REMOVE_MEMBER,
  REMOVE_TRIP_ACTIVITY,
  REVOKE_INVITE,
  SET_DISPLAY_ORDER,
  TRANSITION_TRIP,
  TRIP_QUERY,
  TRIPS_QUERY,
  USERS_QUERY,
  type TripListRow,
  type TripRow,
} from './gqlDocs';

export type { TripLoadError };

// 'voting' is exercised by the v1 voting PR; the union is widened now so the
// client never receives a status its type says is impossible once the server
// can emit it.
export type TripStatus = 'voting' | 'planning' | 'past';

export type UserRole = 'owner' | 'editor';

export type TripMember = {
  email: string;
  display_name: string | null;
  added_by_email: string;
  added_at: number;
  is_creator: boolean;
};

export type TripInvite = {
  invite_token: string;
  invited_email: string | null;
  invited_by_email: string;
  invited_at: number;
};

// Snapshot stored in trip_activities.snapshot_json. Server stores whatever the
// catalog activity looked like at add-time; we trust it has Activity-shaped
// fields but treat optional ones as optional.
export type TripActivitySnapshot = Activity;

export type TripActivity = {
  id: string;
  trip_id: string;
  activity_id: string | null;
  added_by_email: string;
  added_at: number;
  day_index: number | null;
  start_time: string | null;
  display_order: number;
  snapshot: TripActivitySnapshot | null;
};

type TripMeta = {
  id: string;
  creator_email: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  cover_image_url: string | null;
  status: TripStatus;
  created_at: number;
  marked_past_at: number | null;
};

export type TripVote = { trip_activity_id: string; member_email: string; value: -1 | 1 };

export type Trip = TripMeta & {
  activities: TripActivity[];
  members: TripMember[];
  invites: TripInvite[];
  votes: TripVote[];
};

export type TripListItem = TripMeta & {
  scheduled_count: number;
  unscheduled_count: number;
};

// ---- boundary mappers: GraphQL (camelCase / ISO) -> domain (snake_case) ----

function rowToTripActivity(ta: TripRow['activities'][number]): TripActivity {
  return {
    id: ta.id,
    trip_id: ta.tripId,
    activity_id: ta.activityId ?? null,
    added_by_email: ta.addedByEmail,
    added_at: Date.parse(ta.addedAt),
    day_index: ta.dayIndex ?? null,
    start_time: ta.startTime ?? null,
    display_order: ta.displayOrder,
    snapshot: ta.snapshot ? rowToActivity(ta.snapshot) : null,
  };
}

function rowToTrip(row: TripRow): Trip {
  return {
    id: row.id,
    creator_email: row.creatorEmail,
    title: row.title,
    description: row.description ?? null,
    start_date: row.startDate,
    end_date: row.endDate,
    cover_image_url: row.coverImageUrl ?? null,
    status: row.status,
    created_at: Date.parse(row.createdAt),
    marked_past_at: row.markedPastAt ? Date.parse(row.markedPastAt) : null,
    activities: row.activities.map(rowToTripActivity),
    members: row.members.map((m) => ({
      email: m.email,
      display_name: m.displayName ?? null,
      added_by_email: m.addedByEmail,
      added_at: Date.parse(m.addedAt),
      is_creator: m.isCreator,
    })),
    invites: row.invites.map((i) => ({
      invite_token: i.inviteToken,
      invited_email: i.invitedEmail ?? null,
      invited_by_email: i.invitedByEmail,
      invited_at: Date.parse(i.invitedAt),
    })),
    votes: row.votes.map((v) => ({
      trip_activity_id: v.tripActivityId,
      member_email: v.memberEmail,
      value: v.value as -1 | 1,
    })),
  };
}

function rowToTripListItem(row: TripListRow): TripListItem {
  return {
    id: row.id,
    creator_email: row.creatorEmail,
    title: row.title,
    description: row.description ?? null,
    start_date: row.startDate,
    end_date: row.endDate,
    cover_image_url: row.coverImageUrl ?? null,
    status: row.status,
    created_at: Date.parse(row.createdAt),
    marked_past_at: row.markedPastAt ? Date.parse(row.markedPastAt) : null,
    scheduled_count: row.scheduledCount,
    unscheduled_count: row.unscheduledCount,
  };
}

// ---- reads ----

export function useTripsList() {
  // TRIPS_QUERY is auth-gated; firing before Clerk is ready sends an anon
  // request → UNAUTHENTICATED with no self-heal (the link has no retry).
  // `skip` until isLoaded; the query auto-runs (with a token) once it flips.
  const { isLoaded } = useAuthState();
  const { data, loading, error, refetch } = useQuery(TRIPS_QUERY, {
    fetchPolicy: 'cache-and-network',
    skip: !isLoaded,
  });
  const trips = useMemo(
    () => (data?.trips ?? []).map(rowToTripListItem),
    [data],
  );
  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);
  return {
    trips,
    isLoading: !isLoaded || (loading && !data),
    error: error ? tripLoadErrorFrom(error) : null,
    reload,
  };
}

export function useTrip(id: string | undefined) {
  // Gate on Clerk readiness (see useTripsList) — TRIP_QUERY is auth-gated.
  const { isLoaded } = useAuthState();
  const { data, loading, error, refetch } = useQuery(TRIP_QUERY, {
    variables: { id: id ?? '' },
    skip: !id || !isLoaded,
    fetchPolicy: 'cache-and-network',
  });
  const trip = useMemo(
    () => (data?.trip ? rowToTrip(data.trip) : null),
    [data],
  );
  // `trip(id)` returns null (not an error) for missing/non-member trips; an
  // anon caller gets UNAUTHENTICATED. Map both into the load-error channel.
  const loadError: TripLoadError | null = error
    ? tripLoadErrorFrom(error)
    : data?.trip === null
      ? 'not-found'
      : null;
  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);
  return {
    trip,
    isLoading: !!id && (!isLoaded || (loading && !data)),
    error: loadError,
    reload,
  };
}

// ---- mutations (auth injected by the Apollo link) ----

export type CreateTripInput = {
  title: string;
  start_date: string;
  end_date: string;
  description?: string;
  cover_image_url?: string;
  initial_activity_ids?: string[];
  // 'voting' opens collaborative voting first; omitted/'planning' skips to the
  // itinerary stage. Server defaults to 'planning' (#51 c3).
  status?: 'voting' | 'planning';
};

// Returns the new trip's id (the list query is a different type — TripListItem —
// so we refetch `trips` rather than relying on cache merge).
export async function createTrip(
  body: CreateTripInput,
): Promise<{ id: string }> {
  const { data } = await apolloClient.mutate({
    mutation: CREATE_TRIP,
    variables: {
      input: {
        title: body.title,
        startDate: body.start_date,
        endDate: body.end_date,
        description: body.description ?? null,
        coverImageUrl: body.cover_image_url ?? null,
        initialActivityIds: body.initial_activity_ids ?? null,
        status: body.status ?? null,
      },
    },
    refetchQueries: [{ query: TRIPS_QUERY }],
    awaitRefetchQueries: true,
  });
  const id = data?.createTrip.trip.id;
  if (!id) throw new Error('create trip failed');
  return { id };
}

export type PatchTripInput = {
  title?: string;
  description?: string | null;
  start_date?: string;
  end_date?: string;
  cover_image_url?: string | null;
};

export async function patchTrip(
  id: string,
  body: PatchTripInput,
): Promise<void> {
  // Build the patch with only the keys actually present so a displayOrder-only
  // or cover-only edit doesn't trip status guards (absent vs null matters).
  const patch: {
    title?: string;
    description?: string | null;
    startDate?: string;
    endDate?: string;
    coverImageUrl?: string | null;
  } = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.start_date !== undefined) patch.startDate = body.start_date;
  if (body.end_date !== undefined) patch.endDate = body.end_date;
  if (body.cover_image_url !== undefined) patch.coverImageUrl = body.cover_image_url;
  await apolloClient.mutate({
    mutation: PATCH_TRIP,
    variables: { input: { id, patch } },
  });
}

export async function deleteTrip(id: string): Promise<void> {
  await apolloClient.mutate({
    mutation: DELETE_TRIP,
    variables: { input: { id } },
  });
}

export async function addActivityToTrip(
  tripId: string,
  activityId: string,
): Promise<{ alreadyOnTrip: boolean; tripPast: boolean }> {
  try {
    await apolloClient.mutate({
      mutation: ADD_TRIP_ACTIVITY,
      variables: { input: { tripId, activityId } },
    });
    return { alreadyOnTrip: false, tripPast: false };
  } catch (err) {
    // Switch on the server's appCode discriminator so wording changes don't
    // silently flip flows: 'trip_past' vs 'duplicate' (both were 409 in REST).
    const appCode = appCodeOf(err);
    if (appCode === 'trip_past') return { alreadyOnTrip: false, tripPast: true };
    if (appCode === 'duplicate') return { alreadyOnTrip: true, tripPast: false };
    throw err;
  }
}

export type SlotInput = {
  day_index: number | null;
  start_time: string | null;
  display_order?: number;
};

export async function assignSlot(taId: string, slot: SlotInput): Promise<void> {
  await apolloClient.mutate({
    mutation: ASSIGN_SLOT,
    variables: {
      input: {
        taId,
        dayIndex: slot.day_index,
        startTime: slot.start_time,
        displayOrder: slot.display_order,
      },
    },
  });
}

export async function removeTripActivity(taId: string): Promise<void> {
  await apolloClient.mutate({
    mutation: REMOVE_TRIP_ACTIVITY,
    variables: { input: { taId } },
  });
}

// display_order-only update for drag-reordering candidate cards during voting.
// Sends NO day_index/start_time, so it isn't blocked by the voting-phase slot
// lock (#51 c8).
export async function setDisplayOrder(
  taId: string,
  displayOrder: number,
): Promise<void> {
  await apolloClient.mutate({
    mutation: SET_DISPLAY_ORDER,
    variables: { input: { taId, displayOrder } },
  });
}

export async function markTripPast(
  tripId: string,
  completedActivityIds: string[],
): Promise<{
  marked_past_at: number;
  completed_activity_ids: string[];
  uncompleted_activity_ids: string[];
}> {
  const { data } = await apolloClient.mutate({
    mutation: TRANSITION_TRIP,
    variables: { input: { id: tripId, to: 'past', completedActivityIds } },
  });
  const result = data?.transitionTrip;
  const completed = result?.completedActivityIds ?? [];
  const uncompleted = result?.uncompletedActivityIds ?? [];
  // Mirror the server-side completion write-through into the cache so badges on
  // Curated / Map / Adventures update without a hard refresh.
  applyCompletionMirror(completed, uncompleted);
  return {
    marked_past_at: result?.markedPastAt
      ? Date.parse(result.markedPastAt)
      : Date.now(),
    completed_activity_ids: completed,
    uncompleted_activity_ids: uncompleted,
  };
}

// Optimistic vote: surgically rewrite Trip.votes so the thumb feels instant.
// value 0 removes the caller's vote for the candidate (no neutral row). The
// optimisticResponse mirrors the CastVotePayload shape (incl. __typename) and
// the cache update rewrites the cached TRIP_QUERY's votes array.
export async function castVote(
  tripId: string,
  tripActivityId: string,
  value: -1 | 0 | 1,
  memberEmail: string,
): Promise<void> {
  const lower = memberEmail.toLowerCase();
  await apolloClient.mutate({
    mutation: CAST_VOTE,
    variables: { input: { tripId, tripActivityId, value } },
    optimisticResponse: {
      castVote: {
        vote:
          value === 0
            ? null
            : { __typename: 'TripVote', tripActivityId, memberEmail, value },
      },
    },
    update(cache, { data }) {
      const newVote = data?.castVote.vote ?? null;
      cache.updateQuery(
        { query: TRIP_QUERY, variables: { id: tripId } },
        (prev) => {
          if (!prev?.trip) return prev;
          const others = prev.trip.votes.filter(
            (v) =>
              !(
                v.tripActivityId === tripActivityId &&
                v.memberEmail.toLowerCase() === lower
              ),
          );
          const votes = newVote ? [...others, newVote] : others;
          return { ...prev, trip: { ...prev.trip, votes } };
        },
      );
    },
  });
}

export async function transitionToPlanning(
  tripId: string,
  keptActivityIds: string[],
): Promise<void> {
  await apolloClient.mutate({
    mutation: TRANSITION_TRIP,
    variables: { input: { id: tripId, to: 'planning', keptActivityIds } },
  });
}

export async function revertToVoting(tripId: string): Promise<void> {
  await apolloClient.mutate({
    mutation: TRANSITION_TRIP,
    variables: { input: { id: tripId, to: 'voting' } },
  });
}

export type UserSummary = { email: string; display_name: string | null };

export async function fetchUsers(): Promise<UserSummary[]> {
  const { data } = await apolloClient.query({
    query: USERS_QUERY,
    fetchPolicy: 'network-only',
  });
  return (data?.users ?? []).map((u) => ({
    email: u.email,
    display_name: u.displayName ?? null,
  }));
}

export async function inviteMember(
  tripId: string,
  email: string,
): Promise<TripInvite> {
  const { data } = await apolloClient.mutate({
    mutation: INVITE_MEMBER,
    variables: { input: { tripId, email } },
  });
  const invite = data?.inviteMember.invite;
  return {
    invite_token: invite?.inviteToken ?? '',
    invited_email: invite?.invitedEmail ?? null,
    invited_by_email: invite?.invitedByEmail ?? '',
    invited_at: invite?.invitedAt ? Date.parse(invite.invitedAt) : Date.now(),
  };
}

export async function removeMember(
  tripId: string,
  email: string,
): Promise<void> {
  await apolloClient.mutate({
    mutation: REMOVE_MEMBER,
    variables: { input: { tripId, email } },
  });
}

export async function revokeInvite(
  tripId: string,
  inviteToken: string,
): Promise<void> {
  await apolloClient.mutate({
    mutation: REVOKE_INVITE,
    variables: { input: { tripId, token: inviteToken } },
  });
}

export async function claimInvite(
  inviteToken: string,
): Promise<{ trip_id: string } | null> {
  const { data } = await apolloClient.mutate({
    mutation: CLAIM_INVITE,
    variables: { input: { inviteToken } },
  });
  const tripId = data?.claimInvite?.tripId ?? null;
  return tripId ? { trip_id: tripId } : null;
}

// ---- pure helpers (unchanged; usable by tests and components) ----

export function dayCount(trip: Pick<Trip, 'start_date' | 'end_date'>): number {
  const start = Date.parse(`${trip.start_date}T00:00:00Z`);
  const end = Date.parse(`${trip.end_date}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.round((end - start) / 86_400_000) + 1;
}

// Activity durations are catalog enums, not exact minutes. Map them to a
// rough end-time estimate good enough for the itinerary card.
export function approxDurationMinutes(snapshot: TripActivitySnapshot | null): number {
  if (!snapshot) return 60;
  switch (snapshot.duration) {
    case '1-2 Hours':
      return 90;
    case '2-3 Hours':
      return 150;
    case 'Half Day':
      return 240;
    case 'Full Day':
      return 480;
    case 'Weekend':
      return 1440;
    case 'Multi-Day':
      return 1440;
    default:
      return 60;
  }
}

export function parseHHMM(time: string): { hours: number; minutes: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return null;
  return { hours: Number(m[1]), minutes: Number(m[2]) };
}

export function formatHHMM(time: string | null | undefined): string {
  if (!time) return '';
  const parsed = parseHHMM(time);
  if (!parsed) return time;
  const period = parsed.hours >= 12 ? 'PM' : 'AM';
  const hour12 = parsed.hours % 12 === 0 ? 12 : parsed.hours % 12;
  const mm = parsed.minutes.toString().padStart(2, '0');
  return `${hour12}:${mm} ${period}`;
}

export function addMinutesToHHMM(time: string, addMinutes: number): string {
  const parsed = parseHHMM(time);
  if (!parsed) return time;
  const total = parsed.hours * 60 + parsed.minutes + addMinutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(wrapped / 60)
    .toString()
    .padStart(2, '0');
  const mm = (wrapped % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function derivedEndTime(activity: TripActivity): string | null {
  if (!activity.start_time) return null;
  return addMinutesToHHMM(activity.start_time, approxDurationMinutes(activity.snapshot));
}

// Default start_time when dropping onto a day. Per spec: 30 min after the
// last scheduled activity's derived end on that day, rounded to the nearest
// 15 minutes, capped at 23:45; 09:00 if the day is empty.
//
// We compute end-of-day without wrapping past midnight (unlike derivedEndTime,
// which is for display). A 23:00 + Full-Day combo should NOT roll over to
// 07:30 the next morning — clamp to the same-day cap.
export function defaultStartTimeForDay(
  existingOnDay: TripActivity[],
): string {
  const scheduled = existingOnDay.filter((a) => a.start_time);
  if (scheduled.length === 0) return '09:00';
  let latestEndMinutes = 0;
  for (const a of scheduled) {
    if (!a.start_time) continue;
    const parsed = parseHHMM(a.start_time);
    if (!parsed) continue;
    const startMinutes = parsed.hours * 60 + parsed.minutes;
    const endMinutes = startMinutes + approxDurationMinutes(a.snapshot);
    if (endMinutes > latestEndMinutes) latestEndMinutes = endMinutes;
  }
  const padded = latestEndMinutes + 30;
  const rounded = Math.round(padded / 15) * 15;
  const clamped = Math.min(rounded, 1425); // cap at 23:45
  const hh = Math.floor(clamped / 60)
    .toString()
    .padStart(2, '0');
  const mm = (clamped % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function dayLabel(trip: Pick<Trip, 'start_date'>, dayIndex: number): string {
  const start = new Date(`${trip.start_date}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return `Day ${dayIndex + 1}`;
  start.setUTCDate(start.getUTCDate() + dayIndex);
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  });
  return `Day ${dayIndex + 1} · ${fmt.format(start)}`;
}

// Vote-aggregation pure helpers. Net score = ups − downs; tiebreak by raw
// up-count descending. Stable-sort relative order preserved on full ties.

export type VoteTally = { up: number; down: number; net: number };

export function tallyFor(votes: TripVote[], tripActivityId: string): VoteTally {
  let up = 0;
  let down = 0;
  for (const v of votes) {
    if (v.trip_activity_id !== tripActivityId) continue;
    if (v.value === 1) up++;
    else if (v.value === -1) down++;
  }
  return { up, down, net: up - down };
}

export function myVote(
  votes: TripVote[],
  tripActivityId: string,
  email: string | null,
): -1 | 0 | 1 {
  if (!email) return 0;
  const lower = email.toLowerCase();
  const v = votes.find(
    (r) => r.trip_activity_id === tripActivityId && r.member_email.toLowerCase() === lower,
  );
  return v ? v.value : 0;
}

// Path (not full URL) for a shareable invite link. The component prepends origin.
export function inviteLinkPath(tripId: string, inviteToken: string): string {
  return `/trips/${encodeURIComponent(tripId)}?invite=${encodeURIComponent(inviteToken)}`;
}

export type MemberVote = {
  email: string;
  display_name: string | null;
  value: -1 | 1;
  leftTrip: boolean;
};

// Per-candidate by-member breakdown (#51 c5). For the given trip_activity_id, return one entry per
// vote row, joining display_name from members when present. leftTrip = the voter's email is NOT in
// `members` (they voted then left). Sort: upvotes (1) before downvotes (-1), then email asc.
export function memberVoteBreakdown(
  votes: TripVote[],
  members: TripMember[],
  tripActivityId: string,
): MemberVote[] {
  const memberMap = new Map<string, TripMember>();
  for (const m of members) {
    memberMap.set(m.email.toLowerCase(), m);
  }

  const result: MemberVote[] = [];
  for (const v of votes) {
    if (v.trip_activity_id !== tripActivityId) continue;
    const lower = v.member_email.toLowerCase();
    const member = memberMap.get(lower);
    result.push({
      email: v.member_email,
      display_name: member?.display_name ?? null,
      value: v.value,
      leftTrip: !member,
    });
  }

  result.sort((a, b) => {
    // Upvotes (1) before downvotes (-1).
    if (b.value !== a.value) return b.value - a.value;
    // Then email ascending (case-insensitive).
    return a.email.toLowerCase().localeCompare(b.email.toLowerCase());
  });

  return result;
}

export function sortByNetScore<T extends { id: string }>(
  activities: T[],
  votes: TripVote[],
): T[] {
  // Pre-compute tallies once per activity to avoid O(n²) inner loops.
  const tallies = new Map<string, VoteTally>();
  for (const a of activities) {
    tallies.set(a.id, tallyFor(votes, a.id));
  }
  // Stable sort: build index-tagged array, sort, strip tags.
  return activities
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const tx = tallies.get(x.a.id)!;
      const ty = tallies.get(y.a.id)!;
      // Primary: net score descending.
      if (ty.net !== tx.net) return ty.net - tx.net;
      // Secondary: raw up-count descending.
      if (ty.up !== tx.up) return ty.up - tx.up;
      // Tertiary: original order (stable).
      return x.i - y.i;
    })
    .map(({ a }) => a);
}

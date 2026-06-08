import { useCallback, useEffect, useRef, useState } from 'react';
import type { Activity } from '../data/types';
import { authedFetch } from './authedFetch';
import { useAuthState } from './authShim';
import { applyCompletionMirror } from './userCompleted';

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

export type TripLoadError = 'unauthorized' | 'not-found' | 'failed';

export function useTripsList() {
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<TripLoadError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { getToken, isLoaded } = useAuthState();

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        const res = await authedFetch('/api/trips', { method: 'GET' }, token);
        if (cancelled) return;
        if (res.status === 401) {
          setError('unauthorized');
          setTrips([]);
        } else if (!res.ok) {
          setError('failed');
          setTrips([]);
        } else {
          setError(null);
          setTrips((await res.json()) as TripListItem[]);
        }
      } catch {
        if (!cancelled) setError('failed');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, reloadKey, getToken]);

  return { trips, isLoading, error, reload };
}

export function useTrip(id: string | undefined) {
  const [trip, setTrip] = useState<Trip | null>(null);
  // No id ⇒ never loading. Callers (TripDetail) always pass an id from the
  // route, but the type stays optional to keep the hook hooks-friendly.
  const [isLoading, setIsLoading] = useState<boolean>(() => id !== undefined);
  const [error, setError] = useState<TripLoadError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { getToken, isLoaded } = useAuthState();
  // Tracks whether we've ever loaded the trip successfully. Until then,
  // reload() re-enters the loading state so a refetch that follows a 404 (e.g.
  // claiming an invite, which makes a previously-hidden trip visible) shows
  // "Loading…" rather than flashing the not-found screen. Once loaded, reloads
  // (30s vote poll, post-mutation) refresh in the background without a flash.
  const hasLoadedRef = useRef(false);

  const reload = useCallback(() => {
    if (!hasLoadedRef.current) setIsLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!isLoaded || !id) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        const res = await authedFetch(
          `/api/trips?id=${encodeURIComponent(id)}`,
          { method: 'GET' },
          token,
        );
        if (cancelled) return;
        if (res.status === 401) {
          setError('unauthorized');
          setTrip(null);
        } else if (res.status === 404) {
          setError('not-found');
          setTrip(null);
        } else if (!res.ok) {
          setError('failed');
          setTrip(null);
        } else {
          setError(null);
          setTrip((await res.json()) as Trip);
          hasLoadedRef.current = true;
        }
      } catch {
        if (!cancelled) setError('failed');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isLoaded, reloadKey, getToken]);

  return { trip, isLoading, error, reload, setTrip };
}

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

async function jsonOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ? `: ${body.error}` : '';
    } catch {
      /* ignore */
    }
    throw new Error(`${label} failed (${res.status})${detail}`);
  }
  return (await res.json()) as T;
}

export async function createTrip(
  body: CreateTripInput,
  token: string | null,
): Promise<Trip> {
  const res = await authedFetch(
    '/api/trips',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    token,
  );
  return jsonOrThrow<Trip>(res, 'create trip');
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
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    `/api/trips?id=${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    token,
  );
  await jsonOrThrow<unknown>(res, 'update trip');
}

export async function deleteTrip(
  id: string,
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    `/api/trips?id=${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    token,
  );
  await jsonOrThrow<unknown>(res, 'delete trip');
}

export async function addActivityToTrip(
  tripId: string,
  activityId: string,
  token: string | null,
): Promise<{ alreadyOnTrip: boolean; tripPast: boolean }> {
  const res = await authedFetch(
    '/api/trip-activities',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trip_id: tripId, activity_id: activityId }),
    },
    token,
  );
  if (res.status === 409) {
    // Both "duplicate" and "past trip" are 409. Switch on the server's
    // `code` discriminator so wording changes don't silently flip flows.
    let code = '';
    try {
      const body = (await res.json()) as { code?: string };
      code = body.code ?? '';
    } catch {
      /* ignore */
    }
    if (code === 'trip_past') {
      return { alreadyOnTrip: false, tripPast: true };
    }
    return { alreadyOnTrip: true, tripPast: false };
  }
  await jsonOrThrow<unknown>(res, 'add activity to trip');
  return { alreadyOnTrip: false, tripPast: false };
}

export type SlotInput = {
  day_index: number | null;
  start_time: string | null;
  display_order?: number;
};

export async function assignSlot(
  taId: string,
  slot: SlotInput,
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    `/api/trip-activities?ta_id=${encodeURIComponent(taId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(slot),
    },
    token,
  );
  await jsonOrThrow<unknown>(res, 'update slot');
}

export async function removeTripActivity(
  taId: string,
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    `/api/trip-activities?ta_id=${encodeURIComponent(taId)}`,
    { method: 'DELETE' },
    token,
  );
  await jsonOrThrow<unknown>(res, 'remove activity');
}

// display_order-only PATCH for drag-reordering candidate cards during voting.
// Unlike assignSlot it sends NO day_index/start_time, so it isn't blocked by
// the voting-phase slot lock (#51 c8).
export async function setDisplayOrder(
  taId: string,
  displayOrder: number,
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    `/api/trip-activities?ta_id=${encodeURIComponent(taId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_order: displayOrder }),
    },
    token,
  );
  await jsonOrThrow<unknown>(res, 'reorder candidate');
}

export async function markTripPast(
  tripId: string,
  completedActivityIds: string[],
  token: string | null,
): Promise<{
  marked_past_at: number;
  completed_activity_ids: string[];
  uncompleted_activity_ids: string[];
}> {
  const res = await authedFetch(
    `/api/trip-lifecycle?id=${encodeURIComponent(tripId)}&to=past`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ completed_activity_ids: completedActivityIds }),
    },
    token,
  );
  const result = await jsonOrThrow<{
    ok: boolean;
    marked_past_at: number;
    completed_activity_ids: string[];
    uncompleted_activity_ids?: string[];
  }>(res, 'mark trip past');
  const uncompleted = result.uncompleted_activity_ids ?? [];
  // Mirror the server-side completion write-through into the local cache so
  // badges on Curated / Map / Adventures update without a hard refresh.
  // Unchecked-but-eligible activities get v=0 to override stale baselines.
  applyCompletionMirror(result.completed_activity_ids, uncompleted);
  return {
    marked_past_at: result.marked_past_at,
    completed_activity_ids: result.completed_activity_ids,
    uncompleted_activity_ids: uncompleted,
  };
}

export async function castVote(
  tripId: string,
  tripActivityId: string,
  value: -1 | 0 | 1,
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    '/api/trip-votes',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trip_id: tripId, trip_activity_id: tripActivityId, value }),
    },
    token,
  );
  await jsonOrThrow<unknown>(res, 'cast vote');
}

export async function transitionToPlanning(
  tripId: string,
  keptActivityIds: string[],
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    `/api/trip-lifecycle?id=${encodeURIComponent(tripId)}&to=planning`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kept_activity_ids: keptActivityIds }),
    },
    token,
  );
  await jsonOrThrow<unknown>(res, 'transition to planning');
}

export async function revertToVoting(
  tripId: string,
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    `/api/trip-lifecycle?id=${encodeURIComponent(tripId)}&to=voting`,
    { method: 'POST' },
    token,
  );
  await jsonOrThrow<unknown>(res, 'revert to voting');
}

export type UserSummary = { email: string; display_name: string | null };

export async function fetchUsers(token: string | null): Promise<UserSummary[]> {
  const res = await authedFetch('/api/users', { method: 'GET' }, token);
  return jsonOrThrow<UserSummary[]>(res, 'fetch users');
}

export async function inviteMember(
  tripId: string,
  email: string,
  token: string | null,
): Promise<TripInvite> {
  const res = await authedFetch(
    `/api/trip-membership?id=${encodeURIComponent(tripId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    },
    token,
  );
  return jsonOrThrow<TripInvite>(res, 'invite member');
}

export async function removeMember(
  tripId: string,
  email: string,
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    `/api/trip-membership?id=${encodeURIComponent(tripId)}&email=${encodeURIComponent(email)}`,
    { method: 'DELETE' },
    token,
  );
  await jsonOrThrow<unknown>(res, 'remove member');
}

export async function revokeInvite(
  tripId: string,
  inviteToken: string,
  token: string | null,
): Promise<void> {
  const res = await authedFetch(
    `/api/trip-membership?id=${encodeURIComponent(tripId)}&token=${encodeURIComponent(inviteToken)}`,
    { method: 'DELETE' },
    token,
  );
  await jsonOrThrow<unknown>(res, 'revoke invite');
}

export async function claimInvite(
  inviteToken: string,
  token: string | null,
): Promise<{ trip_id: string } | null> {
  const res = await authedFetch(
    '/api/trip-membership',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite_token: inviteToken }),
    },
    token,
  );
  if (res.status === 404) return null;
  return jsonOrThrow<{ trip_id: string }>(res, 'claim invite');
}

// Pure helpers usable by tests and components.

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

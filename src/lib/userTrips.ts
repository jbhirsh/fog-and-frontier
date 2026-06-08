import { useCallback, useEffect, useState } from 'react';
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

export type Trip = TripMeta & {
  activities: TripActivity[];
  members: TripMember[];
  invites: TripInvite[];
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

  const reload = useCallback(() => {
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
    `/api/trip-mark-past?id=${encodeURIComponent(tripId)}`,
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

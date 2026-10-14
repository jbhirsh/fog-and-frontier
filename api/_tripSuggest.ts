// Trip suggestions (#78), the parts that don't call Gemini: the compact view
// of an activity it ranks from, and the check on what it hands back. Kept
// out of gemini.ts so they're unit-tested and mutation-tested directly.

export const MAX_TRIP_SUGGESTIONS = 12;

/** The compact view of an activity Gemini ranks from. */
export interface TripCandidate {
  id: string;
  name: string;
  category: string;
  region: string;
  city: string;
  shortDescription: string;
  duration: string;
  difficulty?: string | null;
  dogFriendly?: boolean | null;
}

export interface TripPick {
  activityId: string;
  reason: string;
}

/** A parsed catalog activity, as the catalog read returns it. */
export function toCandidate(a: Record<string, unknown>): TripCandidate {
  const location = a.location as { city: string };
  return {
    id: a.id as string,
    name: a.name as string,
    category: a.category as string,
    region: a.region as string,
    city: location.city,
    shortDescription: a.shortDescription as string,
    duration: a.duration as string,
    difficulty: (a.difficulty as string | null | undefined) ?? null,
    dogFriendly: (a.dogFriendly as boolean | null | undefined) ?? null,
  };
}

/**
 * Gemini's picks, kept only where they're real: ids from `candidates`
 * (which already leave out what the trip has), once each, at most
 * MAX_TRIP_SUGGESTIONS, each with its reason. So neither the request nor the
 * catalog text can put a made-up activity on a trip.
 */
export function keepTripPicks(raw: unknown, candidates: readonly TripCandidate[]): TripPick[] {
  const list = (raw as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list)) return [];
  const known = new Set(candidates.map((c) => c.id));
  const picks: TripPick[] = [];
  for (const entry of list as unknown[]) {
    const item = (entry ?? {}) as { activityId?: unknown; reason?: unknown };
    // Only the candidates' own (string) ids get through.
    const id = item.activityId as string;
    if (!known.has(id) || picks.some((p) => p.activityId === id)) continue;
    picks.push({ activityId: id, reason: typeof item.reason === 'string' ? item.reason.trim() : '' });
    if (picks.length === MAX_TRIP_SUGGESTIONS) break;
  }
  return picks;
}

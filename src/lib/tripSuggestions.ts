import type { Activity, Category } from '../data/types';
import { distanceMiles } from '../data/home';
import { hasUsableCoords } from './nearbyActivities';
import type { TripActivity } from './userTrips';

// Suggested candidates for a trip in voting (#72): catalog activities near the
// ones already shortlisted, leaning toward the categories the shortlist lacks
// (four hikes and no food suggests food first). Pure so it can be unit- and
// mutation-tested; TripDetail renders the result.

// "Near the trip" means a short drive from something already on it. Distance,
// not region: a region like `norcal` runs from Shasta to Tahoe, too wide to
// say two activities belong on one trip.
export const TRIP_SUGGESTION_RADIUS_MILES = 25;

// How many suggestions show at first, and how many more each "Show more" adds.
export const TRIP_SUGGESTIONS_PAGE = 6;

export interface TripSuggestion {
  activity: Activity;
  /** Miles to the nearest candidate. */
  miles: number;
  /** That candidate's name, for "N mi from <name>". */
  nearName: string;
}

/**
 * The activities a trip's candidates stand for: the catalog's current row
 * when it still has one, else the snapshot taken when it was added.
 */
export function candidateActivities(
  candidates: readonly Pick<TripActivity, 'activity_id' | 'snapshot'>[],
  catalog: readonly Activity[],
): Activity[] {
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const out: Activity[] = [];
  for (const c of candidates) {
    const current = c.activity_id ? byId.get(c.activity_id) : undefined;
    const activity = current ?? c.snapshot;
    if (activity) out.push(activity);
  }
  return out;
}

/**
 * Catalog activities within `radiusMiles` of any candidate, excluding the
 * candidates themselves. Ordered for variety: one from each category in turn,
 * categories the trip has fewest of first (ties: the one with the nearer
 * activity), each category nearest first. Empty when no candidate has usable
 * coordinates, a brand-new trip included.
 */
export function suggestForTrip(
  candidates: readonly Pick<TripActivity, 'activity_id' | 'snapshot'>[],
  catalog: readonly Activity[],
  radiusMiles: number = TRIP_SUGGESTION_RADIUS_MILES,
): TripSuggestion[] {
  const onTrip = candidateActivities(candidates, catalog);
  const anchors = onTrip.filter(hasUsableCoords);

  // A candidate still in the catalog resolves to its current row, so its id
  // is the catalog id; one that left the catalog can't be suggested anyway.
  const taken = new Set<string>(onTrip.map((a) => a.id));

  const tripCount = new Map<Category, number>();
  for (const a of onTrip) {
    tripCount.set(a.category, (tripCount.get(a.category) ?? 0) + 1);
  }

  const byCategory = new Map<Category, TripSuggestion[]>();
  for (const activity of catalog) {
    if (taken.has(activity.id) || !hasUsableCoords(activity)) continue;
    let nearest: TripSuggestion | null = null;
    for (const anchor of anchors) {
      const miles = distanceMiles(anchor.location.coords, activity.location.coords);
      // Ties keep the earlier candidate.
      if (miles <= radiusMiles && (!nearest || miles < nearest.miles)) {
        nearest = { activity, miles, nearName: anchor.name };
      }
    }
    if (!nearest) continue;
    const list = byCategory.get(activity.category) ?? [];
    list.push(nearest);
    byCategory.set(activity.category, list);
  }

  const groups = [...byCategory.values()].map((items) => items.sort((x, y) => x.miles - y.miles));
  groups.sort((x, y) => {
    const gap =
      (tripCount.get(x[0].activity.category) ?? 0) - (tripCount.get(y[0].activity.category) ?? 0);
    return gap !== 0 ? gap : x[0].miles - y[0].miles;
  });

  // Interleave: every group's first, then every group's second, and so on.
  // The sort is stable, so within a round the groups keep their order.
  return groups
    .flatMap((g) => g.map((item, round) => ({ item, round })))
    .sort((x, y) => x.round - y.round)
    .map(({ item }) => item);
}

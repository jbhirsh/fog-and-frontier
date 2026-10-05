import type { Activity, Category } from '../data/types';
import { distanceMiles } from '../data/home';

// "What else is close to this?" selection (#65). Pure so it can be unit- and
// mutation-tested, and shared: ActivityDetail groups the result by category,
// and trip suggestions (#72) can reuse the ungrouped ranking.

// Activity-to-activity radius: roughly "do it the same day without a second
// drive".
export const NEARBY_RADIUS_MILES = 15;

// Cap per category rather than globally, so a dense cluster of hikes can't
// crowd food (the core "lunch near this hike" case) out of the list.
export const NEARBY_PER_CATEGORY = 3;

export interface NearbyActivity {
  activity: Activity;
  miles: number;
}

export interface NearbyGroup {
  category: Category;
  items: NearbyActivity[];
}

// Section heading per category group in ActivityDetail.
export const NEARBY_GROUP_HEADING: Record<Category, string> = {
  food: 'Nearby food',
  hiking: 'Nearby hikes',
  cycling: 'Nearby rides',
  water: 'Nearby on the water',
  culture: 'Nearby culture',
  scenic: 'Nearby scenic spots',
  climbing: 'Nearby climbing',
  camping: 'Nearby camping',
  other: 'More nearby',
};

/**
 * True when an activity has coordinates worth measuring from. Coords are typed
 * as required but a row can still arrive without them, and (0, 0) is the
 * "never set" sentinel AddActivity refuses to save, not a real place.
 */
export function hasUsableCoords(activity: Activity): boolean {
  const coords = activity.location.coords;
  if (!coords) return false;
  const { lat, lng } = coords;
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
}

/**
 * Every other activity within `radiusMiles` of `origin` (inclusive), nearest
 * first. Excludes `origin` itself (by id) and anything without usable coords;
 * returns nothing when `origin` has no usable coords.
 */
export function rankNearby(
  origin: Activity,
  catalog: readonly Activity[],
  radiusMiles: number = NEARBY_RADIUS_MILES,
): NearbyActivity[] {
  if (!hasUsableCoords(origin)) return [];
  const from = origin.location.coords;
  return catalog
    .filter((a) => a.id !== origin.id && hasUsableCoords(a))
    .map((activity) => ({
      activity,
      miles: distanceMiles(from, activity.location.coords),
    }))
    .filter((x) => x.miles <= radiusMiles)
    .sort((x, y) => x.miles - y.miles);
}

/**
 * Group an already nearest-first ranking by category, keeping the nearest
 * `perCategory` (≥ 1) of each. Groups are ordered by their nearest member,
 * except that food leads when the origin isn't itself food: "where do we eat
 * near this hike" is the use case the section exists for.
 */
export function groupNearby(
  ranked: readonly NearbyActivity[],
  originCategory: Category,
  perCategory: number = NEARBY_PER_CATEGORY,
): NearbyGroup[] {
  const groups = new Map<Category, NearbyActivity[]>();
  for (const item of ranked) {
    let items = groups.get(item.activity.category);
    if (!items) {
      items = [];
      groups.set(item.activity.category, items);
    }
    if (items.length < perCategory) items.push(item);
  }
  const ordered = [...groups].map(([category, items]) => ({ category, items }));
  if (originCategory === 'food') return ordered;
  return [
    ...ordered.filter((g) => g.category === 'food'),
    ...ordered.filter((g) => g.category !== 'food'),
  ];
}

/** {@link rankNearby} then {@link groupNearby}, with the defaults above. */
export function nearbyByCategory(
  origin: Activity,
  catalog: readonly Activity[],
  opts: { radiusMiles?: number; perCategory?: number } = {},
): NearbyGroup[] {
  return groupNearby(
    rankNearby(origin, catalog, opts.radiusMiles),
    origin.category,
    opts.perCategory,
  );
}

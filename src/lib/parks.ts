// A park's hikes and stops (#269): the list, the map and the detail page
// all decide nesting here, so they agree. An activity names its park by
// `parentId`; one level only.
import type { Activity } from '../data/types';

/** A list as the park cards hold it: what shows at the top, and each park's own. */
export interface Nested {
  top: Activity[];
  subItems: Map<string, Activity[]>;
}

/**
 * Nests each activity under its park when the park is in `list` too, in
 * `list`'s order. One whose park isn't there (a search or filter left it
 * out) stays at the top, so it can still be found. So does one whose park
 * is itself nested, or that names itself: nothing nests twice, and nothing
 * disappears.
 */
export function nestUnderParks(list: readonly Activity[]): Nested {
  // Keyed so an activity without a park finds none. One naming itself finds
  // itself, which is then nested: so it stays at the top, below.
  const byId = new Map<string | undefined, Activity>(list.map((a) => [a.id, a]));
  const parkIn = (a: Activity): Activity | undefined => byId.get(a.parentId);
  const top: Activity[] = [];
  const subItems = new Map<string, Activity[]>();
  for (const a of list) {
    const park = parkIn(a);
    if (!park || parkIn(park)) {
      top.push(a);
      continue;
    }
    const held = subItems.get(park.id);
    if (held) held.push(a);
    else subItems.set(park.id, [a]);
  }
  return { top, subItems };
}

/** The park `activity` is part of, when it's in `all`. */
export function parkOf(activity: Activity, all: readonly Activity[]): Activity | undefined {
  const { parentId } = activity;
  if (!parentId || parentId === activity.id) return undefined;
  return all.find((a) => a.id === parentId);
}

/** A park's hikes and stops in `all`, by name. */
export function subItemsOf(park: Activity, all: readonly Activity[]): Activity[] {
  return all
    .filter((a) => a.parentId === park.id && a.id !== park.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The id of a park's bar, which takes focus back when its section closes. */
export function parkBarId(parkId: string): string {
  return `park-bar-${parkId}`;
}

/** "6 hikes & stops", "1 hike or stop". */
export function subItemsLabel(count: number): string {
  return count === 1 ? '1 hike or stop' : `${count} hikes & stops`;
}

/**
 * What `activity` could be part of: every saved activity that isn't part of
 * another itself (one level only), other than `activity`, by name.
 */
export function parkChoices(activity: Activity, all: readonly Activity[]): Activity[] {
  return all
    .filter((a) => !a.parentId && a.id !== activity.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

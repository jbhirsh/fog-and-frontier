// The API's side of regions (#274): which ids are regions, and the one an id
// saved, drafted or sent means. The list itself is shared/regions.ts.

import { ISO_REGIONS } from '../shared/isoRegions.js';
import { CALIFORNIA_REGIONS, LEGACY_REGIONS, type Region } from '../shared/regions.js';

const CALIFORNIA = new Set<string>(CALIFORNIA_REGIONS.map(([id]) => id));
const ISO = new Set<string>(ISO_REGIONS.map(([id]) => id));

/**
 * The region `value` names, or null when it names none. An id saved before
 * #274 ("oregon") reads as the state it was; an ISO code reads in any case
 * ("us-or", as a model may write it).
 */
export function toRegion(value: unknown): Region | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (CALIFORNIA.has(id)) return id as Region;
  // Own keys only: "constructor" or "__proto__" isn't a legacy id.
  if (Object.hasOwn(LEGACY_REGIONS, id)) return LEGACY_REGIONS[id];
  const code = id.toUpperCase();
  return ISO.has(code) ? (code as Region) : null;
}

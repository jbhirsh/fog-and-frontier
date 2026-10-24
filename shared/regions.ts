// Where an activity is (#274): one of the California areas the app began
// with, or anywhere else in the world by its ISO 3166 code, a country's
// first-level subdivision (US-OR, JP-26, CA-BC) or a country that has none
// (HK). Shared by the app and the API, which can't import each other; each
// keeps its own logic. The ISO list is a type-only import here, so the app
// loads its 3,600 entries only where it needs them.

import type { ISO_REGIONS } from './isoRegions';

/** California, as the app divides it, each area with its name. */
export const CALIFORNIA_REGIONS = [
  ['sf', 'San Francisco'],
  ['north-bay', 'North Bay'],
  ['east-bay', 'East Bay'],
  ['south-bay', 'South Bay'],
  ['peninsula', 'Peninsula'],
  ['central-coast', 'Central Coast'],
  ['norcal', 'NorCal'],
  ['socal', 'SoCal'],
] as const;

type CaliforniaRegion = (typeof CALIFORNIA_REGIONS)[number][0];
type IsoRegion = (typeof ISO_REGIONS)[number][0];

export type Region = CaliforniaRegion | IsoRegion;

/** Ids saved before #274, which named two states outright, and what each is now. */
export const LEGACY_REGIONS: Readonly<Record<string, Region>> = {
  oregon: 'US-OR',
  washington: 'US-WA',
};

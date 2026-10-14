import type { Category, Region } from '../data/types';

// How the filters and the Add/Edit form name an activity's fields. Spelled out
// rather than left to CSS `capitalize`, which capitalises every word: the
// category filter's first option read "Any Category".

/** "hiking" → "Hiking": the value with its first letter capitalised. */
export function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The category filter's options: "Any category", then "Hiking" and so on. */
export function categoryOptionLabel(c: 'Any' | Category): string {
  return c === 'Any' ? 'Any category' : sentenceCase(c);
}

// The region ids are slugs ("north-bay"), so each is named outright.
export const REGION_LABELS: Readonly<Record<Region, string>> = {
  sf: 'San Francisco',
  'north-bay': 'North Bay',
  'east-bay': 'East Bay',
  'south-bay': 'South Bay',
  peninsula: 'Peninsula',
  'central-coast': 'Central Coast',
  norcal: 'NorCal',
  socal: 'SoCal',
  oregon: 'Oregon',
  washington: 'Washington',
};

import type { Category } from '../data/types';

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

// What a place is, in a word, for a fact line: a pin's card (#291) and a
// place's page on a phone (#293).
const KIND: Record<Category, string> = {
  hiking: 'Hike',
  cycling: 'Ride',
  water: 'Water',
  food: 'Food',
  culture: 'Culture',
  scenic: 'Scenic',
  climbing: 'Climb',
  camping: 'Camping',
  other: 'Other',
};

/** "hiking" → "Hike": what a place is, in a word. */
export function kindLabel(c: Category): string {
  return KIND[c];
}

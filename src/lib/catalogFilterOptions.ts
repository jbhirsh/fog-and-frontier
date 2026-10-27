import type { Category, ParkType } from '../data/types';
import { categoryOptionLabel } from './activityLabels';
import {
  INITIAL_CATALOG_FILTERS,
  type CatalogFilterState,
  type DurationFilter,
} from './useCatalogFilters';

// The catalog filters' choices, and the filters a list has on, for the two
// ways the Curated page offers them: a row of pickers on wider screens, and
// on a phone one Filters button with the filters on shown beneath it.

/** Every catalog filter but the search, which lives in the app's header. */
export type FilterValues = Omit<CatalogFilterState, 'search'>;

/** The filters with nothing on: what "Clear all" sets. */
export const NO_FILTERS: FilterValues = {
  maxDistance: INITIAL_CATALOG_FILTERS.maxDistance,
  duration: INITIAL_CATALOG_FILTERS.duration,
  category: INITIAL_CATALOG_FILTERS.category,
  parkType: INITIAL_CATALOG_FILTERS.parkType,
  dogOnly: INITIAL_CATALOG_FILTERS.dogOnly,
  completedOnly: INITIAL_CATALOG_FILTERS.completedOnly,
  freeOnly: INITIAL_CATALOG_FILTERS.freeOnly,
  contributors: INITIAL_CATALOG_FILTERS.contributors,
};

// "Within N mi of you / of San Jose" (#66): the radius is measured from the
// visitor when they shared their location, else from home.
export const DISTANCE_LIMITS = [25, 50, 100, 250];

// How long (#292): the same four choices on every screen.
export const DURATION_OPTIONS: DurationFilter[] = ['Any', 'hours', 'half', 'day'];

export const DURATION_LABELS: Record<DurationFilter, string> = {
  Any: 'Any duration',
  hours: 'A few hours',
  half: 'Half day',
  day: 'A day or more',
};

export const CATEGORY_OPTIONS: ('Any' | Category)[] = [
  'Any',
  'hiking',
  'cycling',
  'water',
  'food',
  'culture',
  'scenic',
  'climbing',
  'camping',
  'other',
];

export const PARK_TYPE_OPTIONS: ('Any' | ParkType)[] = [
  'Any',
  'national',
  'state',
  'regional',
  'county',
  'city',
  'private',
  'none',
];

export const PARK_TYPE_LABELS: Record<'Any' | ParkType, string> = {
  Any: 'Any park type',
  national: 'National park',
  state: 'State park',
  regional: 'Regional park',
  county: 'County park',
  city: 'City park',
  private: 'Private land',
  none: 'Not in a park',
};

/** One filter that's on: what it reads as, and the change that takes it off. */
export interface AppliedFilter {
  /** Stable across renders, for React and for focus after a removal. */
  key: string;
  label: string;
  off: Partial<FilterValues>;
}

/**
 * The filters `values` has on, in the order the sheet lists them, each with
 * the change that turns it off. A contributor is one each, so any of them
 * can go on its own; `personLabel` names them.
 */
export function appliedFilters(
  values: FilterValues,
  personLabel: (email: string) => string,
): AppliedFilter[] {
  const on: AppliedFilter[] = [];
  if (values.category !== 'Any') {
    on.push({
      key: 'category',
      label: categoryOptionLabel(values.category),
      off: { category: 'Any' },
    });
  }
  if (values.maxDistance !== Infinity) {
    on.push({
      key: 'distance',
      label: `Within ${values.maxDistance} mi`,
      off: { maxDistance: Infinity },
    });
  }
  if (values.duration !== 'Any') {
    on.push({
      key: 'duration',
      label: DURATION_LABELS[values.duration],
      off: { duration: 'Any' },
    });
  }
  if (values.dogOnly) on.push({ key: 'dog', label: 'Dogs welcome', off: { dogOnly: false } });
  if (values.freeOnly) on.push({ key: 'free', label: 'Free', off: { freeOnly: false } });
  if (values.completedOnly) {
    on.push({ key: 'completed', label: "Places we've done", off: { completedOnly: false } });
  }
  if (values.parkType !== 'Any') {
    on.push({
      key: 'park',
      label: PARK_TYPE_LABELS[values.parkType],
      off: { parkType: 'Any' },
    });
  }
  for (const email of values.contributors) {
    on.push({
      key: `by:${email}`,
      label: `Added by ${personLabel(email)}`,
      off: { contributors: values.contributors.filter((e) => e !== email) },
    });
  }
  return on;
}

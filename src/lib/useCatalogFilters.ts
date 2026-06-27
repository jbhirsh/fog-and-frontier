import { useMemo, useState } from 'react';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import type { Activity, Category, Duration, ParkType } from '../data/types';

// The six catalog filters, shared across every surface that lists activities
// (the Curated grid today; the split view's list + map column next — see #4).
// Keeping the state and the selector in one place means each surface filters
// identically and #9 / #5 / #16 can stack onto the same seam rather than
// duplicating `useState` clusters.

export type DurationFilter = 'Any' | Duration;
export type CategoryFilter = 'Any' | Category;
export type ParkTypeFilter = 'Any' | ParkType;

export interface CatalogFilterState {
  search: string;
  maxDistance: number;
  duration: DurationFilter;
  category: CategoryFilter;
  parkType: ParkTypeFilter;
  dogOnly: boolean;
}

export const INITIAL_CATALOG_FILTERS: CatalogFilterState = {
  search: '',
  maxDistance: Infinity,
  duration: 'Any',
  category: 'Any',
  parkType: 'Any',
  dogOnly: false,
};

/**
 * Pure selector: apply the catalog filters to a list of activities, returning
 * a new list sorted by distance from {@link HOME_LOCATION} (nearest first).
 *
 * This reproduces the exact semantics the Curated grid has always used:
 * distance / duration / category / parkType / dog-friendly gates plus a
 * free-text search over name, short description, city and category.
 */
export function applyCatalogFilters(
  activities: Activity[],
  filters: CatalogFilterState,
): Activity[] {
  const { search, maxDistance, duration, category, parkType, dogOnly } =
    filters;
  const q = search.trim().toLowerCase();
  return activities
    .map((a) => ({
      a,
      miles: distanceMiles(HOME_LOCATION.coords, a.location.coords),
    }))
    .filter(({ a, miles }) => {
      if (miles > maxDistance) return false;
      if (duration !== 'Any' && a.duration !== duration) return false;
      if (category !== 'Any' && a.category !== category) return false;
      if (parkType !== 'Any' && (a.parkType ?? 'none') !== parkType)
        return false;
      if (dogOnly && !a.dogFriendly) return false;
      if (q) {
        const hay = `${a.name} ${a.shortDescription} ${a.location.city} ${a.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((x, y) => x.miles - y.miles)
    .map(({ a }) => a);
}

export interface CatalogFilters extends CatalogFilterState {
  setSearch: (value: string) => void;
  setMaxDistance: (value: number) => void;
  setDuration: (value: DurationFilter) => void;
  setCategory: (value: CategoryFilter) => void;
  setParkType: (value: ParkTypeFilter) => void;
  setDogOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  /** Apply the current filters to `activities` (memoized on the inputs). */
  applyFilters: (activities: Activity[]) => Activity[];
}

/**
 * Shared catalog filter state: the six filter values, their setters, and a
 * memoized {@link applyCatalogFilters} bound to the current state.
 */
export function useCatalogFilters(): CatalogFilters {
  const [search, setSearch] = useState(INITIAL_CATALOG_FILTERS.search);
  const [maxDistance, setMaxDistance] = useState<number>(
    INITIAL_CATALOG_FILTERS.maxDistance,
  );
  const [duration, setDuration] = useState<DurationFilter>(
    INITIAL_CATALOG_FILTERS.duration,
  );
  const [category, setCategory] = useState<CategoryFilter>(
    INITIAL_CATALOG_FILTERS.category,
  );
  const [parkType, setParkType] = useState<ParkTypeFilter>(
    INITIAL_CATALOG_FILTERS.parkType,
  );
  const [dogOnly, setDogOnly] = useState(INITIAL_CATALOG_FILTERS.dogOnly);

  const applyFilters = useMemo(() => {
    const filters: CatalogFilterState = {
      search,
      maxDistance,
      duration,
      category,
      parkType,
      dogOnly,
    };
    return (activities: Activity[]) => applyCatalogFilters(activities, filters);
  }, [search, maxDistance, duration, category, parkType, dogOnly]);

  return {
    search,
    maxDistance,
    duration,
    category,
    parkType,
    dogOnly,
    setSearch,
    setMaxDistance,
    setDuration,
    setCategory,
    setParkType,
    setDogOnly,
    applyFilters,
  };
}

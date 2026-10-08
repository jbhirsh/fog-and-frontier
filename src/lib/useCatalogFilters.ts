import { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import type { Activity, Category, Duration, ParkType } from '../data/types';
import { isEffectivelyCompleted, type Overrides } from './userCompleted';
import type { DrivingMiles } from './drivingMiles';

// The catalog filters, shared across every surface that lists activities
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
  /** "Completed only" (#5): keep just the activities marked completed. */
  completedOnly: boolean;
}

export const INITIAL_CATALOG_FILTERS: CatalogFilterState = {
  search: '',
  maxDistance: Infinity,
  duration: 'Any',
  category: 'Any',
  parkType: 'Any',
  dogOnly: false,
  completedOnly: false,
};

// "Completed only" is URL-synced as `?completed=1` (#5) so a filtered list is
// shareable and the retired /adventures route can redirect to it.
export const COMPLETED_PARAM = 'completed';

/** Whether the URL asks for "Completed only" (`?completed=1`). */
export function readCompletedOnly(params: URLSearchParams): boolean {
  return params.get(COMPLETED_PARAM) === '1';
}

/**
 * A copy of `params` with "Completed only" set (`?completed=1`) or cleared
 * (param removed, so the default view has a clean URL). Other params are kept.
 */
export function withCompletedOnly(
  params: URLSearchParams,
  completedOnly: boolean,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (completedOnly) next.set(COMPLETED_PARAM, '1');
  else next.delete(COMPLETED_PARAM);
  return next;
}

/**
 * Pure selector: apply the catalog filters to a list of activities, returning
 * a new list sorted by distance from `from` (nearest first): the visitor's
 * position when they shared it (#66), else {@link HOME_LOCATION}. Distances
 * are road miles from `driving` where known, else straight-line.
 *
 * This reproduces the exact semantics the Curated grid has always used:
 * distance / duration / category / parkType / dog-friendly gates plus a
 * free-text search over name, short description, city and category.
 *
 * "Completed only" uses the effective completion state, so it needs the
 * per-activity completion `overrides` (see {@link isEffectivelyCompleted});
 * callers pass them in rather than this pure selector reading a hook.
 */
export function applyCatalogFilters(
  activities: Activity[],
  filters: CatalogFilterState,
  overrides: Overrides = {},
  from: { lat: number; lng: number } = HOME_LOCATION.coords,
  driving: DrivingMiles = new Map(),
): Activity[] {
  const {
    search,
    maxDistance,
    duration,
    category,
    parkType,
    dogOnly,
    completedOnly,
  } = filters;
  const q = search.trim().toLowerCase();
  return activities
    .map((a) => ({
      a,
      miles: driving.get(a.id) ?? distanceMiles(from, a.location.coords),
    }))
    .filter(({ a, miles }) => {
      if (miles > maxDistance) return false;
      if (duration !== 'Any' && a.duration !== duration) return false;
      if (category !== 'Any' && a.category !== category) return false;
      if (parkType !== 'Any' && (a.parkType ?? 'none') !== parkType)
        return false;
      if (dogOnly && !a.dogFriendly) return false;
      if (completedOnly && !isEffectivelyCompleted(a, overrides)) return false;
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
  setSearch: Dispatch<SetStateAction<string>>;
  setMaxDistance: Dispatch<SetStateAction<number>>;
  setDuration: Dispatch<SetStateAction<DurationFilter>>;
  setCategory: Dispatch<SetStateAction<CategoryFilter>>;
  setParkType: Dispatch<SetStateAction<ParkTypeFilter>>;
  setDogOnly: Dispatch<SetStateAction<boolean>>;
  setCompletedOnly: Dispatch<SetStateAction<boolean>>;
  /**
   * Apply the current filters to `activities` (memoized on the filters), with
   * the completion `overrides` the "Completed only" filter reads, measuring
   * distance from `from` (home by default).
   */
  applyFilters: (
    activities: Activity[],
    overrides?: Overrides,
    from?: { lat: number; lng: number },
    driving?: DrivingMiles,
  ) => Activity[];
}

/**
 * Shared catalog filter state: the filter values, their setters, and a
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
  const [completedOnly, setCompletedOnly] = useState(
    INITIAL_CATALOG_FILTERS.completedOnly,
  );

  const applyFilters = useMemo(() => {
    const filters: CatalogFilterState = {
      search,
      maxDistance,
      duration,
      category,
      parkType,
      dogOnly,
      completedOnly,
    };
    return (
      activities: Activity[],
      overrides?: Overrides,
      from?: { lat: number; lng: number },
      driving?: DrivingMiles,
    ) => applyCatalogFilters(activities, filters, overrides, from, driving);
  }, [search, maxDistance, duration, category, parkType, dogOnly, completedOnly]);

  return {
    search,
    maxDistance,
    duration,
    category,
    parkType,
    dogOnly,
    completedOnly,
    setSearch,
    setMaxDistance,
    setDuration,
    setCategory,
    setParkType,
    setDogOnly,
    setCompletedOnly,
    applyFilters,
  };
}

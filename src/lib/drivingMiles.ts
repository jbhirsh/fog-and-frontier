import { createContext, useCallback, useContext } from 'react';
import { distanceMiles } from '../data/home';
import { useDistanceOrigin, type DistanceOrigin } from './distanceOrigin';

// Driving miles (#66). A straight line understates the drive, often by a
// third, so the app asks the server for road miles from the distance origin
// (api/_resolvers/driving.ts) and shows those. Until they arrive, or for an
// activity the router can't reach, it falls back to the straight-line
// estimate and marks it "≈".

/** Road miles by activity id. */
export type DrivingMiles = ReadonlyMap<string, number>;

export const NO_DRIVING_MILES: DrivingMiles = new Map();

export const DrivingMilesCtx = createContext<DrivingMiles>(NO_DRIVING_MILES);

/**
 * Two decimals, about 1 km: all of the visitor's position that leaves the
 * browser, and enough for a mileage label.
 */
export function coarse(n: number): number {
  return Math.round(n * 100) / 100;
}

export function toDrivingMiles(rows: readonly { id: string; miles: number }[]): DrivingMiles {
  return new Map(rows.map((r) => [r.id, r.miles]));
}

export interface Distance {
  miles: number;
  /** Road miles; false for the straight-line fallback. */
  driving: boolean;
}

interface Located {
  id: string;
  location: { coords: { lat: number; lng: number } };
}

export function distanceTo(
  origin: DistanceOrigin,
  driving: DrivingMiles,
  activity: Located,
): Distance {
  const road = driving.get(activity.id);
  return road === undefined
    ? { miles: distanceMiles(origin.coords, activity.location.coords), driving: false }
    : { miles: road, driving: true };
}

/**
 * "21", "4.2" (one decimal under 10 mi), or "1.0" with `precise`. A
 * straight-line estimate reads "≈18".
 */
export function formatMiles({ miles, driving }: Distance, precise = false): string {
  const n = precise || miles < 10 ? miles.toFixed(1) : String(Math.round(miles));
  return driving ? n : `≈${n}`;
}

/** The distance from the current origin to an activity. */
export function useDistanceTo(): (activity: Located) => Distance {
  const origin = useDistanceOrigin();
  const driving = useContext(DrivingMilesCtx);
  return useCallback((activity) => distanceTo(origin, driving, activity), [origin, driving]);
}

/** Road miles by id, for callers that sort or filter many activities. */
export function useDrivingMiles(): DrivingMiles {
  return useContext(DrivingMilesCtx);
}

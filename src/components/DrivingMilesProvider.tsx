import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@apollo/client/react';
import { DRIVING_MILES_QUERY } from '../lib/gqlDocs';
import { useDistanceOrigin } from '../lib/distanceOrigin';
import {
  DrivingMilesCtx,
  NO_DRIVING_MILES,
  coarse,
  toDrivingMiles,
} from '../lib/drivingMiles';

/**
 * Fetches road miles from the current distance origin (#66) and hands them to
 * every distance below it. Until they land, or if routing is unavailable,
 * distances stay straight-line estimates. Only the coarse (~1 km) origin is
 * sent. `no-cache`: each origin's answer is fetched once per load, and
 * keeping per-origin rows out of the normalized cache stops one origin's miles
 * overwriting another's.
 */
export function DrivingMilesProvider({ children }: { children: ReactNode }) {
  const origin = useDistanceOrigin();
  const { data } = useQuery(DRIVING_MILES_QUERY, {
    variables: { lat: coarse(origin.coords.lat), lng: coarse(origin.coords.lng) },
    fetchPolicy: 'no-cache',
  });
  const driving = useMemo(
    () => (data ? toDrivingMiles(data.drivingMiles) : NO_DRIVING_MILES),
    [data],
  );
  return <DrivingMilesCtx.Provider value={driving}>{children}</DrivingMilesCtx.Provider>;
}

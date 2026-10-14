import type { Activity } from '../data/types';
import { apolloClient } from './apolloClient';
import { CHECK_DUPLICATE_QUERY } from './gqlDocs';

// Saved activities that look like one being added (#17), as the server
// matches them: 'high' (same name within 500 m) blocks the save until the
// owner says it's different; 'possible' is only a heads-up.
export type DuplicateMatch = {
  id: string;
  name: string;
  city: string;
  distanceMeters: number;
  confidence: 'high' | 'possible';
};

export async function checkDuplicates(activity: Activity): Promise<DuplicateMatch[]> {
  const { data } = await apolloClient.query({
    query: CHECK_DUPLICATE_QUERY,
    variables: {
      name: activity.name,
      lat: activity.location.coords.lat,
      lng: activity.location.coords.lng,
    },
    fetchPolicy: 'network-only',
  });
  return (data?.checkDuplicate ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    city: m.city,
    distanceMeters: m.distanceMeters,
    confidence: m.confidence,
  }));
}

/**
 * The high-confidence matches the owner hasn't said are different places
 * (#17). "Save anyway" acknowledges the ones on screen; a save holds while
 * any other turns up, so it never approves a match nobody saw.
 */
export function unacknowledgedHigh(
  found: readonly DuplicateMatch[],
  acknowledged: readonly string[],
): DuplicateMatch[] {
  return found.filter((m) => m.confidence === 'high' && !acknowledged.includes(m.id));
}

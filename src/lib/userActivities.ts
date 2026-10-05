import { useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import type { Activity, Duration, PriceRange, Region } from '../data/types';
import { apolloClient } from './apolloClient';
import {
  ACTIVITIES_QUERY,
  DELETE_ACTIVITY,
  SAVE_ACTIVITY,
  type ActivityLike,
} from './gqlDocs';

// Boundary mapper: GraphQL Activity/ActivitySnapshot row -> the app's domain
// Activity model. Catalog rows are non-null; snapshot rows are all-nullable
// (and may be null-coerced by the server), so we coalesce defensively. The
// String-typed scalars (region/duration/priceRange) are narrowed to their
// domain unions; the GraphQL enums (category/difficulty/parkType) already match.
export function rowToActivity(row: ActivityLike): Activity {
  const loc = row.location;
  return {
    id: row.id ?? '',
    name: row.name ?? '',
    shortDescription: row.shortDescription ?? '',
    longDescription: row.longDescription ?? undefined,
    category: row.category ?? 'other',
    region: (row.region ?? '') as Region,
    parkType: row.parkType ?? undefined,
    location: {
      city: loc?.city ?? '',
      coords: { lat: loc?.coords.lat ?? 0, lng: loc?.coords.lng ?? 0 },
    },
    duration: (row.duration ?? '') as Duration,
    durationDetail: row.durationDetail ?? undefined,
    difficulty: row.difficulty ?? undefined,
    dogFriendly: row.dogFriendly ?? undefined,
    coverImage: row.coverImage ?? '',
    coverCredit: row.coverCredit ?? undefined,
    galleryImages: row.galleryImages ?? undefined,
    allTrailsUrl: row.allTrailsUrl ?? undefined,
    allTrailsRating: row.allTrailsRating ?? undefined,
    hikeDistanceMiles: row.hikeDistanceMiles ?? undefined,
    hikeElevationFeet: row.hikeElevationFeet ?? undefined,
    cuisine: row.cuisine ?? undefined,
    priceRange: (row.priceRange ?? undefined) as PriceRange | undefined,
    hours: row.hours ?? undefined,
    reservationUrl: row.reservationUrl ?? undefined,
    menuUrl: row.menuUrl ?? undefined,
    dietary: row.dietary ?? undefined,
    completed: row.completed ?? undefined,
    completedDate: row.completedDate ?? undefined,
    notes: row.notes ?? undefined,
  };
}

// Domain Activity -> ActivityInput (camelCase, scalars widen to String/enum).
// Optional fields go out as null so a cleared value is persisted.
function activityToInput(a: Activity) {
  return {
    name: a.name,
    shortDescription: a.shortDescription,
    longDescription: a.longDescription ?? null,
    category: a.category,
    region: a.region,
    parkType: a.parkType ?? null,
    location: {
      city: a.location.city,
      coords: { lat: a.location.coords.lat, lng: a.location.coords.lng },
    },
    duration: a.duration,
    durationDetail: a.durationDetail ?? null,
    difficulty: a.difficulty ?? null,
    dogFriendly: a.dogFriendly ?? null,
    coverImage: a.coverImage,
    coverCredit: a.coverCredit ?? null,
    galleryImages: a.galleryImages ?? null,
    allTrailsUrl: a.allTrailsUrl ?? null,
    allTrailsRating: a.allTrailsRating ?? null,
    hikeDistanceMiles: a.hikeDistanceMiles ?? null,
    hikeElevationFeet: a.hikeElevationFeet ?? null,
    cuisine: a.cuisine ?? null,
    priceRange: a.priceRange ?? null,
    hours: a.hours ?? null,
    reservationUrl: a.reservationUrl ?? null,
    menuUrl: a.menuUrl ?? null,
    dietary: a.dietary ?? null,
    completed: a.completed ?? null,
    completedDate: a.completedDate ?? null,
    notes: a.notes ?? null,
  };
}

export const CATALOG_LOAD_ERROR =
  "Couldn't load activities. Try again in a moment.";

// Public catalog read. cache-and-network: instant cached render + background
// refresh (offline persistence was dropped in the GraphQL migration). `error`
// is a user-facing message when the read failed, so a page can say so instead
// of rendering the failure as an empty catalog.
export function useUserActivities(): {
  activities: Activity[];
  error: string | null;
} {
  const { data, error } = useQuery(ACTIVITIES_QUERY, {
    fetchPolicy: 'cache-and-network',
  });
  const activities = useMemo(
    () => (data?.activities ?? []).map(rowToActivity),
    [data],
  );
  return { activities, error: error ? CATALOG_LOAD_ERROR : null };
}

export function useAllActivities(): Activity[] {
  return useUserActivities().activities;
}

// Owner-only upsert; refetches the catalog so a new card appears (a normalized
// edit updates in place, but a brand-new id won't join the list otherwise).
export async function saveUserActivity(activity: Activity): Promise<void> {
  await apolloClient.mutate({
    mutation: SAVE_ACTIVITY,
    variables: {
      input: { id: activity.id, activity: activityToInput(activity) },
    },
    refetchQueries: [{ query: ACTIVITIES_QUERY }],
    awaitRefetchQueries: true,
  });
}

export async function deleteUserActivity(id: string): Promise<void> {
  await apolloClient.mutate({
    mutation: DELETE_ACTIVITY,
    variables: { input: { id } },
    refetchQueries: [{ query: ACTIVITIES_QUERY }],
    awaitRefetchQueries: true,
  });
}

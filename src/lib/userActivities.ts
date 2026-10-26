import { useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import type { Activity, Duration, Region } from '../data/types';
import { rowDetails } from './activityDetails';
import { apolloClient } from './apolloClient';
import { ACTIVITIES_QUERY, DELETE_ACTIVITY, SAVE_ACTIVITY, type ActivityLike } from './gqlDocs';

// Boundary mapper: GraphQL Activity/ActivitySnapshot row -> the app's domain
// Activity model. Catalog rows are non-null; snapshot rows are all-nullable
// (and may be null-coerced by the server), so we coalesce defensively. The
// String-typed scalars (region/duration/priceRange/costTier) are narrowed to their
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
    ...rowDetails(row),
    coverImage: row.coverImage ?? '',
    galleryImages: row.galleryImages ?? undefined,
    allTrailsRating: row.allTrailsRating ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    cardLine: row.cardLine ?? undefined,
    cardName: row.cardName ?? undefined,
    parentId: row.parentId ?? undefined,
    completed: row.completed ?? undefined,
    completedDate: row.completedDate ?? undefined,
    contributors: row.contributors ?? undefined,
  };
}

// Domain Activity -> ActivityInput (camelCase, scalars widen to String/enum).
// Optional fields go out as null so a cleared value is persisted.
export function activityToInput(a: Activity) {
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
    costTier: a.costTier ?? null,
    hours: a.hours ?? null,
    reservationUrl: a.reservationUrl ?? null,
    menuUrl: a.menuUrl ?? null,
    dietary: a.dietary ?? null,
    sourceUrl: a.sourceUrl ?? null,
    cardLine: a.cardLine ?? null,
    cardName: a.cardName ?? null,
    parentId: a.parentId ?? null,
    completed: a.completed ?? null,
    completedDate: a.completedDate ?? null,
    notes: a.notes ?? null,
    // Null asks the server to keep the stored list (or credit the caller on
    // a new activity), so a save never drops who added it (#9).
    contributors: a.contributors ?? null,
  };
}

export const CATALOG_LOAD_ERROR = "Couldn't load activities. Try again in a moment.";

// Public catalog read. cache-and-network: instant cached render + background
// refresh (offline persistence was dropped in the GraphQL migration). `error`
// is a user-facing message when the read failed, so a page can say so instead
// of rendering the failure as an empty catalog. `loading` is the first load
// only (nothing cached yet), so a permalink can tell "not loaded" from "no
// such activity" (#86).
export function useUserActivities(): {
  activities: Activity[];
  error: string | null;
  loading: boolean;
} {
  const { data, error, loading } = useQuery(ACTIVITIES_QUERY, {
    fetchPolicy: 'cache-and-network',
  });
  const activities = useMemo(() => (data?.activities ?? []).map(rowToActivity), [data]);
  return {
    activities,
    error: error ? CATALOG_LOAD_ERROR : null,
    loading: loading && !data,
  };
}

export function useAllActivities(): Activity[] {
  return useUserActivities().activities;
}

// Owner-only upsert; refetches the catalog so a new card appears (a normalized
// edit updates in place, but a brand-new id won't join the list otherwise).
// `create` saves a new activity (#17): the server matches it against the
// catalog and saves it under a free id, which this returns; without it the
// save is an edit of `activity.id`. `allowDuplicate` creates it even when it
// looks like one already saved, once the owner has said it's different.
export async function saveUserActivity(
  activity: Activity,
  { create = false, allowDuplicate = false }: { create?: boolean; allowDuplicate?: boolean } = {},
): Promise<string> {
  const { data } = await apolloClient.mutate({
    mutation: SAVE_ACTIVITY,
    variables: {
      input: {
        id: activity.id,
        activity: activityToInput(activity),
        ...(create ? { create: true } : {}),
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
      },
    },
    // Road miles too (#66). The server forgets its cached catalog on save, so
    // the new or moved activity usually gets road miles straight away; if the
    // refetch lands on another instance, within a minute.
    refetchQueries: [{ query: ACTIVITIES_QUERY }, 'DrivingMiles'],
    awaitRefetchQueries: true,
  });
  return data?.saveActivity.activity.id ?? activity.id;
}

export async function deleteUserActivity(id: string): Promise<void> {
  await apolloClient.mutate({
    mutation: DELETE_ACTIVITY,
    variables: { input: { id } },
    refetchQueries: [{ query: ACTIVITIES_QUERY }],
    awaitRefetchQueries: true,
  });
}

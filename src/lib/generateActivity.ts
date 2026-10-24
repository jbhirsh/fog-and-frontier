import type { Category, Duration, ParkType, Region } from '../data/types';
import { rowDetails, type Details } from './activityDetails';
import { apolloClient } from './apolloClient';
import { GENERATE_ACTIVITY, type GeneratedActivityRow } from './gqlDocs';

// Gemini-generated activity draft (owner-only). Mirrors the catalog Activity
// shape minus id/location-nesting (the model returns flat city/lat/lng).
export type GeneratedFields = Details & {
  name: string;
  shortDescription: string;
  longDescription?: string;
  category: Category;
  // None when Gemini named no region on the list (#274): the form asks.
  region?: Region;
  parkType?: ParkType;
  city: string;
  lat: number;
  lng: number;
  duration: Duration;
  coverImage?: string;
  // The saved park it's part of (#269), matched from the park Gemini named.
  parentId?: string;
};

function rowToGenerated(row: GeneratedActivityRow): GeneratedFields {
  return {
    name: row.name,
    shortDescription: row.shortDescription,
    longDescription: row.longDescription ?? undefined,
    category: row.category,
    region: (row.region as Region | null) ?? undefined,
    parkType: row.parkType ?? undefined,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    duration: row.duration as Duration,
    ...rowDetails(row),
    coverImage: row.coverImage ?? undefined,
    parentId: row.parentId ?? undefined,
  };
}

export async function generateActivity(title: string, notes: string): Promise<GeneratedFields> {
  const { data } = await apolloClient.mutate({
    mutation: GENERATE_ACTIVITY,
    variables: { input: { title, notes } },
  });
  const activity = data?.generateActivity.activity;
  if (!activity) throw new Error('No activity was generated');
  return rowToGenerated(activity);
}

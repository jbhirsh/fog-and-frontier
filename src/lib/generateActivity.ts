import type { Category, Duration, ParkType, Region } from '../data/types';
import { rowDetails, type Details } from './activityDetails';
import { apolloClient } from './apolloClient';
import { GENERATE_ACTIVITY, type GeneratedActivityRow } from './gqlDocs';
import type { TrailOption } from './trailOptions';

// Gemini-generated activity draft (owner-only). Mirrors the catalog Activity
// shape minus id/location-nesting (the model returns flat city/lat/lng).
export type GeneratedFields = Details & {
  name: string;
  shortDescription: string;
  longDescription?: string;
  // Its card's copy (#295), each dropped by the server when it didn't fit.
  cardLine?: string;
  cardName?: string;
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
  // The trails its AllTrails search found to choose from (#6), its pick first.
  allTrailsOptions?: TrailOption[];
};

function rowToGenerated(row: GeneratedActivityRow): GeneratedFields {
  return {
    name: row.name,
    shortDescription: row.shortDescription,
    longDescription: row.longDescription ?? undefined,
    cardLine: row.cardLine ?? undefined,
    cardName: row.cardName ?? undefined,
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
    allTrailsOptions: row.allTrailsOptions?.map((o) => ({
      url: o.url,
      title: o.title,
      description: o.description,
      image: o.image ?? undefined,
      rating: o.rating ?? undefined,
      reviews: o.reviews ?? undefined,
      miles: o.miles ?? undefined,
      feet: o.feet ?? undefined,
    })),
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

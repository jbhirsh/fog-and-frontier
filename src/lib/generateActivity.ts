import type {
  Category,
  Difficulty,
  Duration,
  ParkType,
  PriceRange,
  Region,
} from '../data/types';
import { apolloClient } from './apolloClient';
import { GENERATE_ACTIVITY, type GeneratedActivityRow } from './gqlDocs';

// Gemini-generated activity draft (owner-only). Mirrors the catalog Activity
// shape minus id/location-nesting (the model returns flat city/lat/lng).
export type GeneratedFields = {
  name: string;
  shortDescription: string;
  longDescription?: string;
  category: Category;
  region: Region;
  parkType?: ParkType;
  city: string;
  lat: number;
  lng: number;
  duration: Duration;
  durationDetail?: string;
  difficulty?: Difficulty;
  dogFriendly?: boolean;
  hikeDistanceMiles?: number;
  hikeElevationFeet?: number;
  allTrailsUrl?: string;
  cuisine?: string;
  priceRange?: PriceRange;
  hours?: string;
  reservationUrl?: string;
  menuUrl?: string;
  dietary?: string[];
  notes?: string;
  coverImage?: string;
};

function rowToGenerated(row: GeneratedActivityRow): GeneratedFields {
  return {
    name: row.name,
    shortDescription: row.shortDescription,
    longDescription: row.longDescription ?? undefined,
    category: row.category,
    region: row.region as Region,
    parkType: row.parkType ?? undefined,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    duration: row.duration as Duration,
    durationDetail: row.durationDetail ?? undefined,
    difficulty: row.difficulty ?? undefined,
    dogFriendly: row.dogFriendly ?? undefined,
    hikeDistanceMiles: row.hikeDistanceMiles ?? undefined,
    hikeElevationFeet: row.hikeElevationFeet ?? undefined,
    allTrailsUrl: row.allTrailsUrl ?? undefined,
    cuisine: row.cuisine ?? undefined,
    priceRange: (row.priceRange ?? undefined) as PriceRange | undefined,
    hours: row.hours ?? undefined,
    reservationUrl: row.reservationUrl ?? undefined,
    menuUrl: row.menuUrl ?? undefined,
    dietary: row.dietary ?? undefined,
    notes: row.notes ?? undefined,
    coverImage: row.coverImage ?? undefined,
  };
}

export async function generateActivity(
  title: string,
  notes: string,
): Promise<GeneratedFields> {
  const { data } = await apolloClient.mutate({
    mutation: GENERATE_ACTIVITY,
    variables: { input: { title, notes } },
  });
  const activity = data?.generateActivity.activity;
  if (!activity) throw new Error('No activity was generated');
  return rowToGenerated(activity);
}

import type { CostTier, Difficulty, PriceRange } from '../data/types';

/**
 * An activity's optional details as GraphQL sends them, null when unset: the
 * part a catalog row, a trip snapshot and a Gemini draft share.
 */
export interface DetailRow {
  durationDetail?: string | null;
  difficulty?: Difficulty | null;
  dogFriendly?: boolean | null;
  hikeDistanceMiles?: number | null;
  hikeElevationFeet?: number | null;
  allTrailsUrl?: string | null;
  cuisine?: string | null;
  priceRange?: string | null;
  costTier?: string | null;
  hours?: string | null;
  reservationUrl?: string | null;
  menuUrl?: string | null;
  dietary?: string[] | null;
  notes?: string | null;
  coverCredit?: string | null;
}

/** The same details as the app's models hold them: absent when unset. */
export interface Details {
  durationDetail?: string;
  difficulty?: Difficulty;
  dogFriendly?: boolean;
  hikeDistanceMiles?: number;
  hikeElevationFeet?: number;
  allTrailsUrl?: string;
  cuisine?: string;
  priceRange?: PriceRange;
  costTier?: CostTier;
  hours?: string;
  reservationUrl?: string;
  menuUrl?: string;
  dietary?: string[];
  notes?: string;
  coverCredit?: string;
}

/**
 * A row's optional details, null turned to undefined. The String-typed
 * scalars (priceRange, costTier) are narrowed to their domain unions.
 */
export function rowDetails(row: DetailRow): Details {
  return {
    durationDetail: row.durationDetail ?? undefined,
    difficulty: row.difficulty ?? undefined,
    dogFriendly: row.dogFriendly ?? undefined,
    hikeDistanceMiles: row.hikeDistanceMiles ?? undefined,
    hikeElevationFeet: row.hikeElevationFeet ?? undefined,
    allTrailsUrl: row.allTrailsUrl ?? undefined,
    cuisine: row.cuisine ?? undefined,
    priceRange: (row.priceRange ?? undefined) as PriceRange | undefined,
    costTier: (row.costTier ?? undefined) as CostTier | undefined,
    hours: row.hours ?? undefined,
    reservationUrl: row.reservationUrl ?? undefined,
    menuUrl: row.menuUrl ?? undefined,
    dietary: row.dietary ?? undefined,
    notes: row.notes ?? undefined,
    coverCredit: row.coverCredit ?? undefined,
  };
}

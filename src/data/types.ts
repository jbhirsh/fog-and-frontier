export type Category =
  'hiking' | 'cycling' | 'water' | 'food' | 'culture' | 'scenic' | 'climbing' | 'camping' | 'other';

export type Duration =
  '1-2 Hours' | '2-3 Hours' | 'Half Day' | 'Full Day' | 'Weekend' | 'Multi-Day';

export type Difficulty = 'easy' | 'moderate' | 'advanced';

// Rough cost tier for restaurants ($ cheap → $$$$ splurge). See issue #76.
export type PriceRange = '$' | '$$' | '$$$' | '$$$$';
// What it costs one person to do (#85): free, $ under $25, $$ $25–75, $$$ over $75.
export type CostTier = 'free' | '$' | '$$' | '$$$';

// Where an activity is (#274): a California area or an ISO 3166 code. The
// list is shared with the API, in shared/regions.ts.
import type { Region } from '../../shared/regions';

export type { Region };

// Who manages the land an activity sits on. Optional — not every activity is
// in a park. Drives the park-designation filter (state park vs county park,
// etc.) in the catalog. See issue #77.
export type ParkType = 'national' | 'state' | 'regional' | 'county' | 'city' | 'private' | 'none';

export interface Activity {
  id: string;
  name: string;
  shortDescription: string;
  longDescription?: string;
  category: Category;
  region: Region;
  parkType?: ParkType;
  location: {
    city: string;
    coords: { lat: number; lng: number };
  };
  duration: Duration;
  durationDetail?: string;
  difficulty?: Difficulty;
  dogFriendly?: boolean;
  coverImage: string;
  // Attribution line for a freely licensed cover (author + license), set when
  // the cover came from the Wikimedia Commons lookup (#36).
  coverCredit?: string;
  galleryImages?: string[];
  allTrailsUrl?: string;
  allTrailsRating?: number;
  hikeDistanceMiles?: number;
  hikeElevationFeet?: number;
  // Restaurant fields (#76) — only meaningful when category === 'food'.
  // All optional; render only when present (field-presence, not a category
  // switch) so a "food" entry without them still works.
  cuisine?: string;
  priceRange?: PriceRange;
  costTier?: CostTier;
  hours?: string;
  reservationUrl?: string;
  menuUrl?: string;
  dietary?: string[];
  // Where it was found (#6): the Instagram post it was added from, say.
  sourceUrl?: string;
  // What its card shows on a phone (#295), written to fit and shown whole: a
  // line of at most 50 characters, and for a name over 40, a shorter one.
  cardLine?: string;
  cardName?: string;
  // The activity it's part of (#269): a park, for one of its hikes or stops.
  parentId?: string;
  completed?: boolean;
  completedDate?: string;
  notes?: string;
  // Account emails credited with adding it (#9). The server sends them only
  // to signed-in callers, so a signed-out visitor never has any.
  contributors?: string[];
}

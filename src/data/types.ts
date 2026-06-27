export type Category =
  | 'hiking'
  | 'cycling'
  | 'water'
  | 'food'
  | 'culture'
  | 'scenic'
  | 'climbing'
  | 'camping'
  | 'other';

export type Duration =
  | '1-2 Hours'
  | '2-3 Hours'
  | 'Half Day'
  | 'Full Day'
  | 'Weekend'
  | 'Multi-Day';

export type Difficulty = 'easy' | 'moderate' | 'advanced';

// Rough cost tier for restaurants ($ cheap → $$$$ splurge). See issue #76.
export type PriceRange = '$' | '$$' | '$$$' | '$$$$';

export type Region = 'sf' | 'north-bay' | 'east-bay' | 'south-bay' | 'peninsula' | 'central-coast' | 'norcal' | 'socal' | 'oregon' | 'washington';

// Who manages the land an activity sits on. Optional — not every activity is
// in a park. Drives the park-designation filter (state park vs county park,
// etc.) in the catalog. See issue #77.
export type ParkType =
  | 'national'
  | 'state'
  | 'regional'
  | 'county'
  | 'city'
  | 'private'
  | 'none';

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
  hours?: string;
  reservationUrl?: string;
  menuUrl?: string;
  dietary?: string[];
  completed?: boolean;
  completedDate?: string;
  notes?: string;
}

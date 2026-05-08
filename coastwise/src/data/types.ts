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

export type Region = 'sf' | 'north-bay' | 'east-bay' | 'south-bay' | 'peninsula' | 'central-coast' | 'norcal' | 'socal' | 'oregon' | 'washington';

export interface Activity {
  id: string;
  name: string;
  shortDescription: string;
  longDescription?: string;
  category: Category;
  region: Region;
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
  completed?: boolean;
  completedDate?: string;
  notes?: string;
}

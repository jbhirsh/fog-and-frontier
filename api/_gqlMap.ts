import type {
  Trip,
  TripActivity,
  TripInvite,
  TripListItem,
  TripMember,
  TripVote,
} from './_trips.js';

// Files in api/ that start with `_` are not exposed as routes by Vercel.
//
// Boundary mappers: DB snake_case domain objects → GraphQL camelCase shapes
// (schema decision #1). DateTimeISO timestamps are passed as raw epoch-ms
// numbers — the DateTimeISO scalar serializes a number straight to ISO. Date
// fields (startDate/endDate) are passed as the DB 'YYYY-MM-DD' strings (the
// Date scalar passes a valid date-string through). LocalTime (startTime) is a
// string passthrough.

// --- snapshot null-coercion ------------------------------------------------
// The trip's frozen ActivitySnapshot is all-nullable and must never 500 the
// `trip` query (schema decision #2 / B2). We sanitize each field: a value that
// doesn't fit the shape becomes null rather than letting graphql throw at
// serialization (which an out-of-range enum or malformed nested object would).

const CATEGORIES = new Set([
  'hiking', 'cycling', 'water', 'food', 'culture',
  'scenic', 'climbing', 'camping', 'other',
]);
const DIFFICULTIES = new Set(['easy', 'moderate', 'advanced']);
const PARK_TYPES = new Set([
  'national', 'state', 'regional', 'county', 'city', 'private', 'none',
]);

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function isoDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function enumVal(v: unknown, set: ReadonlySet<string>): string | null {
  return typeof v === 'string' && set.has(v) ? v : null;
}
function strArray(v: unknown): string[] | null {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : null;
}

type LocationShape = { city: string; coords: { lat: number; lng: number } };

// Location/Coords are non-null *within* the object (city: String!, lat/lng:
// Float!), so an invalid location collapses the whole nested object to null —
// graphql then sees a valid Location or null, never a half-built one.
function location(v: unknown): LocationShape | null {
  if (!v || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  const city = str(obj.city);
  if (city === null) return null;
  const coordsRaw = obj.coords;
  if (!coordsRaw || typeof coordsRaw !== 'object') return null;
  const coords = coordsRaw as Record<string, unknown>;
  const lat = num(coords.lat);
  const lng = num(coords.lng);
  if (lat === null || lng === null) return null;
  return { city, coords: { lat, lng } };
}

export type SnapshotShape = {
  id: string | null;
  name: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  category: string | null;
  region: string | null;
  parkType: string | null;
  location: LocationShape | null;
  duration: string | null;
  durationDetail: string | null;
  difficulty: string | null;
  dogFriendly: boolean | null;
  coverImage: string | null;
  galleryImages: string[] | null;
  allTrailsUrl: string | null;
  allTrailsRating: number | null;
  hikeDistanceMiles: number | null;
  hikeElevationFeet: number | null;
  cuisine: string | null;
  priceRange: string | null;
  hours: string | null;
  reservationUrl: string | null;
  menuUrl: string | null;
  dietary: string[] | null;
  completed: boolean | null;
  completedDate: string | null;
  notes: string | null;
};

export function coerceSnapshot(raw: unknown): SnapshotShape | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    id: str(r.id),
    name: str(r.name),
    shortDescription: str(r.shortDescription),
    longDescription: str(r.longDescription),
    category: enumVal(r.category, CATEGORIES),
    region: str(r.region),
    parkType: enumVal(r.parkType, PARK_TYPES),
    location: location(r.location),
    duration: str(r.duration),
    durationDetail: str(r.durationDetail),
    difficulty: enumVal(r.difficulty, DIFFICULTIES),
    dogFriendly: bool(r.dogFriendly),
    coverImage: str(r.coverImage),
    galleryImages: strArray(r.galleryImages),
    allTrailsUrl: str(r.allTrailsUrl),
    allTrailsRating: num(r.allTrailsRating),
    hikeDistanceMiles: num(r.hikeDistanceMiles),
    hikeElevationFeet: num(r.hikeElevationFeet),
    cuisine: str(r.cuisine),
    priceRange: str(r.priceRange),
    hours: str(r.hours),
    reservationUrl: str(r.reservationUrl),
    menuUrl: str(r.menuUrl),
    dietary: strArray(r.dietary),
    completed: bool(r.completed),
    completedDate: isoDate(r.completedDate),
    notes: str(r.notes),
  };
}

// --- input-side date conversion --------------------------------------------
// The graphql `Date` scalar's parseValue turns a 'YYYY-MM-DD' input into a JS
// Date object (UTC midnight), so a resolver receiving a Date-typed input field
// must convert it back to the 'YYYY-MM-DD' string we persist. `undefined`
// (field absent) and `null` (explicit clear) are passed through unchanged so
// the absent-vs-null semantics in patchTrip survive the round trip.
export function dateToIso(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v;
  return null;
}

// --- catalog activity ------------------------------------------------------
// Catalog rows are stored as camelCase JSON (the client Activity model) and are
// "strictly typed" (audit: 59/59 clean), so we pass the parsed object through
// and let graphql pick the schema fields. We only ensure `id` (from the row
// column) and validate `completedDate` to a real 'YYYY-MM-DD' so the public
// `activities` query can't be 500'd by a stray date string.
export function mapCatalogActivity(
  parsed: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  return {
    ...parsed,
    id: typeof parsed.id === 'string' ? parsed.id : id,
    // parkType is an enum; coerce an out-of-range value to null so the public
    // `activities` query can't be 500'd by a stray park designation.
    parkType: enumVal(parsed.parkType, PARK_TYPES),
    completedDate: isoDate(parsed.completedDate),
  };
}

// --- trip family -----------------------------------------------------------

export function mapTripActivity(a: TripActivity) {
  return {
    id: a.id,
    tripId: a.trip_id,
    activityId: a.activity_id,
    addedByEmail: a.added_by_email,
    addedAt: a.added_at,
    dayIndex: a.day_index,
    startTime: a.start_time,
    displayOrder: a.display_order,
    snapshot: coerceSnapshot(a.snapshot),
  };
}

export function mapTripMember(m: TripMember) {
  return {
    email: m.email,
    displayName: m.display_name,
    addedByEmail: m.added_by_email,
    addedAt: m.added_at,
    isCreator: m.is_creator,
  };
}

export function mapTripInvite(i: TripInvite) {
  return {
    inviteToken: i.invite_token,
    invitedEmail: i.invited_email,
    invitedByEmail: i.invited_by_email,
    invitedAt: i.invited_at,
  };
}

export function mapTripVote(v: TripVote) {
  return {
    tripActivityId: v.trip_activity_id,
    memberEmail: v.member_email,
    value: v.value,
  };
}

export function mapTrip(t: Trip) {
  return {
    id: t.id,
    creatorEmail: t.creator_email,
    title: t.title,
    description: t.description,
    startDate: t.start_date,
    endDate: t.end_date,
    coverImageUrl: t.cover_image_url,
    status: t.status,
    createdAt: t.created_at,
    markedPastAt: t.marked_past_at,
    activities: t.activities.map(mapTripActivity),
    members: t.members.map(mapTripMember),
    invites: t.invites.map(mapTripInvite),
    votes: t.votes.map(mapTripVote),
  };
}

export function mapTripListItem(t: TripListItem) {
  return {
    id: t.id,
    creatorEmail: t.creator_email,
    title: t.title,
    description: t.description,
    startDate: t.start_date,
    endDate: t.end_date,
    coverImageUrl: t.cover_image_url,
    status: t.status,
    createdAt: t.created_at,
    markedPastAt: t.marked_past_at,
    scheduledCount: t.scheduled_count,
    unscheduledCount: t.unscheduled_count,
  };
}

// Cover-image lookup for a generated activity (issue #36): a location-aware
// Wikimedia Commons search, replacing the old first-hit Wikipedia thumbnail
// that put a mountain lake on a San Jose restaurant.
//
// Why Commons (owner decision on #36): free, keyless, and freely licensed, so
// the URL can be stored on the activity permanently, as long as we keep an
// attribution line (author + license). Google Places photos can't be stored.
//
// Flow, all best-effort (any failure → null, never a throw):
//   1. Commons `list=geosearch` in the File namespace around the activity's
//      lat/lng, with a radius that depends on the category (see
//      searchRadiusMeters). Candidates are filtered by title (no maps, logos,
//      SVGs, …) and ranked by name match + distance (rankCommonsCandidates).
//   2. `prop=imageinfo` for the best candidates: the first raster image big
//      enough for the hero wins, served as its 1280px thumbnail.
//   3. Fallback: the Wikipedia page image of an article that both matches the
//      name and sits within WIKIPEDIA_MAX_M of the activity. The file is then
//      resolved on Commons like step 2, which also drops non-free local files.
//   4. Nothing → null, and the UI renders the category placeholder. A wrong
//      image is worse than none.
//
// Issue #120's backfill of the existing catalog can reuse findCoverImage.

export type CoverPlace = {
  name: string;
  category: string;
  lat: number;
  lng: number;
};

export type CoverImage = { url: string; credit: string };

export type GeoCandidate = { title: string; dist: number };

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

// Wikimedia asks API clients to identify themselves with a descriptive agent
// and a contact URL (https://meta.wikimedia.org/wiki/User-Agent_policy).
// Api-User-Agent is the header their docs give for clients that can't set
// User-Agent; we send both.
export const USER_AGENT =
  'FogAndFrontier/1.0 (https://github.com/jbhirsh/fog-and-frontier)';
export const WIKIMEDIA_HEADERS = {
  'User-Agent': USER_AGENT,
  'Api-User-Agent': USER_AGENT,
};

// The whole lookup (up to four requests) shares one deadline, so a slow
// Wikimedia never holds up generateActivity for long.
export const DEFAULT_TIMEOUT_MS = 5000;

// Search radius by category. Trailheads, parks, beaches and viewpoints sprawl,
// and the model's coordinates may be the trailhead rather than the feature, so
// outdoor categories search wider. A restaurant or museum is one building:
// anything a few hundred metres away is a different place.
const OUTDOOR_RADIUS_M = 1500;
const RADIUS_BY_CATEGORY: Record<string, number> = {
  hiking: OUTDOOR_RADIUS_M,
  camping: OUTDOOR_RADIUS_M,
  climbing: OUTDOOR_RADIUS_M,
  scenic: OUTDOOR_RADIUS_M,
  water: OUTDOOR_RADIUS_M,
  cycling: OUTDOOR_RADIUS_M,
  food: 300,
  culture: 500,
};
const DEFAULT_RADIUS_M = 750;

export function searchRadiusMeters(category: string): number {
  return RADIUS_BY_CATEGORY[category] ?? DEFAULT_RADIUS_M;
}

// A photo whose title doesn't mention the activity is accepted only for
// outdoor categories and only this close: near a trailhead or viewpoint, any
// landscape photo is plausibly of the place; near a restaurant it's the
// building next door.
export const UNMATCHED_MAX_M = 400;

// Wikipedia fallback: the article must sit this close to the activity.
export const WIKIPEDIA_MAX_M = 2000;
// …and its title must contain at least this share of the name's tokens.
export const WIKIPEDIA_MIN_MATCH = 0.5;

// How many ranked Commons candidates get an imageinfo lookup.
const MAX_CANDIDATES = 10;

// Hero renders at up to ~1280px wide; smaller originals look soft.
export const MIN_WIDTH = 800;
export const MIN_HEIGHT = 450;
const THUMB_WIDTH = 1280;

const RASTER_MIMES: ReadonlySet<unknown> = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RASTER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

// Title words that mark a file as something other than a photo of the place.
const UNWANTED_WORDS = new Set([
  'map', 'maps', 'logo', 'logos', 'icon', 'icons', 'diagram', 'svg',
  'signature', 'flag', 'locator', 'chart', 'emblem',
]);
const UNWANTED_PHRASES = ['coat of arms', 'floor plan'];

// Words that carry no identity: matching "park" or "state" alone says nothing
// about whether a photo shows *this* park.
const GENERIC_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'de', 'del', 'for', 'in', 'of', 'on', 'or',
  'the', 'to', 'area', 'county', 'hike', 'hiking', 'loop', 'national', 'open',
  'park', 'preserve', 'regional', 'reserve', 'space', 'state', 'trail',
  'trails', 'walk',
]);

// --- pure helpers ----------------------------------------------------------

// The cover is rendered as an <img src>: accept only an https URL.
export function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    return new URL(v).protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}

function words(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
}

// Plural-insensitive token ("falls" ~ "fall", "redwoods" ~ "redwood"), kept
// short words intact ("bus", "gas").
function stem(w: string): string {
  return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
}

// Identity-bearing tokens of an activity name: lowercased, accent-folded,
// single letters and generic words dropped. A name made only of generic words
// keeps them, so it can still match something.
export function nameTokens(name: string): string[] {
  const all = words(name).filter((w) => w.length > 1);
  const specific = all.filter((w) => !GENERIC_WORDS.has(w));
  return [...new Set((specific.length > 0 ? specific : all).map(stem))];
}

// Share (0–1) of the name's tokens that appear in the title. The title's
// "File:" prefix and extension are just two more words; they never match an
// activity name.
export function nameMatchScore(name: string, title: string): number {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return 0;
  const inTitle = new Set(words(title).map(stem));
  const hits = tokens.filter((t) => inTitle.has(t)).length;
  return hits / tokens.length;
}

// No dot → the whole title, which is never a raster extension.
function extension(title: string): string {
  return title.slice(title.lastIndexOf('.') + 1).toLowerCase();
}

// True for a file that isn't a raster photo or reads like a map/logo/diagram.
export function isUnwantedTitle(title: string): boolean {
  if (!RASTER_EXTENSIONS.has(extension(title))) return true;
  const titleWords = words(title);
  // Space-padded so a phrase only matches whole words.
  const text = ` ${titleWords.join(' ')} `;
  return (
    UNWANTED_PHRASES.some((p) => text.includes(` ${p} `)) ||
    titleWords.some((w) => UNWANTED_WORDS.has(w))
  );
}

const OUTDOOR = new Set(Object.keys(RADIUS_BY_CATEGORY).filter(
  (c) => RADIUS_BY_CATEGORY[c] === OUTDOOR_RADIUS_M,
));

// Filter and order Commons geosearch hits, best first. Score = name match
// (0–1, weighted ×2 so any real match beats a merely close photo) plus
// closeness (1 at the point, 0 at the radius edge).
export function rankCommonsCandidates(
  place: Pick<CoverPlace, 'name' | 'category'>,
  candidates: GeoCandidate[],
): GeoCandidate[] {
  const radius = searchRadiusMeters(place.category);
  const outdoor = OUTDOOR.has(place.category);
  return candidates
    .filter((c) => !isUnwantedTitle(c.title) && c.dist <= radius)
    .map((c) => ({ c, match: nameMatchScore(place.name, c.title) }))
    .filter(({ c, match }) => match > 0 || (outdoor && c.dist <= UNMATCHED_MAX_M))
    .map(({ c, match }) => ({ c, score: match * 2 + (1 - c.dist / radius) }))
    .sort((a, b) => b.score - a.score)
    .map(({ c }) => c);
}

// Great-circle distance in metres.
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

// extmetadata values are HTML ("<a href=…>Jane Doe</a>"); keep the text.
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_m, e: string) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_ARTIST_CHARS = 80;

// "Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons" — author, license
// and source, as Commons' reuse guidance asks; author or license may be
// missing from the file's metadata, and is then left out.
export function formatCredit(artist: unknown, license: unknown): string {
  const who = typeof artist === 'string' ? stripHtml(artist) : '';
  const lic = typeof license === 'string' ? stripHtml(license) : '';
  const author =
    who.length > MAX_ARTIST_CHARS ? `${who.slice(0, MAX_ARTIST_CHARS - 1)}…` : who;
  const parts = [author, lic, 'via Wikimedia Commons'].filter(Boolean);
  return `Photo: ${parts.join(', ')}`;
}

type ExtMeta = Record<string, { value?: unknown } | undefined>;

export type ImageInfo = {
  url?: unknown;
  thumburl?: unknown;
  width?: unknown;
  height?: unknown;
  mime?: unknown;
  extmetadata?: ExtMeta;
};

function size(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

// An imageinfo entry → cover, or null if it isn't a large-enough raster image
// with an https URL.
export function pickImage(info: ImageInfo | undefined): CoverImage | null {
  if (!info) return null;
  if (!RASTER_MIMES.has(info.mime)) return null;
  if (size(info.width) < MIN_WIDTH || size(info.height) < MIN_HEIGHT) return null;
  const url = httpsUrl(info.thumburl ?? info.url);
  if (!url) return null;
  const meta = info.extmetadata ?? {};
  return {
    url,
    credit: formatCredit(meta.Artist?.value, meta.LicenseShortName?.value),
  };
}

// --- fetch flow ------------------------------------------------------------

async function getJson(
  base: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const r = await fetch(`${base}?${qs.toString()}`, {
    headers: WIKIMEDIA_HEADERS,
    signal,
  });
  if (!r.ok) throw new Error(`wikimedia ${r.status}`);
  return r.json();
}

type QueryResponse<T> = { query?: T };

async function commonsGeosearch(
  place: CoverPlace,
  signal: AbortSignal,
): Promise<GeoCandidate[]> {
  const data = (await getJson(
    COMMONS_API,
    {
      action: 'query',
      list: 'geosearch',
      gscoord: `${place.lat}|${place.lng}`,
      gsradius: String(searchRadiusMeters(place.category)),
      gsnamespace: '6',
      gslimit: '50',
    },
    signal,
  )) as QueryResponse<{ geosearch?: { title?: unknown; dist?: unknown }[] }>;
  return (data.query?.geosearch ?? []).flatMap((g) =>
    typeof g.title === 'string' && typeof g.dist === 'number'
      ? [{ title: g.title, dist: g.dist }]
      : [],
  );
}

// Resolve file titles on Commons and return the first usable one, in the
// order given.
async function firstUsableImage(
  titles: string[],
  signal: AbortSignal,
): Promise<CoverImage | null> {
  if (titles.length === 0) return null;
  const data = (await getJson(
    COMMONS_API,
    {
      action: 'query',
      prop: 'imageinfo',
      titles: titles.join('|'),
      iiprop: 'url|extmetadata|mime|size',
      iiurlwidth: String(THUMB_WIDTH),
      iiextmetadatafilter: 'Artist|LicenseShortName',
    },
    signal,
  )) as QueryResponse<{ pages?: { title?: unknown; imageinfo?: ImageInfo[] }[] }>;
  const byTitle = new Map<unknown, ImageInfo | undefined>(
    (data.query?.pages ?? []).map((p) => [p.title, p.imageinfo?.[0]]),
  );
  for (const title of titles) {
    const image = pickImage(byTitle.get(title));
    if (image) return image;
  }
  return null;
}

type WikiPage = {
  title?: unknown;
  index?: unknown;
  pageimage?: unknown;
  coordinates?: { lat?: unknown; lon?: unknown }[];
};

// Page-image file titles of Wikipedia articles that match the name and sit
// near the activity, in search-rank order.
export function nearbyPageImages(place: CoverPlace, pages: WikiPage[]): string[] {
  return [...pages]
    .sort((a, b) => size(a.index) - size(b.index))
    .flatMap((p) => {
      const coord = p.coordinates?.[0];
      if (
        typeof p.title !== 'string' ||
        typeof p.pageimage !== 'string' ||
        typeof coord?.lat !== 'number' ||
        typeof coord.lon !== 'number'
      ) {
        return [];
      }
      // Whole metres: the cutoff is a rule of thumb, not a survey line.
      const dist = Math.round(haversineMeters(place, { lat: coord.lat, lng: coord.lon }));
      if (dist > WIKIPEDIA_MAX_M) return [];
      if (nameMatchScore(place.name, p.title) < WIKIPEDIA_MIN_MATCH) return [];
      const file = `File:${p.pageimage.replace(/_/g, ' ')}`;
      return isUnwantedTitle(file) ? [] : [file];
    });
}

async function wikipediaFallback(
  place: CoverPlace,
  signal: AbortSignal,
): Promise<CoverImage | null> {
  const data = (await getJson(
    WIKIPEDIA_API,
    {
      action: 'query',
      generator: 'search',
      gsrsearch: place.name,
      gsrlimit: '5',
      prop: 'pageimages|coordinates',
      piprop: 'name',
      pilicense: 'free',
    },
    signal,
  )) as QueryResponse<{ pages?: WikiPage[] }>;
  return firstUsableImage(nearbyPageImages(place, data.query?.pages ?? []), signal);
}

export async function findCoverImage(
  place: CoverPlace,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<CoverImage | null> {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const ranked = rankCommonsCandidates(
      place,
      await commonsGeosearch(place, controller.signal),
    );
    const titles = ranked.slice(0, MAX_CANDIDATES).map((c) => c.title);
    return (
      (await firstUsableImage(titles, controller.signal)) ??
      (await wikipediaFallback(place, controller.signal))
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

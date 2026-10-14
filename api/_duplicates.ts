// Duplicate detection for new catalog activities (#17): does a name and
// pin look like one already saved? Pure, so the resolver and its tests share
// it. Two tiers, from the issue:
//   high:     the same name (normalized) within 500 m;
//   possible: names sharing at least 60% of their words within 2 km, or the
//             same name at any distance.
// A high match blocks a save until the owner says it's different (two
// "Castle Rock" trailheads); a possible one is only a warning.

export type DuplicateConfidence = 'high' | 'possible';

export interface CatalogPlace {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}

export interface DuplicateMatch {
  id: string;
  name: string;
  city: string;
  distanceMeters: number;
  confidence: DuplicateConfidence;
}

const HIGH_METERS = 500;
const POSSIBLE_METERS = 2000;
const POSSIBLE_OVERLAP = 0.6;

// Words that say nothing about which place it is.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'de', 'el', 'for', 'in', 'la', 'of', 'on', 'the', 'to',
]);

// Letters NFKD doesn't split into a base letter and an accent.
const FOLDED: Record<string, string> = {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', þ: 'th',
};

/**
 * The words that name a place: lower-cased, accents folded, apostrophes
 * dropped ("Sam's" is "sams"), "&" read as "and", other punctuation a break,
 * and stopwords ("the", "of", …) left out. A name with no Latin letters has
 * no words, and so matches nothing.
 */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[ßæœøłđþ]/g, (c) => FOLDED[c])
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]/)
    .filter((w) => w !== '' && !STOPWORDS.has(w));
}

/** The name as one comparable string: its words, space-separated. */
export function normalizeName(name: string): string {
  return nameWords(name).join(' ');
}

/** Shared words over all words (Jaccard) of two names' words; 0 for none. */
export function wordOverlap(a: readonly string[], b: readonly string[]): number {
  const x = new Set(a);
  const y = new Set(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  const all = new Set([...x, ...y]).size;
  return all === 0 ? 0 : shared / all;
}

/** Great-circle distance in metres. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** The saved places that look like `candidate`, high-confidence first, then nearest. */
export function findDuplicates(
  candidate: { name: string; lat: number; lng: number },
  catalog: readonly CatalogPlace[],
): DuplicateMatch[] {
  const words = nameWords(candidate.name);
  const name = words.join(' ');
  const matches: DuplicateMatch[] = [];
  for (const place of catalog) {
    const meters = distanceMeters(candidate, place);
    const theirWords = nameWords(place.name);
    const same = name !== '' && theirWords.join(' ') === name;
    const confidence: DuplicateConfidence | null =
      same && meters < HIGH_METERS
        ? 'high'
        : same || (meters < POSSIBLE_METERS && wordOverlap(words, theirWords) >= POSSIBLE_OVERLAP)
          ? 'possible'
          : null;
    if (confidence) {
      matches.push({
        id: place.id,
        name: place.name,
        city: place.city,
        distanceMeters: Math.round(meters),
        confidence,
      });
    }
  }
  return matches.sort(
    (x, y) =>
      Number(y.confidence === 'high') - Number(x.confidence === 'high') ||
      x.distanceMeters - y.distanceMeters,
  );
}

/**
 * An id for a new activity that won't save over another: `id`, or the first
 * of `id-2`, `id-3`, … that `isTaken` says is free.
 */
export async function freeId(
  id: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  let candidate = id;
  for (let n = 2; await isTaken(candidate); n += 1) candidate = `${id}-${n}`;
  return candidate;
}

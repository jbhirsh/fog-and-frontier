// A park's hikes and stops (#269): an activity may name the activity it's
// part of, `parentId`. One level only, so a park's card can hold its
// sub-items without any of them holding more. The rules live here, checked
// on every save, since the client's picker is only a hint.

import { db } from './_db.js';
import { distanceMeters, nameWords, wordOverlap } from './_duplicates.js';
import { badInput } from './_gqlError.js';

/** The parent a stored activity's JSON names, or null. */
export function parentIdOf(j: unknown): string | null {
  // Anything but stored JSON naming one (no row, not JSON, null) throws here.
  try {
    const { parentId } = JSON.parse(j as string) as { parentId?: unknown };
    return typeof parentId === 'string' && parentId ? parentId : null;
  } catch {
    return null;
  }
}

/** Whether any activity names `id` as its parent. */
export async function hasSubItems(id: string): Promise<boolean> {
  const rs = await db().execute({
    sql: "SELECT 1 FROM a WHERE json_extract(j, '$.parentId') = ? LIMIT 1",
    args: [id],
  });
  return rs.rows.length > 0;
}

/**
 * Checks the parent an activity is saved under. `id` is the activity's own
 * id, or null for a new one (which has no sub-items yet). No parent is
 * always fine; a parent must be another saved activity that isn't part of
 * anything itself, and an activity with sub-items of its own can't be given
 * one.
 */
export async function checkParent(id: string | null, parentId: unknown): Promise<void> {
  if (parentId == null) return;
  if (typeof parentId !== 'string' || !parentId) throw badInput('parentId must be an activity id');
  if (parentId === id) throw badInput("an activity can't be part of itself");
  const rs = await db().execute({ sql: 'SELECT j FROM a WHERE id = ?', args: [parentId] });
  const parent = rs.rows[0];
  if (!parent) throw badInput("parentId doesn't name a saved activity");
  if (parentIdOf(parent.j))
    throw badInput('that activity is part of another; pick the one it belongs to');
  if (id && (await hasSubItems(id))) {
    throw badInput('this activity has hikes and stops of its own, so it can’t be part of another');
  }
}

/** Leaves a deleted activity's sub-items standalone: one statement for its delete batch. */
export function releaseSubItems(id: string): { sql: string; args: string[] } {
  return {
    sql: "UPDATE a SET j = json_remove(j, '$.parentId') WHERE json_extract(j, '$.parentId') = ?",
    args: [id],
  };
}

/** How far a draft may be from the park it's matched to: parks are large. */
export const PARENT_RADIUS_METERS = 120_000;
/** Below this share of words, a park's name isn't the one a draft gave. */
const PARENT_NAME_OVERLAP = 0.6;

export interface ParentCandidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  parentId?: string | null;
}

// Where a run-on answer leaves the name: a quote, a line break, a run of
// spaces, or one of the draft's other fields by name, then a colon.
const RUN_ON =
  /["\n\r\t]|\s{2,}|\s(?:name|shortDescription|longDescription|category|region|parkType|city|lat|lng|duration|durationDetail|difficulty|dogFriendly|hikeDistanceMiles|hikeElevationFeet|cuisine|priceRange|costTier|hours|reservationUrl|menuUrl|dietary|allTrailsUrl|notes|partOf)\s*:/;

// The places in a list ("Golden Gate National Recreation Area, Presidio of
// San Francisco"): split at a comma or semicolon outside brackets, so one
// inside a name's own aside ("… (Marin Headlands, Fort Baker)") stays.
function listedPlaces(text: string): string[] {
  const places: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if ((c === ',' || c === ';') && depth === 0) {
      places.push(text.slice(from, i));
      from = i + 1;
    }
  }
  places.push(text.slice(from));
  return places;
}

/**
 * Every park name Gemini gave (`partOf`), in its order; none for no answer.
 * An answer can run on past the name into the fields that follow ("Point
 * Reyes National Seashore allTrailsUrl: …"), so it's cut at the first sign
 * of that: a quote, a line break, a run of spaces, or one of the draft's own
 * field names and a colon. A colon of the name's own ("Santa Cruz
 * Mountains: Big Basin") stays. One park is asked for, but a list of them is
 * split into its places, quotes trimmed from each.
 */
export function parkNames(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  // A name Gemini quoted is still the name.
  const [text = ''] = value
    .trim()
    .replace(/^["'“‘]+/, '')
    .split(RUN_ON);
  return listedPlaces(text)
    .map((place) =>
      place
        .trim()
        .replace(/^["'“‘]+/, '')
        .replace(/["'”’]+$/, '')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * The park name to show on the draft: the first Gemini gave, or null. Its
 * others still count when matching a saved park (`matchParent`).
 */
export function parkName(value: unknown): string | null {
  return parkNames(value)[0] ?? null;
}

// What a name says it's in, at or of: "Bouldering at Castle Rock State
// Park" is at Castle Rock State Park. Nothing for a name that says none.
function placeIn(name: string): string {
  return /\b(?:at|in|of|inside|within)\s+(?:the\s+)?(.+)$/i.exec(name)?.[1] ?? '';
}

/**
 * The saved park a drafted activity is part of (#269), from the park's name
 * as Gemini gave it (`partOf`): a catalog activity with that name, most
 * of its words, or a name it holds whole, within reach of the draft's pin, that isn't part of anything
 * itself. The closest name wins, then the nearest. A draft that is the park
 * itself has no parent. With no park named, a saved park its own name
 * places it in, whole ("Bouldering at Castle Rock State Park"), is still
 * its park; one its name merely holds ("Muir Woods Trading Company") isn't.
 */
export function matchParent(
  draft: { name: string; lat: number; lng: number; partOf?: unknown },
  catalog: readonly ParentCandidate[],
): string | null {
  const own = nameWords(draft.name).join(' ');
  const listed = parkNames(draft.partOf);
  // A place named that is the draft itself isn't its park; a draft whose
  // only named place is itself is the park, with no parent.
  const named = listed.map(nameWords).filter((words) => words.join(' ') !== own);
  if (listed.length > 0 && named.length === 0) return null;
  const lists = named.length > 0 ? named : [nameWords(placeIn(draft.name))];
  let best: { id: string; overlap: number; meters: number } | null = null;
  for (const place of catalog) {
    if (place.parentId) continue;
    const theirs = nameWords(place.name);
    if (theirs.join(' ') === own) continue;
    let overlap = 0;
    for (const words of lists) {
      // A saved name of two words or more that Gemini's holds whole ("Muir
      // Woods" in "Muir Woods National Monument") is a match too, though
      // ranked below a closer name. Held whole is the only match for a park
      // the draft's own name places it in.
      const held = theirs.length >= 2 && theirs.every((w) => words.includes(w));
      const shared = named.length === 0 ? 0 : wordOverlap(words, theirs);
      overlap = Math.max(overlap, held ? Math.max(shared, PARENT_NAME_OVERLAP) : shared);
    }
    if (overlap < PARENT_NAME_OVERLAP) continue;
    const meters = distanceMeters(draft, place);
    if (meters > PARENT_RADIUS_METERS) continue;
    if (!best || overlap > best.overlap || (overlap === best.overlap && meters < best.meters)) {
      best = { id: place.id, overlap, meters };
    }
  }
  return best?.id ?? null;
}

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

/**
 * The saved park a drafted activity is part of (#269), from the park's name
 * as Gemini gave it (`partOf`): a catalog activity with that name, most
 * of its words, or a name it holds whole, within reach of the draft's pin, that isn't part of anything
 * itself. The closest name wins, then the nearest. A draft that is the park
 * itself has no parent.
 */
export function matchParent(
  draft: { name: string; lat: number; lng: number; partOf?: unknown },
  catalog: readonly ParentCandidate[],
): string | null {
  if (typeof draft.partOf !== 'string') return null;
  const words = nameWords(draft.partOf);
  const own = nameWords(draft.name).join(' ');
  if (words.join(' ') === own) return null;
  let best: { id: string; overlap: number; meters: number } | null = null;
  for (const place of catalog) {
    if (place.parentId) continue;
    const theirs = nameWords(place.name);
    if (theirs.join(' ') === own) continue;
    // A saved name of two words or more that Gemini's holds whole ("Muir
    // Woods" in "Muir Woods National Monument") is a match too, though
    // ranked below a closer name.
    const held = theirs.length >= 2 && theirs.every((w) => words.includes(w));
    const shared = wordOverlap(words, theirs);
    const overlap = held ? Math.max(shared, PARENT_NAME_OVERLAP) : shared;
    if (overlap < PARENT_NAME_OVERLAP) continue;
    const meters = distanceMeters(draft, place);
    if (meters > PARENT_RADIUS_METERS) continue;
    if (!best || overlap > best.overlap || (overlap === best.overlap && meters < best.meters)) {
      best = { id: place.id, overlap, meters };
    }
  }
  return best?.id ?? null;
}

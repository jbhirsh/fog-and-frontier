import { db } from '../_db.js';
import { badInput, conflict } from '../_gqlError.js';
import { findDuplicates, freeId, type CatalogPlace } from '../_duplicates.js';
import { COST_TIERS, dateToIso, mapCatalogActivity, parseCatalogActivity } from '../_gqlMap.js';
import { isSavableUrl } from '../_links.js';
import { logServerError } from '../_log.js';
import { checkParent, parentIdOf, releaseSubItems } from '../_parents.js';
import { requireOwnerCtx, type GqlContext } from '../_gqlContext.js';
import { forgetCatalog } from './driving.js';
import { deleteBlobs, deletePhotosOf, pathnamesFrom } from './photos.js';

// Catalog activities (`a` table) + completion overrides (`c` table). Reads are
// public; writes are owner-gated. Activities are stored as camelCase JSON, so
// reads parse and validate each row (parseCatalogActivity) and writes
// JSON.stringify the input.

function rowIdToString(id: unknown): string | null {
  if (typeof id === 'string') return id;
  if (typeof id === 'number') return id.toString();
  return null;
}

// A stored row the schema can't serve. Skipping it keeps one bad row from
// failing the whole public catalog; logging it (with the row id) is how the
// owner finds out it needs fixing.
function skipCatalogRow(id: string, reason: string): void {
  logServerError(new Error(`skipped invalid catalog row: ${reason}`), {
    route: '/api/graphql',
    detail: `activities: row id ${id}`,
  });
}

// The parsed catalog, newest first; also what trip suggestions rank (#78).
export async function catalogActivities() {
  const rs = await db().execute('SELECT id, j FROM a ORDER BY t DESC');
  const out: Record<string, unknown>[] = [];
  for (const row of rs.rows) {
    const id = rowIdToString(row.id);
    if (!id) continue;
    const j = row.j;
    if (typeof j !== 'string') {
      skipCatalogRow(id, 'no JSON');
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(j);
    } catch {
      skipCatalogRow(id, 'malformed JSON');
      continue;
    }
    const result = parseCatalogActivity(parsed, id);
    if (!result.ok) {
      skipCatalogRow(id, `invalid ${result.invalid.join(', ')}`);
      continue;
    }
    out.push(result.activity);
  }
  return out;
}

async function completed() {
  const rs = await db().execute('SELECT id, v FROM c');
  const out: { id: string; completed: boolean }[] = [];
  for (const row of rs.rows) {
    const id = rowIdToString(row.id);
    if (!id) continue;
    out.push({ id, completed: Number(row.v) === 1 });
  }
  return out;
}

/** The most a stored activity's JSON may hold. */
export const MAX_ACTIVITY_JSON = 8000;

export type ActivityInput = Record<string, unknown> & {
  completedDate?: unknown;
  contributors?: string[] | null;
};

// Build the persisted catalog JSON from a SaveActivityInput. The input lacks
// `id` (it's a sibling field), so we splice it in; `completedDate` arrives as a
// Date object from the Date scalar and is normalized back to 'YYYY-MM-DD'. An
// absent completedDate stays absent: dateToIso(undefined) is undefined, which
// JSON.stringify drops. `contributors` is the list resolveContributors settled
// (undefined, likewise dropped, for an activity left uncredited).
export function buildStoredActivity(
  id: string,
  activity: ActivityInput,
  contributors: string[] | undefined,
): Record<string, unknown> {
  return {
    id,
    ...activity,
    contributors,
    completedDate: dateToIso(activity.completedDate),
  };
}

// Enough for a few people who suggested the same place together.
const MAX_CONTRIBUTORS = 10;

// The list stored on a row. Anything unreadable (no row, malformed JSON, a
// non-object) counts as no list.
function storedContributors(j: unknown): string[] {
  try {
    const list = (JSON.parse(String(j)) as { contributors?: unknown }).contributors;
    return Array.isArray(list)
      ? list.filter((e: unknown): e is string => typeof e === 'string')
      : [];
  } catch {
    return [];
  }
}

// Who to credit for an activity (#9). An omitted list credits the caller on
// a new activity and keeps an existing one's list. An existing activity with
// no list (saved before #9) stays uncredited (undefined) for the backfill to
// credit, rather than crediting whoever happens to edit it first. A given
// list must name at least one person; any it adds to the stored list must
// be an account in `users`, so the contributor filter works on real
// identities rather than free text. Names already credited aren't checked
// again, so an edit never fails on a list it didn't change.
async function resolveContributors(
  row: Record<string, unknown> | undefined,
  given: string[] | null | undefined,
  callerEmail: string,
): Promise<string[] | undefined> {
  const stored = storedContributors(row?.j);
  if (given == null) {
    if (!row) return [callerEmail];
    return stored.length > 0 ? stored : undefined;
  }
  const emails = [...new Set(given.map((e) => e.trim().toLowerCase()))].filter((e) => e !== '');
  if (emails.length === 0) throw badInput('contributors must name at least one person');
  if (emails.length > MAX_CONTRIBUTORS) {
    throw badInput(`at most ${MAX_CONTRIBUTORS} contributors`);
  }
  const added = emails.filter((e) => !stored.includes(e));
  if (added.length > 0) {
    const known = await db().execute({
      sql: `SELECT email FROM users WHERE email IN (${added.map(() => '?').join(', ')})`,
      args: added,
    });
    const found = new Set(known.rows.map((r) => r.email));
    const unknown = added.filter((e) => !found.has(e));
    if (unknown.length > 0) throw badInput(`not a known account: ${unknown.join(', ')}`);
  }
  return emails;
}

// The catalog as places to match a new activity against (#17).
export async function catalogPlaces(): Promise<CatalogPlace[]> {
  return (await catalogActivities()).map((a) => {
    const location = a.location as { city: string; coords: { lat: number; lng: number } };
    return {
      id: a.id as string,
      name: a.name as string,
      city: location.city,
      ...location.coords,
    };
  });
}

// Public, like the catalog it reads: it says only which saved activities
// look like the given name and pin.
async function checkDuplicate(_parent: unknown, args: { name: string; lat: number; lng: number }) {
  if (args.name.length > 200) throw badInput('name too long');
  return findDuplicates(args, await catalogPlaces());
}

export async function rowById(id: string) {
  const rs = await db().execute({ sql: 'SELECT j FROM a WHERE id = ?', args: [id] });
  return rs.rows[0];
}

// What schema types can't check about an activity's input.
export function checkActivityInput(activity: ActivityInput): void {
  const costTier = activity.costTier;
  if (costTier != null && !COST_TIERS.has(costTier as string)) {
    throw badInput('costTier must be free, $, $$ or $$$');
  }
  // Shown as a link, so a web page or nothing.
  if (activity.sourceUrl != null && !isSavableUrl(activity.sourceUrl, null)) {
    throw badInput('sourceUrl must be a web address');
  }
}

/** Refuses a new activity with a high-confidence look-alike in the catalog (#17). */
export async function refuseDuplicate(activity: ActivityInput): Promise<void> {
  const location = activity.location as { coords: { lat: number; lng: number } };
  const same = findDuplicates(
    { name: activity.name as string, ...location.coords },
    await catalogPlaces(),
  ).find((m) => m.confidence === 'high');
  if (same) throw conflict(`looks like a duplicate of ${same.name}`, 'duplicate');
}

/** `id`, or the first `id-2`, `id-3`, … no catalog row has. */
export function freeCatalogId(id: string): Promise<string> {
  return freeId(id, async (candidate) => (await rowById(candidate)) !== undefined);
}

async function saveActivity(
  _parent: unknown,
  {
    input,
  }: {
    input: {
      id: string;
      activity: ActivityInput;
      create?: boolean | null;
      allowDuplicate?: boolean | null;
    };
  },
  ctx: GqlContext,
) {
  const caller = requireOwnerCtx(ctx);
  if (!input.id) throw badInput('missing id');
  checkActivityInput(input.activity);
  // The park it's part of (#269); a new activity has no sub-items yet.
  await checkParent(input.create ? null : input.id, input.activity.parentId);
  if (input.create) {
    // A new activity that looks like a saved one (#17) waits for the owner
    // to say it's different; the client checks first, so this is the
    // backstop. Then it takes a free id: a slug can be taken by a place
    // whose name no longer matches, and saving there would replace it.
    if (!input.allowDuplicate) await refuseDuplicate(input.activity);
    const contributors = await resolveContributors(
      undefined,
      input.activity.contributors,
      caller.email,
    );
    // The free-id check and the write aren't one step, so two creates of the
    // same name at once could both find the same id free. The insert never
    // replaces a row: if another create got there first, take the next id.
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const id = await freeCatalogId(input.id);
      const { stored, json } = storedJson(id, input.activity, contributors);
      const rs = await db().execute({
        sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
        args: [id, json, Date.now()],
      });
      if (rs.rowsAffected === 1) {
        forgetCatalog(); // road miles (#66) pick up a new pin
        return { activity: mapCatalogActivity(stored, id) };
      }
    }
    throw conflict('another activity took this id; try saving again');
  }
  const id = input.id;
  const row = await rowById(id);
  const contributors = await resolveContributors(row, input.activity.contributors, caller.email);
  // Like contributors, an edit that leaves the park out keeps the stored
  // one; null clears it.
  const activity =
    input.activity.parentId === undefined
      ? { ...input.activity, parentId: parentIdOf(row?.j) ?? undefined }
      : input.activity;
  const { stored, json } = storedJson(id, activity, contributors);
  await db().execute({
    sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET j = excluded.j, t = excluded.t',
    args: [id, json, Date.now()],
  });
  forgetCatalog(); // road miles (#66) pick up a moved pin
  return { activity: mapCatalogActivity(stored, id) };
}

// How many next-free ids a create tries before giving up (each is a race lost).
export const MAX_CREATE_ATTEMPTS = 3;

function storedJson(id: string, activity: ActivityInput, contributors: string[] | undefined) {
  const stored = buildStoredActivity(id, activity, contributors);
  const json = JSON.stringify(stored);
  if (json.length > MAX_ACTIVITY_JSON) throw badInput('activity too large');
  return { stored, json };
}

async function deleteActivity(
  _parent: unknown,
  { input }: { input: { id: string } },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const id = input.id;
  if (!id) throw badInput('missing id');
  // Owner reviews (#184) and photos (#19) live in their own tables, so they
  // need an explicit cascade — otherwise a deleted activity leaves rows behind
  // that no surface can reach, and a reused id would inherit them. One batch
  // so the catalog row and its side rows never diverge. The photos' blobs go
  // after it, and a failure there is logged rather than failing a delete that
  // already happened: it leaves only unlisted blobs, not a broken row. A
  // park's hikes and stops (#269) are left standalone in the same batch.
  const results = await db().batch(
    [
      { sql: 'DELETE FROM a WHERE id = ?', args: [id] },
      { sql: 'DELETE FROM activity_reviews WHERE activity_id = ?', args: [id] },
      deletePhotosOf(id),
      releaseSubItems(id),
    ],
    'write',
  );
  forgetCatalog();
  try {
    await deleteBlobs(pathnamesFrom(results[2]?.rows ?? []));
  } catch (err) {
    logServerError(err, {
      route: '/api/graphql',
      detail: `deleteActivity: photos of ${id} left in Blob`,
    });
  }
  return { deletedId: id };
}

async function setCompleted(
  _parent: unknown,
  { input }: { input: { id: string; value?: boolean | null } },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const id = input.id;
  if (!id) throw badInput('missing id');
  // value null/absent clears the override; true/false sets it.
  if (input.value == null) {
    await db().execute({ sql: 'DELETE FROM c WHERE id = ?', args: [id] });
    return { id, completed: null };
  }
  await db().execute({
    sql: 'INSERT INTO c (id, v) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET v = excluded.v',
    args: [id, input.value ? 1 : 0],
  });
  return { id, completed: input.value };
}

// Contributors are for signed-in eyes only (#9): the server drops them for a
// signed-out caller rather than trusting the client to hide them.
function contributorsField(
  parent: { contributors?: string[] | null },
  _args: unknown,
  ctx: GqlContext,
) {
  return ctx.caller ? (parent.contributors ?? null) : null;
}

export const activityFields = { contributors: contributorsField };

export const catalogQuery = { activities: catalogActivities, completed, checkDuplicate };
export const catalogMutation = { saveActivity, deleteActivity, setCompleted };

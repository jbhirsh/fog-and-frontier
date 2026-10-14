import { db } from '../_db.js';
import { badInput } from '../_gqlError.js';
import {
  dateToIso,
  mapCatalogActivity,
  parseCatalogActivity,
} from '../_gqlMap.js';
import { logServerError } from '../_log.js';
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

async function activities() {
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

type ActivityInput = Record<string, unknown> & {
  completedDate?: unknown;
  contributors?: string[] | null;
};

// Build the persisted catalog JSON from a SaveActivityInput. The input lacks
// `id` (it's a sibling field), so we splice it in; `completedDate` arrives as a
// Date object from the Date scalar and is normalized back to 'YYYY-MM-DD'. An
// absent completedDate stays absent: dateToIso(undefined) is undefined, which
// JSON.stringify drops. `contributors` is the list resolveContributors settled
// (undefined, likewise dropped, for an activity left uncredited).
function buildStoredActivity(
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
      ? list.filter((e): e is string => typeof e === 'string')
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
  id: string,
  given: string[] | null | undefined,
  callerEmail: string,
): Promise<string[] | undefined> {
  const rs = await db().execute({ sql: 'SELECT j FROM a WHERE id = ?', args: [id] });
  const row = rs.rows[0];
  const stored = storedContributors(row?.j);
  if (given == null) {
    if (!row) return [callerEmail];
    return stored.length > 0 ? stored : undefined;
  }
  const emails = [...new Set(given.map((e) => e.trim().toLowerCase()))].filter(
    (e) => e !== '',
  );
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

async function saveActivity(
  _parent: unknown,
  { input }: { input: { id: string; activity: ActivityInput } },
  ctx: GqlContext,
) {
  const caller = requireOwnerCtx(ctx);
  const id = input.id;
  if (!id) throw badInput('missing id');
  const contributors = await resolveContributors(
    id,
    input.activity.contributors,
    caller.email,
  );
  const stored = buildStoredActivity(id, input.activity, contributors);
  const json = JSON.stringify(stored);
  if (json.length > 8000) throw badInput('activity too large');
  await db().execute({
    sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET j = excluded.j, t = excluded.t',
    args: [id, json, Date.now()],
  });
  forgetCatalog(); // road miles (#66) pick up a new or moved pin
  return { activity: mapCatalogActivity(stored, id) };
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
  // already happened: it leaves only unlisted blobs, not a broken row.
  const results = await db().batch(
    [
      { sql: 'DELETE FROM a WHERE id = ?', args: [id] },
      { sql: 'DELETE FROM activity_reviews WHERE activity_id = ?', args: [id] },
      deletePhotosOf(id),
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

export const catalogQuery = { activities, completed };
export const catalogMutation = { saveActivity, deleteActivity, setCompleted };

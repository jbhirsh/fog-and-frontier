import { db } from '../_db.js';
import { badInput } from '../_gqlError.js';
import { dateToIso, mapCatalogActivity } from '../_gqlMap.js';
import { requireOwnerCtx, type GqlContext } from '../_gqlContext.js';

// Catalog activities (`a` table) + completion overrides (`c` table). Reads are
// public; writes are owner-gated. Activities are stored as camelCase JSON, so
// reads parse-and-pass-through and writes JSON.stringify the input.

function rowIdToString(id: unknown): string | null {
  if (typeof id === 'string') return id;
  if (typeof id === 'number' || typeof id === 'bigint') return id.toString();
  return null;
}

async function activities() {
  const rs = await db().execute('SELECT id, j FROM a ORDER BY t DESC');
  const out: Record<string, unknown>[] = [];
  for (const row of rs.rows) {
    const id = rowIdToString(row.id);
    if (!id) continue;
    const j = row.j;
    if (typeof j !== 'string') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(j);
    } catch {
      continue; // skip malformed row
    }
    if (!parsed || typeof parsed !== 'object') continue;
    out.push(mapCatalogActivity(parsed as Record<string, unknown>, id));
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

type ActivityInput = Record<string, unknown> & { completedDate?: unknown };

// Build the persisted catalog JSON from a SaveActivityInput. The input lacks
// `id` (it's a sibling field), so we splice it in; `completedDate` arrives as a
// Date object from the Date scalar and is normalized back to 'YYYY-MM-DD'.
function buildStoredActivity(
  id: string,
  activity: ActivityInput,
): Record<string, unknown> {
  const stored: Record<string, unknown> = { id, ...activity };
  if (activity.completedDate !== undefined) {
    stored.completedDate = dateToIso(activity.completedDate);
  }
  return stored;
}

async function saveActivity(
  _parent: unknown,
  { input }: { input: { id: string; activity: ActivityInput } },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const id = input.id;
  if (typeof id !== 'string' || !id) throw badInput('missing id');
  const stored = buildStoredActivity(id, input.activity);
  const json = JSON.stringify(stored);
  if (json.length > 8000) throw badInput('activity too large');
  await db().execute({
    sql: 'INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET j = excluded.j, t = excluded.t',
    args: [id, json, Date.now()],
  });
  return { activity: mapCatalogActivity(stored, id) };
}

async function deleteActivity(
  _parent: unknown,
  { input }: { input: { id: string } },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const id = input.id;
  if (typeof id !== 'string' || !id) throw badInput('missing id');
  await db().execute({ sql: 'DELETE FROM a WHERE id = ?', args: [id] });
  return { deletedId: id };
}

async function setCompleted(
  _parent: unknown,
  { input }: { input: { id: string; value?: boolean | null } },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const id = input.id;
  if (typeof id !== 'string' || !id) throw badInput('missing id');
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

export const catalogQuery = { activities, completed };
export const catalogMutation = { saveActivity, deleteActivity, setCompleted };

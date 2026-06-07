import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { InStatement } from '@libsql/client';
import { db } from './_db.js';
import { withErrorLogging } from './_log.js';
import {
  ensureTripsSchema,
  getTripActivities,
  getTripRow,
  requireCreator,
} from './_trips.js';

// Finalize voting: creator promotes a shortlist into the v0 planning stage
// (#51). Body: { kept_activity_ids: string[] } — the trip_activity ids to keep,
// in the order they should appear (display_order is normalized to match).
// Unselected candidates and their votes are culled; the trip flips to
// `planning`. Creator-only; 409 unless currently `voting`.

type Body = { kept_activity_ids?: unknown };

function queryParam(req: VercelRequest, key: string): string | null {
  const value = req.query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default withErrorLogging(async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await ensureTripsSchema();

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const id = queryParam(req, 'id');
  if (!id) {
    res.status(400).json({ error: 'missing id' });
    return;
  }

  const ctx = await requireCreator(req, res, id);
  if (!ctx) return;

  const trip = await getTripRow(id);
  if (!trip) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (trip.status !== 'voting') {
    res
      .status(409)
      .json({ error: 'trip is not in voting', code: 'not_voting' });
    return;
  }

  const activities = await getTripActivities(id);
  const onTrip = new Set(activities.map((a) => a.id));
  // Only keep ids that actually belong to this trip; ignore stray ids.
  const reqBody = (req.body ?? {}) as Body;
  const rawKept = Array.isArray(reqBody.kept_activity_ids)
    ? reqBody.kept_activity_ids
    : [];
  const keptOrdered: string[] = [];
  const keptSet = new Set<string>();
  for (const raw of rawKept) {
    if (typeof raw === 'string' && onTrip.has(raw) && !keptSet.has(raw)) {
      keptSet.add(raw);
      keptOrdered.push(raw);
    }
  }
  const toDelete = activities.filter((a) => !keptSet.has(a.id));

  // One transaction (#51 c9): cull unselected candidates + their votes,
  // normalize display_order on the survivors, and flip status.
  const stmts: InStatement[] = [];
  for (const a of toDelete) {
    stmts.push({
      sql: 'DELETE FROM trip_votes WHERE trip_activity_id = ?',
      args: [a.id],
    });
    stmts.push({
      sql: 'DELETE FROM trip_activities WHERE id = ?',
      args: [a.id],
    });
  }
  keptOrdered.forEach((taId, index) => {
    stmts.push({
      sql: 'UPDATE trip_activities SET display_order = ? WHERE id = ?',
      args: [index, taId],
    });
  });
  stmts.push({
    sql: `UPDATE trips SET status = 'planning' WHERE id = ?`,
    args: [id],
  });
  await db().batch(stmts, 'write');

  res.status(200).json({ ok: true, status: 'planning', kept: keptOrdered.length });
});

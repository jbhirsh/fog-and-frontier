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

// Reopen voting on a trip that's in `planning` (#51). Creator-only. Clears all
// itinerary slot assignments (day_index/start_time) and normalizes
// display_order, but PRESERVES votes — reverting is reversible scheduling, not
// a vote reset. 409 unless currently `planning` (blocks `past` and re-entrant
// `voting`). `past` is terminal; only planning↔voting reverts are allowed.

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
  if (trip.status !== 'planning') {
    res.status(409).json({
      error:
        trip.status === 'past'
          ? 'past trips cannot reopen voting'
          : 'trip is already in voting',
      code: 'not_planning',
    });
    return;
  }

  // getTripActivities returns scheduled-first; reuse that order to normalize
  // display_order as we clear the slots, so the candidate list keeps a stable
  // sequence when it reappears in the voting view.
  const activities = await getTripActivities(id);
  const stmts: InStatement[] = activities.map((a, index) => ({
    sql: `UPDATE trip_activities
          SET day_index = NULL, start_time = NULL, display_order = ?
          WHERE id = ?`,
    args: [index, a.id],
  }));
  stmts.push({
    sql: `UPDATE trips SET status = 'voting' WHERE id = ?`,
    args: [id],
  });
  await db().batch(stmts, 'write');

  res.status(200).json({ ok: true, status: 'voting' });
});

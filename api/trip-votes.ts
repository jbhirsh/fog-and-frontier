import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db.js';
import { withErrorLogging } from './_log.js';
import { ensureTripsSchema, getTripRow, requireMember } from './_trips.js';

// Cast or clear a vote on a trip candidate (#51). Open only while the trip is
// in `voting`. Body: { trip_id, trip_activity_id, value: -1 | 0 | 1 }.
//   value  1 → upvote, -1 → downvote (upsert a row)
//   value  0 → neutral (delete the row)
// Votes are keyed to the candidate on this trip (trip_activity_id), not the
// catalog activity (#51 c7).

type Body = {
  trip_id?: unknown;
  trip_activity_id?: unknown;
  value?: unknown;
};

export default withErrorLogging(async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await ensureTripsSchema();

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Body;
  const tripId = typeof body.trip_id === 'string' ? body.trip_id : null;
  const taId =
    typeof body.trip_activity_id === 'string' ? body.trip_activity_id : null;
  if (!tripId || !taId) {
    res.status(400).json({ error: 'missing trip_id or trip_activity_id' });
    return;
  }
  if (body.value !== -1 && body.value !== 0 && body.value !== 1) {
    res.status(400).json({ error: 'value must be -1, 0, or 1' });
    return;
  }
  const value = body.value;

  const ctx = await requireMember(req, res, tripId);
  if (!ctx) return;

  const trip = await getTripRow(tripId);
  if (!trip) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (trip.status !== 'voting') {
    res.status(409).json({ error: 'voting is closed', code: 'not_voting' });
    return;
  }

  // The candidate must belong to this trip — guards against voting on another
  // trip's row by id.
  const ta = await db().execute({
    sql: 'SELECT id FROM trip_activities WHERE id = ? AND trip_id = ?',
    args: [taId, tripId],
  });
  if (ta.rows.length === 0) {
    res.status(404).json({ error: 'candidate not found on this trip' });
    return;
  }

  if (value === 0) {
    await db().execute({
      sql: `DELETE FROM trip_votes
            WHERE trip_id = ? AND member_email = ? AND trip_activity_id = ?`,
      args: [tripId, ctx.email, taId],
    });
  } else {
    await db().execute({
      sql: `INSERT INTO trip_votes
              (trip_id, member_email, trip_activity_id, value, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(trip_id, member_email, trip_activity_id)
            DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [tripId, ctx.email, taId, value, Date.now()],
    });
  }

  res.status(200).json({ ok: true, trip_activity_id: taId, value });
});

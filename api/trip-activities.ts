import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db.js';
import { requireOwner } from './_auth.js';
import { withErrorLogging } from './_log.js';
import {
  ensureTripsSchema,
  fetchActivitySnapshot,
  getTripActivities,
  getTripRow,
  isHHMM,
  newId,
  rowToTripActivity,
  type TripActivity,
} from './_trips.js';

type AddBody = { trip_id?: unknown; activity_id?: unknown };

type PatchBody = {
  day_index?: unknown;
  start_time?: unknown;
  display_order?: unknown;
};

function queryParam(req: VercelRequest, key: string): string | null {
  const value = req.query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

async function getTripActivityRow(taId: string): Promise<TripActivity | null> {
  const rs = await db().execute({
    sql: 'SELECT * FROM trip_activities WHERE id = ?',
    args: [taId],
  });
  const row = rs.rows[0];
  return row ? rowToTripActivity(row) : null;
}

// Inclusive day count between trip.start_date and trip.end_date (server-side
// mirror of the client `dayCount` helper). Used to bound PATCH day_index.
function tripDateRangeDayCount(trip: { start_date: string; end_date: string }): number {
  const start = Date.parse(`${trip.start_date}T00:00:00Z`);
  const end = Date.parse(`${trip.end_date}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.round((end - start) / 86_400_000) + 1;
}

export default withErrorLogging(async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await ensureTripsSchema();

  const ownerEmail = await requireOwner(req, res);
  if (!ownerEmail) return;

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as AddBody;
    const tripId = typeof body.trip_id === 'string' ? body.trip_id : null;
    const activityId =
      typeof body.activity_id === 'string' ? body.activity_id : null;
    if (!tripId || !activityId) {
      res.status(400).json({ error: 'missing trip_id or activity_id' });
      return;
    }
    const trip = await getTripRow(tripId);
    if (!trip) {
      res.status(404).json({ error: 'trip not found' });
      return;
    }
    if (trip.status === 'past') {
      res.status(409).json({ error: 'trip is past', code: 'trip_past' });
      return;
    }
    const existing = await db().execute({
      sql: 'SELECT id FROM trip_activities WHERE trip_id = ? AND activity_id = ?',
      args: [tripId, activityId],
    });
    if (existing.rows.length > 0) {
      res
        .status(409)
        .json({ error: 'activity already on trip', code: 'duplicate' });
      return;
    }
    const snapshotJson = await fetchActivitySnapshot(activityId);
    if (!snapshotJson) {
      res.status(404).json({ error: 'activity not found' });
      return;
    }
    const id = newId();
    const added_at = Date.now();
    await db().execute({
      sql: `INSERT INTO trip_activities (
              id, trip_id, activity_id, snapshot_json,
              added_by_email, added_at, day_index, start_time, display_order
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0)`,
      args: [id, tripId, activityId, snapshotJson, ownerEmail, added_at],
    });
    const activities = await getTripActivities(tripId);
    const created = activities.find((a) => a.id === id);
    res.status(201).json(created ?? { id });
    return;
  }

  // PATCH and DELETE work on a single trip_activities row by ?ta_id=.
  const taId = queryParam(req, 'ta_id');
  if (!taId) {
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      res.status(400).json({ error: 'missing ta_id' });
      return;
    }
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const tripActivity = await getTripActivityRow(taId);
  if (!tripActivity) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const trip = await getTripRow(tripActivity.trip_id);
  if (!trip) {
    res.status(404).json({ error: 'trip not found' });
    return;
  }
  if (trip.status === 'past') {
    res.status(409).json({ error: 'trip is past', code: 'trip_past' });
    return;
  }

  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as PatchBody;

    // Decide on the new (day_index, start_time) pair. Either both set or both null.
    // The client passes nulls to unschedule; passing both as new values rescues a slot.
    let day_index = tripActivity.day_index;
    let start_time = tripActivity.start_time;

    if (body.day_index !== undefined || body.start_time !== undefined) {
      const nextDay = body.day_index === undefined ? day_index : body.day_index;
      const nextTime = body.start_time === undefined ? start_time : body.start_time;
      const bothNull = nextDay === null && nextTime === null;
      const dayCount = tripDateRangeDayCount(trip);
      const bothSet =
        typeof nextDay === 'number' &&
        Number.isInteger(nextDay) &&
        nextDay >= 0 &&
        nextDay < dayCount &&
        isHHMM(nextTime);
      if (!bothNull && !bothSet) {
        res.status(400).json({
          error: `day_index and start_time must be set together (both null, or day_index in 0..${dayCount - 1} and start_time HH:MM)`,
        });
        return;
      }
      day_index = bothNull ? null : (nextDay);
      start_time = bothNull ? null : (nextTime);
    }

    let display_order = tripActivity.display_order;
    if (body.display_order !== undefined) {
      if (typeof body.display_order !== 'number' || !Number.isInteger(body.display_order)) {
        res.status(400).json({ error: 'display_order must be an integer' });
        return;
      }
      display_order = body.display_order;
    }

    await db().execute({
      sql: `UPDATE trip_activities
            SET day_index = ?, start_time = ?, display_order = ?
            WHERE id = ?`,
      args: [day_index, start_time, display_order, taId],
    });
    const updated = await getTripActivityRow(taId);
    res.status(200).json(updated);
    return;
  }

  if (req.method === 'DELETE') {
    await db().execute({
      sql: 'DELETE FROM trip_activities WHERE id = ?',
      args: [taId],
    });
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
});

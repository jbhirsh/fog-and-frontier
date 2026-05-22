import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db.js';
import { requireOwner } from './_auth.js';
import { withErrorLogging } from './_log.js';
import {
  ensureTripsSchema,
  fetchActivitySnapshot,
  getTripActivities,
  getTripRow,
  isIsoDate,
  newId,
  rowToTrip,
  type Trip,
  type TripListItem,
  type TripRow,
} from './_trips.js';

type CreateBody = {
  title?: unknown;
  description?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  cover_image_url?: unknown;
  initial_activity_ids?: unknown;
};

type PatchBody = {
  title?: unknown;
  description?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  cover_image_url?: unknown;
};

function queryParam(
  req: VercelRequest,
  key: string,
): string | null {
  const value = req.query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function trimmedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t.length > max) return null;
  return t;
}

async function listTrips(): Promise<TripListItem[]> {
  // Sort: `planning` trips first by start_date asc, then `past` trips by
  // marked_past_at desc. CASE pushes the status to a sortable bucket.
  const trips = await db().execute(
    `SELECT * FROM trips
     ORDER BY
       CASE WHEN status = 'planning' THEN 0 ELSE 1 END,
       CASE WHEN status = 'planning' THEN start_date END ASC,
       CASE WHEN status = 'past' THEN marked_past_at END DESC,
       created_at DESC`,
  );
  const counts = await db().execute(
    `SELECT trip_id,
       SUM(CASE WHEN day_index IS NULL THEN 0 ELSE 1 END) AS scheduled,
       SUM(CASE WHEN day_index IS NULL THEN 1 ELSE 0 END) AS unscheduled
     FROM trip_activities
     GROUP BY trip_id`,
  );
  const byTrip = new Map<string, { scheduled: number; unscheduled: number }>();
  for (const row of counts.rows) {
    const raw = row.trip_id;
    let tripId: string;
    if (typeof raw === 'string') tripId = raw;
    else if (typeof raw === 'number' || typeof raw === 'bigint') tripId = raw.toString();
    else continue;
    byTrip.set(tripId, {
      scheduled: Number(row.scheduled ?? 0),
      unscheduled: Number(row.unscheduled ?? 0),
    });
  }
  return trips.rows.map((row) => {
    const trip = rowToTrip(row);
    const c = byTrip.get(trip.id) ?? { scheduled: 0, unscheduled: 0 };
    return {
      ...trip,
      scheduled_count: c.scheduled,
      unscheduled_count: c.unscheduled,
    };
  });
}

async function getTripDetail(tripId: string): Promise<Trip | null> {
  const trip = await getTripRow(tripId);
  if (!trip) return null;
  const activities = await getTripActivities(tripId);
  return { ...trip, activities };
}

async function createTrip(
  body: CreateBody,
  creatorEmail: string,
): Promise<{ trip: Trip } | { error: string; status: number }> {
  const title = trimmedString(body.title, 200);
  if (!title) return { error: 'missing or invalid title', status: 400 };

  const start_date = body.start_date;
  const end_date = body.end_date;
  if (!isIsoDate(start_date) || !isIsoDate(end_date)) {
    return { error: 'start_date and end_date must be ISO dates (YYYY-MM-DD)', status: 400 };
  }
  if (end_date < start_date) {
    return { error: 'end_date must be on or after start_date', status: 400 };
  }

  const description =
    body.description == null
      ? null
      : trimmedString(body.description, 2000);
  if (body.description != null && description === null) {
    return { error: 'invalid description', status: 400 };
  }

  const cover_image_url =
    body.cover_image_url == null
      ? null
      : trimmedString(body.cover_image_url, 2000);
  if (body.cover_image_url != null && cover_image_url === null) {
    return { error: 'invalid cover_image_url', status: 400 };
  }

  const id = newId();
  const created_at = Date.now();
  await db().execute({
    sql: `INSERT INTO trips (
            id, creator_email, title, description,
            start_date, end_date, cover_image_url,
            status, created_at, marked_past_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'planning', ?, NULL)`,
    args: [
      id,
      creatorEmail,
      title,
      description,
      start_date,
      end_date,
      cover_image_url,
      created_at,
    ],
  });

  // Optional initial activity snapshot — used by "New trip from selection".
  if (Array.isArray(body.initial_activity_ids)) {
    const seen = new Set<string>();
    for (const raw of body.initial_activity_ids) {
      if (typeof raw !== 'string' || seen.has(raw)) continue;
      seen.add(raw);
      const snapshotJson = await fetchActivitySnapshot(raw);
      if (!snapshotJson) continue;
      await db().execute({
        sql: `INSERT OR IGNORE INTO trip_activities (
                id, trip_id, activity_id, snapshot_json,
                added_by_email, added_at, day_index, start_time, display_order
              ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0)`,
        args: [newId(), id, raw, snapshotJson, creatorEmail, Date.now()],
      });
    }
  }

  const trip = await getTripDetail(id);
  if (!trip) return { error: 'failed to load created trip', status: 500 };
  return { trip };
}

async function patchTrip(
  tripId: string,
  body: PatchBody,
): Promise<TripRow | { error: string; status: number }> {
  const existing = await getTripRow(tripId);
  if (!existing) return { error: 'not found', status: 404 };
  const isPast = existing.status === 'past';

  const sets: string[] = [];
  const args: (string | null)[] = [];

  if (body.title !== undefined) {
    if (isPast) return { error: 'trip is past', status: 409 };
    const title = trimmedString(body.title, 200);
    if (!title) return { error: 'invalid title', status: 400 };
    sets.push('title = ?');
    args.push(title);
  }
  if (body.description !== undefined) {
    const description =
      body.description === null
        ? null
        : trimmedString(body.description, 2000);
    if (body.description !== null && description === null) {
      return { error: 'invalid description', status: 400 };
    }
    sets.push('description = ?');
    args.push(description);
  }
  if (body.start_date !== undefined) {
    if (isPast) return { error: 'trip is past', status: 409 };
    if (!isIsoDate(body.start_date)) return { error: 'invalid start_date', status: 400 };
    sets.push('start_date = ?');
    args.push(body.start_date);
  }
  if (body.end_date !== undefined) {
    if (isPast) return { error: 'trip is past', status: 409 };
    if (!isIsoDate(body.end_date)) return { error: 'invalid end_date', status: 400 };
    sets.push('end_date = ?');
    args.push(body.end_date);
  }
  if (body.cover_image_url !== undefined) {
    const cover =
      body.cover_image_url === null
        ? null
        : trimmedString(body.cover_image_url, 2000);
    if (body.cover_image_url !== null && cover === null) {
      return { error: 'invalid cover_image_url', status: 400 };
    }
    sets.push('cover_image_url = ?');
    args.push(cover);
  }

  if (sets.length === 0) return existing;

  await db().execute({
    sql: `UPDATE trips SET ${sets.join(', ')} WHERE id = ?`,
    args: [...args, tripId],
  });

  // Re-validate dates if either changed.
  const updated = await getTripRow(tripId);
  if (!updated) return { error: 'not found', status: 404 };
  if (updated.end_date < updated.start_date) {
    // Roll back date change.
    await db().execute({
      sql: 'UPDATE trips SET start_date = ?, end_date = ? WHERE id = ?',
      args: [existing.start_date, existing.end_date, tripId],
    });
    return { error: 'end_date must be on or after start_date', status: 400 };
  }
  return updated;
}

async function deleteTrip(tripId: string): Promise<boolean> {
  const existing = await getTripRow(tripId);
  if (!existing) return false;
  await db().execute({
    sql: 'DELETE FROM trip_activities WHERE trip_id = ?',
    args: [tripId],
  });
  await db().execute({
    sql: 'DELETE FROM trips WHERE id = ?',
    args: [tripId],
  });
  return true;
}

export default withErrorLogging(async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await ensureTripsSchema();

  // Every trips endpoint is owner-gated (v0 has no editor accounts).
  const ownerEmail = await requireOwner(req, res);
  if (!ownerEmail) return;

  const id = queryParam(req, 'id');

  if (req.method === 'GET') {
    if (id) {
      const trip = await getTripDetail(id);
      if (!trip) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.status(200).json(trip);
      return;
    }
    const trips = await listTrips();
    res.status(200).json(trips);
    return;
  }

  if (req.method === 'POST') {
    const result = await createTrip((req.body ?? {}) as CreateBody, ownerEmail);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json(result.trip);
    return;
  }

  if (req.method === 'PATCH') {
    if (!id) {
      res.status(400).json({ error: 'missing id' });
      return;
    }
    const result = await patchTrip(id, (req.body ?? {}) as PatchBody);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(200).json(result);
    return;
  }

  if (req.method === 'DELETE') {
    if (!id) {
      res.status(400).json({ error: 'missing id' });
      return;
    }
    const ok = await deleteTrip(id);
    if (!ok) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
});

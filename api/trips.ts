import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db.js';
import { getCurrentUser, requireOwner } from './_auth.js';
import { withErrorLogging } from './_log.js';
import {
  addTripMember,
  ensureTripsSchema,
  fetchActivitySnapshot,
  getTripActivities,
  getTripInvites,
  getTripMembers,
  getTripRow,
  isIsoDate,
  newId,
  requireCreator,
  requireMember,
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

async function listTrips(callerEmail: string): Promise<TripListItem[]> {
  // Member-scoped (#51): only trips the caller belongs to. Sort: active
  // (voting/planning) trips first by start_date asc, then `past` by
  // marked_past_at desc. CASE pushes the status to a sortable bucket.
  const trips = await db().execute({
    sql: `SELECT t.* FROM trips t
          JOIN trip_members m ON m.trip_id = t.id
          WHERE m.member_email = ?
          ORDER BY
            CASE WHEN t.status = 'past' THEN 1 ELSE 0 END,
            CASE WHEN t.status <> 'past' THEN t.start_date END ASC,
            CASE WHEN t.status = 'past' THEN t.marked_past_at END DESC,
            t.created_at DESC`,
    args: [callerEmail],
  });
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
  const [activities, members, invites] = await Promise.all([
    getTripActivities(tripId),
    getTripMembers(tripId, trip.creator_email),
    getTripInvites(tripId),
  ]);
  return { ...trip, activities, members, invites };
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

  // Cap initial-activity bulk-add before any INSERT so a malformed request
  // can't orphan a trip row.
  const MAX_INITIAL_ACTIVITIES = 50;
  if (
    Array.isArray(body.initial_activity_ids) &&
    body.initial_activity_ids.length > MAX_INITIAL_ACTIVITIES
  ) {
    return {
      error: `too many initial_activity_ids (max ${MAX_INITIAL_ACTIVITIES})`,
      status: 400,
    };
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

  // Creator becomes the first member (#51) — replaces v0's implicit
  // "shared with all owners". Other owners must be invited.
  await addTripMember(id, creatorEmail, creatorEmail);

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

// Inclusive day count between start_date and end_date.
function tripDateRangeDayCount(start_date: string, end_date: string): number {
  const start = Date.parse(`${start_date}T00:00:00Z`);
  const end = Date.parse(`${end_date}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.round((end - start) / 86_400_000) + 1;
}

async function patchTrip(
  tripId: string,
  body: PatchBody,
): Promise<TripRow | { error: string; status: number }> {
  const existing = await getTripRow(tripId);
  if (!existing) return { error: 'not found', status: 404 };
  const isPast = existing.status === 'past';

  // Validate each field against the existing row first; compose a proposed
  // row before touching the DB so a failed validation never leaves a partial
  // write behind (the previous write-then-rollback approach left non-date
  // fields mutated when the date-range check failed).
  const sets: string[] = [];
  const args: (string | null)[] = [];
  const proposed: {
    title: string;
    description: string | null;
    start_date: string;
    end_date: string;
    cover_image_url: string | null;
  } = {
    title: existing.title,
    description: existing.description,
    start_date: existing.start_date,
    end_date: existing.end_date,
    cover_image_url: existing.cover_image_url,
  };

  if (body.title !== undefined) {
    if (isPast) return { error: 'trip is past', status: 409 };
    const title = trimmedString(body.title, 200);
    if (!title) return { error: 'invalid title', status: 400 };
    proposed.title = title;
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
    proposed.description = description;
    sets.push('description = ?');
    args.push(description);
  }
  if (body.start_date !== undefined) {
    if (isPast) return { error: 'trip is past', status: 409 };
    if (!isIsoDate(body.start_date)) return { error: 'invalid start_date', status: 400 };
    proposed.start_date = body.start_date;
    sets.push('start_date = ?');
    args.push(body.start_date);
  }
  if (body.end_date !== undefined) {
    if (isPast) return { error: 'trip is past', status: 409 };
    if (!isIsoDate(body.end_date)) return { error: 'invalid end_date', status: 400 };
    proposed.end_date = body.end_date;
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
    proposed.cover_image_url = cover;
    sets.push('cover_image_url = ?');
    args.push(cover);
  }

  if (sets.length === 0) return existing;

  // Pre-write validation of the merged row.
  if (proposed.end_date < proposed.start_date) {
    return { error: 'end_date must be on or after start_date', status: 400 };
  }

  await db().execute({
    sql: `UPDATE trips SET ${sets.join(', ')} WHERE id = ?`,
    args: [...args, tripId],
  });

  // If the date range changed, any slotted activity whose day_index now
  // falls outside the new range would render nowhere (bucketByDay only
  // iterates [0, dayCount-1]). Slide those back to Unscheduled so the
  // owner can re-slot or remove them.
  const dateChanged =
    proposed.start_date !== existing.start_date ||
    proposed.end_date !== existing.end_date;
  if (dateChanged) {
    const newDayCount = tripDateRangeDayCount(
      proposed.start_date,
      proposed.end_date,
    );
    await db().execute({
      sql: `UPDATE trip_activities
            SET day_index = NULL, start_time = NULL
            WHERE trip_id = ? AND (day_index < 0 OR day_index >= ?)`,
      args: [tripId, newDayCount],
    });
  }

  const updated = await getTripRow(tripId);
  if (!updated) return { error: 'not found', status: 404 };
  return updated;
}

async function deleteTrip(tripId: string): Promise<boolean> {
  const existing = await getTripRow(tripId);
  if (!existing) return false;
  // Single transaction so a trip never half-deletes, leaving orphan votes or
  // members behind (#51 c9).
  await db().batch(
    [
      { sql: 'DELETE FROM trip_votes WHERE trip_id = ?', args: [tripId] },
      { sql: 'DELETE FROM trip_activities WHERE trip_id = ?', args: [tripId] },
      { sql: 'DELETE FROM trip_invites WHERE trip_id = ?', args: [tripId] },
      { sql: 'DELETE FROM trip_members WHERE trip_id = ?', args: [tripId] },
      { sql: 'DELETE FROM trips WHERE id = ?', args: [tripId] },
    ],
    'write',
  );
  return true;
}

export default withErrorLogging(async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  await ensureTripsSchema();

  const id = queryParam(req, 'id');

  if (req.method === 'GET') {
    if (id) {
      // requireMember hides existence from non-members (404, not 403).
      const ctx = await requireMember(req, res, id);
      if (!ctx) return;
      const trip = await getTripDetail(id);
      if (!trip) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.status(200).json(trip);
      return;
    }
    // List is member-scoped: any authed account, only its own trips.
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const trips = await listTrips(user.email);
    res.status(200).json(trips);
    return;
  }

  if (req.method === 'POST') {
    // Trip creation stays owner-only (#51 c1): editors exist only via invite.
    const ownerEmail = await requireOwner(req, res);
    if (!ownerEmail) return;
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
    // Any member can edit metadata.
    const ctx = await requireMember(req, res, id);
    if (!ctx) return;
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
    // Deletion is creator-only (#51).
    const ctx = await requireCreator(req, res, id);
    if (!ctx) return;
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

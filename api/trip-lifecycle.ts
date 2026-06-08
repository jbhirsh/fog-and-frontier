import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { InStatement } from '@libsql/client';
import { db } from './_db.js';
import { withErrorLogging } from './_log.js';
import {
  ensureTripsSchema,
  getTripActivities,
  getTripRow,
  requireCreator,
  type TripRow,
} from './_trips.js';

// Creator-only trip status transitions (#51), consolidated into one function to
// stay under Vercel's per-deployment Serverless Function cap. Dispatch on
// `?to=`:
//   POST /api/trip-lifecycle?id=<tripId>&to=planning   { kept_activity_ids }
//     Finalize voting → planning: cull unselected candidates + their votes,
//     normalize display_order, flip status. 409 unless currently `voting`.
//   POST /api/trip-lifecycle?id=<tripId>&to=voting
//     Reopen voting from planning: clear slot fields, normalize display_order,
//     PRESERVE votes. 409 unless currently `planning` (`past` is terminal).
//   POST /api/trip-lifecycle?id=<tripId>&to=past        { completed_activity_ids }
//     Mark past: write through completion to the `c` table and freeze the trip.
//     409 if already past.

// `c` is the existing completed table (api/completed.ts). Mark-past writes
// through it so checked items show as completed across every member's view.
let completedInitialized = false;
async function ensureCompletedSchema() {
  if (completedInitialized) return;
  await db().execute(
    'CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)',
  );
  completedInitialized = true;
}

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
  const to = queryParam(req, 'to');
  if (!id) {
    res.status(400).json({ error: 'missing id' });
    return;
  }
  if (to !== 'planning' && to !== 'voting' && to !== 'past') {
    res.status(400).json({ error: 'to must be planning, voting, or past' });
    return;
  }

  // Every transition is creator-only. 404 for non-members hides existence;
  // 403 for non-creator members.
  const ctx = await requireCreator(req, res, id);
  if (!ctx) return;

  const trip = await getTripRow(id);
  if (!trip) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  if (to === 'planning') {
    await transitionToPlanning(req, res, trip);
    return;
  }
  if (to === 'voting') {
    await revertToVoting(res, trip);
    return;
  }
  await markPast(req, res, trip);
});

async function transitionToPlanning(
  req: VercelRequest,
  res: VercelResponse,
  trip: TripRow,
): Promise<void> {
  if (trip.status !== 'voting') {
    res.status(409).json({ error: 'trip is not in voting', code: 'not_voting' });
    return;
  }
  const activities = await getTripActivities(trip.id);
  const onTrip = new Set(activities.map((a) => a.id));
  const reqBody = (req.body ?? {}) as { kept_activity_ids?: unknown };
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
  // normalize display_order on survivors, flip status.
  const stmts: InStatement[] = [];
  for (const a of toDelete) {
    stmts.push({
      sql: 'DELETE FROM trip_votes WHERE trip_activity_id = ?',
      args: [a.id],
    });
    stmts.push({ sql: 'DELETE FROM trip_activities WHERE id = ?', args: [a.id] });
  }
  keptOrdered.forEach((taId, index) => {
    stmts.push({
      sql: 'UPDATE trip_activities SET display_order = ? WHERE id = ?',
      args: [index, taId],
    });
  });
  stmts.push({
    sql: `UPDATE trips SET status = 'planning' WHERE id = ?`,
    args: [trip.id],
  });
  await db().batch(stmts, 'write');

  res
    .status(200)
    .json({ ok: true, status: 'planning', kept: keptOrdered.length });
}

async function revertToVoting(
  res: VercelResponse,
  trip: TripRow,
): Promise<void> {
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
  // Clear slot assignments + normalize display_order; PRESERVE votes.
  const activities = await getTripActivities(trip.id);
  const stmts: InStatement[] = activities.map((a, index) => ({
    sql: `UPDATE trip_activities
          SET day_index = NULL, start_time = NULL, display_order = ?
          WHERE id = ?`,
    args: [index, a.id],
  }));
  stmts.push({
    sql: `UPDATE trips SET status = 'voting' WHERE id = ?`,
    args: [trip.id],
  });
  await db().batch(stmts, 'write');

  res.status(200).json({ ok: true, status: 'voting' });
}

async function markPast(
  req: VercelRequest,
  res: VercelResponse,
  trip: TripRow,
): Promise<void> {
  if (trip.status === 'past') {
    res.status(409).json({ error: 'trip is already past' });
    return;
  }
  await ensureCompletedSchema();

  const body = (req.body ?? {}) as { completed_activity_ids?: unknown };
  const rawIds = Array.isArray(body.completed_activity_ids)
    ? body.completed_activity_ids.filter((v): v is string => typeof v === 'string')
    : [];

  // Only mark activities on the trip AND scheduled AND still pointing at a live
  // catalog row. Orphaned snapshot-only rows have nowhere to land completion.
  const onTrip = await getTripActivities(trip.id);
  const eligibleIds = new Set(
    onTrip
      .filter((a) => a.activity_id !== null && a.day_index !== null)
      .map((a) => a.activity_id as string),
  );
  const checkedSet = new Set(rawIds.filter((aid) => eligibleIds.has(aid)));
  const toMark = Array.from(checkedSet);
  // Scheduled items explicitly unchecked get v=0 so the retrospection decision
  // overrides any stale completion baseline elsewhere in the UI.
  const toUnmark = Array.from(eligibleIds).filter((aid) => !checkedSet.has(aid));

  const marked_past_at = Date.now();
  await db().execute({
    sql: `UPDATE trips SET status = 'past', marked_past_at = ? WHERE id = ?`,
    args: [marked_past_at, trip.id],
  });
  for (const aid of toMark) {
    await db().execute({
      sql: `INSERT INTO c (id, v) VALUES (?, 1)
            ON CONFLICT(id) DO UPDATE SET v = excluded.v`,
      args: [aid],
    });
  }
  for (const aid of toUnmark) {
    await db().execute({
      sql: `INSERT INTO c (id, v) VALUES (?, 0)
            ON CONFLICT(id) DO UPDATE SET v = excluded.v`,
      args: [aid],
    });
  }

  res.status(200).json({
    ok: true,
    marked_past_at,
    completed_activity_ids: toMark,
    uncompleted_activity_ids: toUnmark,
  });
}

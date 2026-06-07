import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db.js';
import { withErrorLogging } from './_log.js';
import {
  ensureTripsSchema,
  getTripRow,
  getTripActivities,
  requireCreator,
} from './_trips.js';

// `c` is the existing completed table (api/completed.ts). We INSERT through
// here so checked items show up as completed across every owner's view.
let completedInitialized = false;
async function ensureCompletedSchema() {
  if (completedInitialized) return;
  await db().execute(
    'CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)',
  );
  completedInitialized = true;
}

type Body = { completed_activity_ids?: unknown };

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
  await ensureCompletedSchema();

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const id = queryParam(req, 'id');
  if (!id) {
    res.status(400).json({ error: 'missing id' });
    return;
  }

  // Marking past is creator-only (#51). 404 for non-members hides existence;
  // 403 for non-creator members.
  const ctx = await requireCreator(req, res, id);
  if (!ctx) return;

  const trip = await getTripRow(id);
  if (!trip) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (trip.status === 'past') {
    res.status(409).json({ error: 'trip is already past' });
    return;
  }

  const body = (req.body ?? {}) as Body;
  const rawIds = Array.isArray(body.completed_activity_ids)
    ? body.completed_activity_ids.filter(
        (v): v is string => typeof v === 'string',
      )
    : [];

  // Only mark activities that are actually on the trip AND scheduled AND still
  // point at a live catalog row. Snapshot-only (orphaned) rows are skipped —
  // their completed-state would have nowhere meaningful to land.
  const onTrip = await getTripActivities(trip.id);
  const eligibleIds = new Set(
    onTrip
      .filter((a) => a.activity_id !== null && a.day_index !== null)
      .map((a) => a.activity_id as string),
  );
  const checkedSet = new Set(rawIds.filter((aid) => eligibleIds.has(aid)));
  const toMark = Array.from(checkedSet);
  // Scheduled items the user explicitly *un*-checked: write v=0 so the
  // "we didn't actually do this" decision overrides any stale completion
  // baseline. Otherwise an activity completed in a separate flow stays
  // checked across the rest of the UI even though the trip retrospection
  // says otherwise.
  const toUnmark = Array.from(eligibleIds).filter(
    (aid) => !checkedSet.has(aid),
  );

  const marked_past_at = Date.now();
  await db().execute({
    sql: `UPDATE trips
          SET status = 'past', marked_past_at = ?
          WHERE id = ?`,
    args: [marked_past_at, id],
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
});

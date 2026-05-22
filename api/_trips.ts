import { db } from './_db.js';

// Files in api/ that start with `_` are not exposed as routes by Vercel.
// Shared helpers, types, and schema for the Trips v0 feature (#50).

export type TripStatus = 'planning' | 'past';

export type TripRow = {
  id: string;
  creator_email: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  cover_image_url: string | null;
  status: TripStatus;
  created_at: number;
  marked_past_at: number | null;
};

export type TripActivityRow = {
  id: string;
  trip_id: string;
  activity_id: string | null;
  snapshot_json: string;
  added_by_email: string;
  added_at: number;
  day_index: number | null;
  start_time: string | null;
  display_order: number;
};

export type TripActivity = Omit<TripActivityRow, 'snapshot_json'> & {
  snapshot: unknown;
};

export type Trip = TripRow & {
  activities: TripActivity[];
};

export type TripListItem = TripRow & {
  scheduled_count: number;
  unscheduled_count: number;
};

let initialized = false;
export async function ensureTripsSchema(): Promise<void> {
  if (initialized) return;
  await db().execute(
    `CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      creator_email TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      cover_image_url TEXT,
      status TEXT NOT NULL DEFAULT 'planning',
      created_at INTEGER NOT NULL,
      marked_past_at INTEGER
    )`,
  );
  await db().execute(
    `CREATE TABLE IF NOT EXISTS trip_activities (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      activity_id TEXT,
      snapshot_json TEXT NOT NULL,
      added_by_email TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      day_index INTEGER,
      start_time TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (trip_id, activity_id)
    )`,
  );
  await db().execute(
    `CREATE INDEX IF NOT EXISTS idx_trip_activities_trip_id ON trip_activities (trip_id)`,
  );
  initialized = true;
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isHHMM(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// crypto.randomUUID is globally available in Node 19+.
export function newId(): string {
  return crypto.randomUUID();
}

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

function asOptionalString(value: unknown): string | null {
  return value == null ? null : asString(value);
}

function asNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  return Number(value);
}

function asOptionalNumber(value: unknown): number | null {
  return value == null ? null : asNumber(value);
}

export function rowToTrip(row: Row): TripRow {
  const status = asString(row.status);
  return {
    id: asString(row.id),
    creator_email: asString(row.creator_email),
    title: asString(row.title),
    description: asOptionalString(row.description),
    start_date: asString(row.start_date),
    end_date: asString(row.end_date),
    cover_image_url: asOptionalString(row.cover_image_url),
    status: (status === 'past' ? 'past' : 'planning'),
    created_at: asNumber(row.created_at),
    marked_past_at: asOptionalNumber(row.marked_past_at),
  };
}

export function rowToTripActivity(row: Row): TripActivity {
  const snapshotJson = asString(row.snapshot_json);
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(snapshotJson);
  } catch {
    snapshot = null;
  }
  return {
    id: asString(row.id),
    trip_id: asString(row.trip_id),
    activity_id: asOptionalString(row.activity_id),
    added_by_email: asString(row.added_by_email),
    added_at: asNumber(row.added_at),
    day_index: asOptionalNumber(row.day_index),
    start_time: asOptionalString(row.start_time),
    display_order: asNumber(row.display_order),
    snapshot,
  };
}

// Looks up an activity in the `a` table (where /api/activities stores them)
// and returns its raw JSON string for snapshotting. Returns null if missing.
export async function fetchActivitySnapshot(
  activityId: string,
): Promise<string | null> {
  const rs = await db().execute({
    sql: 'SELECT j FROM a WHERE id = ?',
    args: [activityId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  const j = row.j;
  return typeof j === 'string' ? j : null;
}

export async function getTripRow(tripId: string): Promise<TripRow | null> {
  const rs = await db().execute({
    sql: 'SELECT * FROM trips WHERE id = ?',
    args: [tripId],
  });
  const row = rs.rows[0];
  return row ? rowToTrip(row) : null;
}

export async function getTripActivities(
  tripId: string,
): Promise<TripActivity[]> {
  const rs = await db().execute({
    sql: `SELECT * FROM trip_activities
          WHERE trip_id = ?
          ORDER BY
            CASE WHEN day_index IS NULL THEN 1 ELSE 0 END,
            day_index ASC,
            start_time ASC,
            display_order ASC,
            added_at ASC`,
    args: [tripId],
  });
  return rs.rows.map((r) => rowToTripActivity(r as Row));
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db.js';
import {
  getCurrentUser,
  getOwnerEmails,
  type UserRole,
} from './_auth.js';

// Files in api/ that start with `_` are not exposed as routes by Vercel.
// Shared helpers, types, and schema for the Trips feature (v0 #50, v1 #51).

// 'voting' is added by the v1 voting PR; declared here so the type and the
// rowToTrip mapper are stable from the auth-foundation PR onward.
export type TripStatus = 'voting' | 'planning' | 'past';

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

export type TripMember = {
  email: string;
  display_name: string | null;
  added_by_email: string;
  added_at: number;
  is_creator: boolean;
};

export type TripInvite = {
  invite_token: string;
  invited_email: string | null;
  invited_by_email: string;
  invited_at: number;
};

// Membership context returned by the guards below.
export type MemberContext = {
  email: string;
  role: UserRole;
  isCreator: boolean;
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
  members: TripMember[];
  invites: TripInvite[];
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

  // --- v1 (#51): editor accounts, membership, invites, votes ---
  await db().execute(
    `CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      display_name TEXT,
      created_at INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor'
    )`,
  );
  // Key-value bag for migration sentinels etc. Kept separate from `users` so
  // backfill markers never leak into the invite picker autocomplete (#51 c18).
  await db().execute(
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )`,
  );
  await db().execute(
    `CREATE TABLE IF NOT EXISTS trip_members (
      trip_id TEXT NOT NULL,
      member_email TEXT NOT NULL,
      added_by_email TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (trip_id, member_email)
    )`,
  );
  await db().execute(
    `CREATE INDEX IF NOT EXISTS idx_trip_members_email ON trip_members (member_email)`,
  );
  // Invite token is the credential (#51 c2): whoever holds the link can claim
  // it. PK is (trip_id, invite_token); token is globally unique so a claim can
  // be resolved from the token alone.
  await db().execute(
    `CREATE TABLE IF NOT EXISTS trip_invites (
      trip_id TEXT NOT NULL,
      invite_token TEXT NOT NULL,
      invited_email TEXT,
      invited_by_email TEXT NOT NULL,
      invited_at INTEGER NOT NULL,
      PRIMARY KEY (trip_id, invite_token)
    )`,
  );
  await db().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_invites_token ON trip_invites (invite_token)`,
  );
  // Votes keyed to the candidate ON THIS TRIP (trip_activity_id), not the
  // catalog activity (#51 c7). Neutral = no row; value is -1 or 1.
  await db().execute(
    `CREATE TABLE IF NOT EXISTS trip_votes (
      trip_id TEXT NOT NULL,
      member_email TEXT NOT NULL,
      trip_activity_id TEXT NOT NULL,
      value INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (trip_id, member_email, trip_activity_id)
    )`,
  );
  await db().execute(
    `CREATE INDEX IF NOT EXISTS idx_trip_votes_trip ON trip_votes (trip_id)`,
  );

  await backfillOwnersAndMembers();

  initialized = true;
}

const BACKFILL_KEY = 'members_backfill_v1';

// One-time migration from v0's "auto-shared with all owners" to the explicit
// member model: seed a `users` row per owner and make every owner (plus each
// trip's creator) a member of every existing trip, so Jess + Tarun keep access
// to trips that predate the member model. Guarded by a `meta` sentinel so it
// runs once per database, not once per cold start.
async function backfillOwnersAndMembers(): Promise<void> {
  const sentinel = await db().execute({
    sql: 'SELECT value FROM meta WHERE key = ?',
    args: [BACKFILL_KEY],
  });
  if (sentinel.rows.length > 0) return;

  const owners = [...getOwnerEmails()];
  const now = Date.now();
  for (const email of owners) {
    await db().execute({
      sql: `INSERT INTO users (email, display_name, created_at, role)
            VALUES (?, NULL, ?, 'owner')
            ON CONFLICT(email) DO UPDATE SET role = 'owner'`,
      args: [email, now],
    });
  }

  const trips = await db().execute('SELECT id, creator_email, created_at FROM trips');
  for (const row of trips.rows) {
    const tripId = asString(row.id);
    const creator = asString(row.creator_email);
    const addedAt = asNumber(row.created_at);
    const memberEmails = new Set<string>([
      creator.trim().toLowerCase(),
      ...owners,
    ]);
    for (const email of memberEmails) {
      await db().execute({
        sql: `INSERT OR IGNORE INTO trip_members
                (trip_id, member_email, added_by_email, added_at)
              VALUES (?, ?, ?, ?)`,
        args: [tripId, email, creator, addedAt],
      });
    }
  }

  await db().execute({
    sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    args: [BACKFILL_KEY, '1'],
  });
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

function asTripStatus(value: unknown): TripStatus {
  const s = asString(value);
  return s === 'past' || s === 'voting' ? s : 'planning';
}

export function rowToTrip(row: Row): TripRow {
  return {
    id: asString(row.id),
    creator_email: asString(row.creator_email),
    title: asString(row.title),
    description: asOptionalString(row.description),
    start_date: asString(row.start_date),
    end_date: asString(row.end_date),
    cover_image_url: asOptionalString(row.cover_image_url),
    status: asTripStatus(row.status),
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

export async function getTripMembers(
  tripId: string,
  creatorEmail: string,
): Promise<TripMember[]> {
  const rs = await db().execute({
    sql: `SELECT m.member_email, m.added_by_email, m.added_at, u.display_name
          FROM trip_members m
          LEFT JOIN users u ON u.email = m.member_email
          WHERE m.trip_id = ?
          ORDER BY m.added_at ASC`,
    args: [tripId],
  });
  return rs.rows.map((r) => {
    const email = asString(r.member_email);
    return {
      email,
      display_name: asOptionalString(r.display_name),
      added_by_email: asString(r.added_by_email),
      added_at: asNumber(r.added_at),
      is_creator: email === creatorEmail,
    };
  });
}

export async function getTripInvites(tripId: string): Promise<TripInvite[]> {
  const rs = await db().execute({
    sql: `SELECT invite_token, invited_email, invited_by_email, invited_at
          FROM trip_invites
          WHERE trip_id = ?
          ORDER BY invited_at ASC`,
    args: [tripId],
  });
  return rs.rows.map((r) => ({
    invite_token: asString(r.invite_token),
    invited_email: asOptionalString(r.invited_email),
    invited_by_email: asString(r.invited_by_email),
    invited_at: asNumber(r.invited_at),
  }));
}

export async function isTripMember(
  tripId: string,
  email: string,
): Promise<boolean> {
  const rs = await db().execute({
    sql: 'SELECT 1 FROM trip_members WHERE trip_id = ? AND member_email = ?',
    args: [tripId, email],
  });
  return rs.rows.length > 0;
}

export async function addTripMember(
  tripId: string,
  email: string,
  addedByEmail: string,
): Promise<void> {
  await db().execute({
    sql: `INSERT OR IGNORE INTO trip_members
            (trip_id, member_email, added_by_email, added_at)
          VALUES (?, ?, ?, ?)`,
    args: [tripId, email, addedByEmail, Date.now()],
  });
}

// Gate for any trip-scoped action available to members. Non-members get a 404
// (existence hidden, #51 privacy), anon gets 401. Returns the caller context
// or null after writing the response.
export async function requireMember(
  req: VercelRequest,
  res: VercelResponse,
  tripId: string,
): Promise<MemberContext | null> {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const trip = await getTripRow(tripId);
  const member = await isTripMember(tripId, user.email);
  if (!trip || !member) {
    // Hide existence from non-members: 404, not 403.
    res.status(404).json({ error: 'not found' });
    return null;
  }
  return {
    email: user.email,
    role: user.role,
    isCreator: trip.creator_email === user.email,
  };
}

// Gate for creator-only actions (delete, mark past, voting↔planning
// transitions, removing other members). A member who isn't the creator gets
// 403 — they can see the trip, so existence isn't hidden.
export async function requireCreator(
  req: VercelRequest,
  res: VercelResponse,
  tripId: string,
): Promise<MemberContext | null> {
  const ctx = await requireMember(req, res, tripId);
  if (!ctx) return null;
  if (!ctx.isCreator) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return ctx;
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { InStatement } from '@libsql/client';
import { db } from './_db.js';
import {
  getCurrentUser,
  getOwnerEmails,
  type CurrentUser,
  type UserRole,
} from './_auth.js';
import { badInput, conflict, forbidden, notFound } from './_gqlError.js';

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

// One member's vote on one candidate. Neutral = no row. value is -1 or 1.
export type TripVote = {
  trip_activity_id: string;
  member_email: string;
  value: -1 | 1;
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
  votes: TripVote[];
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

// The catalog `a` (activities) and `c` (completed) tables used to be created by
// per-handler `ensureSchema()` calls in api/activities.ts + api/completed.ts.
// With the single GraphQL function those handlers are gone, so the table
// creation lives here and graphql.ts seeds all three groups at startup. Without
// this, activities/completed/saveActivity/setCompleted/transitionTrip(to=past)
// would fail on a fresh Preview DB.
let activitiesInitialized = false;
export async function ensureActivitiesSchema(): Promise<void> {
  if (activitiesInitialized) return;
  await db().execute(
    'CREATE TABLE IF NOT EXISTS a (id TEXT PRIMARY KEY, j TEXT NOT NULL, t INTEGER NOT NULL)',
  );
  activitiesInitialized = true;
}

let completedInitialized = false;
export async function ensureCompletedSchema(): Promise<void> {
  if (completedInitialized) return;
  await db().execute(
    'CREATE TABLE IF NOT EXISTS c (id TEXT PRIMARY KEY, v INTEGER NOT NULL)',
  );
  completedInitialized = true;
}

// Single entry point for graphql.ts startup: create every table group the API
// touches (trips/members/invites/votes + activities + completed).
export async function ensureAllSchemas(): Promise<void> {
  await ensureTripsSchema();
  await ensureActivitiesSchema();
  await ensureCompletedSchema();
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

export async function getTripVotes(tripId: string): Promise<TripVote[]> {
  const rs = await db().execute({
    sql: `SELECT trip_activity_id, member_email, value
          FROM trip_votes
          WHERE trip_id = ?`,
    args: [tripId],
  });
  return rs.rows.map((r) => ({
    trip_activity_id: asString(r.trip_activity_id),
    member_email: asString(r.member_email),
    // Stored as -1 or 1; neutral never has a row.
    value: asNumber(r.value) < 0 ? -1 : 1,
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

export async function removeTripMember(
  tripId: string,
  email: string,
): Promise<void> {
  await db().execute({
    sql: 'DELETE FROM trip_members WHERE trip_id = ? AND member_email = ?',
    args: [tripId, email],
  });
}

// Upsert any account's users row (used at invite-claim time, where a non-owner
// editor account is created for the first time). Role is owner if the email is
// in the allow-list, else editor — and never downgrades an existing owner.
export async function upsertUser(email: string): Promise<void> {
  const role: UserRole = getOwnerEmails().has(email) ? 'owner' : 'editor';
  await db().execute({
    sql: `INSERT INTO users (email, display_name, created_at, role)
          VALUES (?, NULL, ?, ?)
          ON CONFLICT(email) DO UPDATE SET role =
            CASE WHEN users.role = 'owner' THEN 'owner' ELSE excluded.role END`,
    args: [email, Date.now(), role],
  });
}

export type UserSummary = { email: string; display_name: string | null };

// All known accounts, for the invite picker. The autocomplete is intentionally
// global (#51 c4): anyone with a users row is suggestable to any inviter.
export async function getAllUsers(): Promise<UserSummary[]> {
  const rs = await db().execute(
    'SELECT email, display_name FROM users ORDER BY email ASC',
  );
  return rs.rows.map((r) => ({
    email: asString(r.email),
    display_name: asOptionalString(r.display_name),
  }));
}

// Create a pending invite with a fresh token (the credential, #51 c2). The
// invited_email is informational only — used to label the picker. Returns the
// new invite row.
export async function createInvite(
  tripId: string,
  invitedEmail: string,
  invitedByEmail: string,
): Promise<TripInvite> {
  const invite_token = newId();
  const invited_at = Date.now();
  await db().execute({
    sql: `INSERT INTO trip_invites
            (trip_id, invite_token, invited_email, invited_by_email, invited_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [tripId, invite_token, invitedEmail, invitedByEmail, invited_at],
  });
  return {
    invite_token,
    invited_email: invitedEmail,
    invited_by_email: invitedByEmail,
    invited_at,
  };
}

export type InviteRow = TripInvite & { trip_id: string };

export async function getInviteByToken(
  token: string,
): Promise<InviteRow | null> {
  const rs = await db().execute({
    sql: `SELECT trip_id, invite_token, invited_email, invited_by_email, invited_at
          FROM trip_invites WHERE invite_token = ?`,
    args: [token],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    trip_id: asString(row.trip_id),
    invite_token: asString(row.invite_token),
    invited_email: asOptionalString(row.invited_email),
    invited_by_email: asString(row.invited_by_email),
    invited_at: asNumber(row.invited_at),
  };
}

export async function deleteInviteByToken(
  tripId: string,
  token: string,
): Promise<void> {
  await db().execute({
    sql: 'DELETE FROM trip_invites WHERE trip_id = ? AND invite_token = ?',
    args: [tripId, token],
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

// ===========================================================================
// Res-free business logic (issue #91). Lifted out of the deleted REST handlers
// so the GraphQL resolvers can reuse it. These NEVER touch a `res`: they return
// domain objects (snake_case; the resolver layer maps to camelCase) or THROW a
// `GraphQLError` from `_gqlError`. The REST status codes map to error
// categories (400→BAD_USER_INPUT, 401→UNAUTHENTICATED, 403→FORBIDDEN,
// 404→NOT_FOUND, 409→CONFLICT) and the REST `code` field becomes `appCode`.
// ===========================================================================

// Loose on purpose (#51 c17) — Clerk is the real validator at sign-in.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimmedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t.length > max) return null;
  return t;
}

// Inclusive day count between start_date and end_date (server-side mirror of
// the client `dayCount` helper). Used to bound slot day_index and to slide
// out-of-range slots back to Unscheduled after a date edit.
function tripDateRangeDayCount(start_date: string, end_date: string): number {
  const start = Date.parse(`${start_date}T00:00:00Z`);
  const end = Date.parse(`${end_date}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.round((end - start) / 86_400_000) + 1;
}

// Full trip detail (header + activities/members/invites/votes). Returns null
// when the trip row is missing.
export async function getTripDetail(tripId: string): Promise<Trip | null> {
  const trip = await getTripRow(tripId);
  if (!trip) return null;
  const [activities, members, invites, votes] = await Promise.all([
    getTripActivities(tripId),
    getTripMembers(tripId, trip.creator_email),
    getTripInvites(tripId),
    getTripVotes(tripId),
  ]);
  return { ...trip, activities, members, invites, votes };
}

// Member-scoped trip list (#51): only trips the caller belongs to, sorted
// active-first by start_date, then past by marked_past_at desc.
export async function listTrips(callerEmail: string): Promise<TripListItem[]> {
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

export type CreateTripArgs = {
  title: unknown;
  // startDate/endDate arrive as already-validated 'YYYY-MM-DD' strings (the
  // resolver converts the graphql Date scalar's Date object back to a string).
  startDate: string | null;
  endDate: string | null;
  description?: string | null;
  coverImageUrl?: string | null;
  initialActivityIds?: readonly string[] | null;
  status?: TripStatus | null;
};

export async function createTrip(
  args: CreateTripArgs,
  creatorEmail: string,
): Promise<Trip> {
  const title = trimmedString(args.title, 200);
  if (!title) throw badInput('missing or invalid title');

  const start_date = args.startDate;
  const end_date = args.endDate;
  if (!isIsoDate(start_date) || !isIsoDate(end_date)) {
    throw badInput('startDate and endDate must be ISO dates (YYYY-MM-DD)');
  }
  if (end_date < start_date) {
    throw badInput('endDate must be on or after startDate');
  }

  const description =
    args.description == null ? null : trimmedString(args.description, 2000);
  if (args.description != null && description === null) {
    throw badInput('invalid description');
  }

  const cover_image_url =
    args.coverImageUrl == null ? null : trimmedString(args.coverImageUrl, 2000);
  if (args.coverImageUrl != null && cover_image_url === null) {
    throw badInput('invalid coverImageUrl');
  }

  const MAX_INITIAL_ACTIVITIES = 50;
  if (
    Array.isArray(args.initialActivityIds) &&
    args.initialActivityIds.length > MAX_INITIAL_ACTIVITIES
  ) {
    throw badInput(`too many initialActivityIds (max ${MAX_INITIAL_ACTIVITIES})`);
  }

  // Initial status (#51 c3): a trip can open in `voting` or skip straight to
  // `planning`. Anything else (incl. `past`) defaults to `planning`.
  const status: TripStatus = args.status === 'voting' ? 'voting' : 'planning';

  const id = newId();
  const created_at = Date.now();
  await db().execute({
    sql: `INSERT INTO trips (
            id, creator_email, title, description,
            start_date, end_date, cover_image_url,
            status, created_at, marked_past_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    args: [
      id,
      creatorEmail,
      title,
      description,
      start_date,
      end_date,
      cover_image_url,
      status,
      created_at,
    ],
  });

  await addTripMember(id, creatorEmail, creatorEmail);

  if (Array.isArray(args.initialActivityIds)) {
    const seen = new Set<string>();
    for (const raw of args.initialActivityIds) {
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
  if (!trip) throw new Error('failed to load created trip');
  return trip;
}

export type PatchTripArgs = {
  title?: unknown;
  description?: unknown;
  // present-or-absent; the resolver converts the Date scalar back to a string.
  startDate?: string | null;
  endDate?: string | null;
  coverImageUrl?: unknown;
};

export async function patchTrip(
  tripId: string,
  patch: PatchTripArgs,
): Promise<TripRow> {
  const existing = await getTripRow(tripId);
  if (!existing) throw notFound('not found');
  const isPast = existing.status === 'past';

  const sets: string[] = [];
  const updateArgs: (string | null)[] = [];
  const proposed = {
    title: existing.title,
    description: existing.description,
    start_date: existing.start_date,
    end_date: existing.end_date,
    cover_image_url: existing.cover_image_url,
  };

  if (patch.title !== undefined) {
    if (isPast) throw conflict('trip is past', 'trip_past');
    const title = trimmedString(patch.title, 200);
    if (!title) throw badInput('invalid title');
    proposed.title = title;
    sets.push('title = ?');
    updateArgs.push(title);
  }
  if (patch.description !== undefined) {
    const description =
      patch.description === null ? null : trimmedString(patch.description, 2000);
    if (patch.description !== null && description === null) {
      throw badInput('invalid description');
    }
    proposed.description = description;
    sets.push('description = ?');
    updateArgs.push(description);
  }
  if (patch.startDate !== undefined) {
    if (isPast) throw conflict('trip is past', 'trip_past');
    if (!isIsoDate(patch.startDate)) throw badInput('invalid startDate');
    proposed.start_date = patch.startDate;
    sets.push('start_date = ?');
    updateArgs.push(patch.startDate);
  }
  if (patch.endDate !== undefined) {
    if (isPast) throw conflict('trip is past', 'trip_past');
    if (!isIsoDate(patch.endDate)) throw badInput('invalid endDate');
    proposed.end_date = patch.endDate;
    sets.push('end_date = ?');
    updateArgs.push(patch.endDate);
  }
  if (patch.coverImageUrl !== undefined) {
    const cover =
      patch.coverImageUrl === null
        ? null
        : trimmedString(patch.coverImageUrl, 2000);
    if (patch.coverImageUrl !== null && cover === null) {
      throw badInput('invalid coverImageUrl');
    }
    proposed.cover_image_url = cover;
    sets.push('cover_image_url = ?');
    updateArgs.push(cover);
  }

  if (sets.length === 0) return existing;

  if (proposed.end_date < proposed.start_date) {
    throw badInput('endDate must be on or after startDate');
  }

  await db().execute({
    sql: `UPDATE trips SET ${sets.join(', ')} WHERE id = ?`,
    args: [...updateArgs, tripId],
  });

  // If the date range changed, slide any now-out-of-range slot back to
  // Unscheduled so it still renders somewhere.
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
  if (!updated) throw notFound('not found');
  return updated;
}

// Creator-only; the guard guarantees the trip exists, so this never 404s.
// Single transaction so a trip never half-deletes (#51 c9).
export async function deleteTripById(tripId: string): Promise<void> {
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
}

// Single trip_activities row by id (used by assignSlot/setDisplayOrder/remove).
export async function getTripActivityRow(
  taId: string,
): Promise<TripActivity | null> {
  const rs = await db().execute({
    sql: 'SELECT * FROM trip_activities WHERE id = ?',
    args: [taId],
  });
  const row = rs.rows[0];
  return row ? rowToTripActivity(row) : null;
}

// Add a catalog activity as a candidate on a trip. `trip` is the already-loaded
// (and membership-verified) row.
export async function addCandidate(
  trip: TripRow,
  activityId: string,
  adderEmail: string,
): Promise<TripActivity> {
  if (trip.status === 'past') throw conflict('trip is past', 'trip_past');
  const existing = await db().execute({
    sql: 'SELECT id FROM trip_activities WHERE trip_id = ? AND activity_id = ?',
    args: [trip.id, activityId],
  });
  if (existing.rows.length > 0) {
    throw conflict('activity already on trip', 'duplicate');
  }
  const snapshotJson = await fetchActivitySnapshot(activityId);
  if (!snapshotJson) throw notFound('activity not found');
  const id = newId();
  const added_at = Date.now();
  await db().execute({
    sql: `INSERT INTO trip_activities (
            id, trip_id, activity_id, snapshot_json,
            added_by_email, added_at, day_index, start_time, display_order
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0)`,
    args: [id, trip.id, activityId, snapshotJson, adderEmail, added_at],
  });
  const created = await getTripActivityRow(id);
  if (!created) throw new Error('failed to load created candidate');
  return created;
}

// Slot/display-order patch (assignSlot + setDisplayOrder both route here). A
// field left `undefined` is absent; `null` is an explicit clear. The
// voting-phase lock fires ONLY when dayIndex/startTime are present, so a
// displayOrder-only patch (drag-reorder of candidate cards) stays allowed
// during voting (#51 c8).
export type SlotPatch = {
  dayIndex?: number | null;
  startTime?: string | null;
  displayOrder?: number | null;
};

export async function patchTripActivity(
  ta: TripActivity,
  trip: TripRow,
  patch: SlotPatch,
): Promise<TripActivity> {
  if (trip.status === 'past') throw conflict('trip is past', 'trip_past');

  const dayProvided = patch.dayIndex !== undefined;
  const timeProvided = patch.startTime !== undefined;
  if (trip.status === 'voting' && (dayProvided || timeProvided)) {
    throw conflict(
      'voting in progress — finalize to start scheduling',
      'voting_locked',
    );
  }

  let day_index = ta.day_index;
  let start_time = ta.start_time;
  if (dayProvided || timeProvided) {
    const nextDay = dayProvided ? patch.dayIndex : day_index;
    const nextTime = timeProvided ? patch.startTime : start_time;
    const dayCount = tripDateRangeDayCount(trip.start_date, trip.end_date);
    if (nextDay === null && nextTime === null) {
      day_index = null;
      start_time = null;
    } else if (
      typeof nextDay === 'number' &&
      Number.isInteger(nextDay) &&
      nextDay >= 0 &&
      nextDay < dayCount &&
      isHHMM(nextTime)
    ) {
      day_index = nextDay;
      start_time = nextTime;
    } else {
      throw badInput(
        `dayIndex and startTime must be set together (both null, or dayIndex in 0..${dayCount - 1} and startTime HH:MM)`,
      );
    }
  }

  let display_order = ta.display_order;
  if (patch.displayOrder !== undefined) {
    if (typeof patch.displayOrder !== 'number' || !Number.isInteger(patch.displayOrder)) {
      throw badInput('displayOrder must be an integer');
    }
    display_order = patch.displayOrder;
  }

  await db().execute({
    sql: `UPDATE trip_activities
          SET day_index = ?, start_time = ?, display_order = ?
          WHERE id = ?`,
    args: [day_index, start_time, display_order, ta.id],
  });
  const updated = await getTripActivityRow(ta.id);
  if (!updated) throw new Error('failed to load updated candidate');
  return updated;
}

// Remove a candidate. Only the member who added it, or the trip creator, may
// remove it (#51). Cascade: drop the row and any votes on it in one tx.
export async function removeCandidate(
  ta: TripActivity,
  trip: TripRow,
  ctx: MemberContext,
): Promise<void> {
  if (trip.status === 'past') throw conflict('trip is past', 'trip_past');
  if (ta.added_by_email !== ctx.email && !ctx.isCreator) {
    throw forbidden('forbidden', 'not_adder');
  }
  await db().batch(
    [
      { sql: 'DELETE FROM trip_votes WHERE trip_activity_id = ?', args: [ta.id] },
      { sql: 'DELETE FROM trip_activities WHERE id = ?', args: [ta.id] },
    ],
    'write',
  );
}

// Cast or clear a vote. value 0 deletes the row (neutral) and returns null;
// ±1 upserts and returns the row. Open only while the trip is in `voting`.
export async function castVote(
  trip: TripRow,
  taId: string,
  value: -1 | 0 | 1,
  memberEmail: string,
): Promise<TripVote | null> {
  if (trip.status !== 'voting') {
    throw conflict('voting is closed', 'not_voting');
  }
  const ta = await db().execute({
    sql: 'SELECT id FROM trip_activities WHERE id = ? AND trip_id = ?',
    args: [taId, trip.id],
  });
  if (ta.rows.length === 0) {
    throw notFound('candidate not found on this trip');
  }
  if (value === 0) {
    await db().execute({
      sql: `DELETE FROM trip_votes
            WHERE trip_id = ? AND member_email = ? AND trip_activity_id = ?`,
      args: [trip.id, memberEmail, taId],
    });
    return null;
  }
  await db().execute({
    sql: `INSERT INTO trip_votes
            (trip_id, member_email, trip_activity_id, value, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(trip_id, member_email, trip_activity_id)
          DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [trip.id, memberEmail, taId, value, Date.now()],
  });
  return { trip_activity_id: taId, member_email: memberEmail, value };
}

// Finalize voting → planning: cull unselected candidates + their votes,
// normalize display_order on survivors, flip status. One tx (#51 c9).
export async function transitionToPlanning(
  trip: TripRow,
  rawKept: readonly unknown[],
): Promise<{ kept: number }> {
  if (trip.status !== 'voting') {
    throw conflict('trip is not in voting', 'not_voting');
  }
  const activities = await getTripActivities(trip.id);
  const onTrip = new Set(activities.map((a) => a.id));
  const keptOrdered: string[] = [];
  const keptSet = new Set<string>();
  for (const raw of rawKept) {
    if (typeof raw === 'string' && onTrip.has(raw) && !keptSet.has(raw)) {
      keptSet.add(raw);
      keptOrdered.push(raw);
    }
  }
  const toDelete = activities.filter((a) => !keptSet.has(a.id));

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
  return { kept: keptOrdered.length };
}

// Reopen voting from planning: clear slot fields, normalize display_order,
// PRESERVE votes. `past` is terminal (409 not_planning).
export async function transitionToVoting(trip: TripRow): Promise<void> {
  if (trip.status !== 'planning') {
    throw conflict(
      trip.status === 'past'
        ? 'past trips cannot reopen voting'
        : 'trip is already in voting',
      'not_planning',
    );
  }
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
}

export type MarkPastResult = {
  markedPastAt: number;
  completedActivityIds: string[];
  uncompletedActivityIds: string[];
};

// Mark a trip past: write through completion to the `c` table and freeze it.
export async function transitionToPast(
  trip: TripRow,
  rawCompletedIds: readonly unknown[],
): Promise<MarkPastResult> {
  if (trip.status === 'past') {
    throw conflict('trip is already past');
  }
  const rawIds = rawCompletedIds.filter((v): v is string => typeof v === 'string');

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
  const toUnmark = Array.from(eligibleIds).filter((aid) => !checkedSet.has(aid));

  // Freeze the trip AND write through every completion flag in one atomic
  // write batch. Doing these as separate sequential executes let a mid-loop
  // failure leave the trip terminally 'past' with partial completion state and
  // no way to remediate (a retry hits the 409 guard above). Mirrors the other
  // transitions (transitionToPlanning/transitionToVoting) — one db().batch.
  const marked_past_at = Date.now();
  const stmts: InStatement[] = [
    {
      sql: `UPDATE trips SET status = 'past', marked_past_at = ? WHERE id = ?`,
      args: [marked_past_at, trip.id],
    },
  ];
  for (const aid of toMark) {
    stmts.push({
      sql: `INSERT INTO c (id, v) VALUES (?, 1)
            ON CONFLICT(id) DO UPDATE SET v = excluded.v`,
      args: [aid],
    });
  }
  for (const aid of toUnmark) {
    stmts.push({
      sql: `INSERT INTO c (id, v) VALUES (?, 0)
            ON CONFLICT(id) DO UPDATE SET v = excluded.v`,
      args: [aid],
    });
  }
  await db().batch(stmts, 'write');
  return {
    markedPastAt: marked_past_at,
    completedActivityIds: toMark,
    uncompletedActivityIds: toUnmark,
  };
}

// Invite by email — any member. invited_email is informational (labels the
// picker); the token is the credential (#51 c2). Returns the new invite.
export async function inviteMember(
  tripId: string,
  rawEmail: string,
  inviterEmail: string,
): Promise<TripInvite> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) throw badInput('invalid email');
  if (await isTripMember(tripId, email)) {
    throw conflict('already a member', 'already_member');
  }
  return createInvite(tripId, email, inviterEmail);
}

// Remove a member — the creator removes anyone; a member removes themselves
// ("Leave trip"). The creator can't leave (delete the trip instead). Returns
// the removed email. ctx.isCreator ⟺ caller is the trip creator.
export async function removeMember(
  tripId: string,
  rawEmail: string,
  ctx: MemberContext,
): Promise<string> {
  const email = (rawEmail ?? '').trim().toLowerCase();
  if (!email) throw badInput('missing email');
  const isSelf = email === ctx.email;
  if (!isSelf && !ctx.isCreator) throw forbidden('forbidden');
  if (isSelf && ctx.isCreator) {
    throw conflict(
      'the creator cannot leave; delete the trip instead',
      'creator_cannot_leave',
    );
  }
  await removeTripMember(tripId, email);
  return email;
}

// Revoke a pending invite — any member. Idempotent. Returns the token.
export async function revokeInvite(
  tripId: string,
  token: string,
): Promise<string> {
  await deleteInviteByToken(tripId, token);
  return token;
}

// Claim an invite (token IS the credential, c2 — any authed account). Creates
// the claimer's account row (an editor account is born here), adds them, and
// consumes the invite. Returns the trip id, or null when the token/trip is
// gone (both map to null on the client).
export async function claimInvite(
  token: string,
  user: CurrentUser,
): Promise<string | null> {
  const invite = await getInviteByToken(token);
  if (!invite) return null;
  const trip = await getTripRow(invite.trip_id);
  if (!trip) return null;
  // Already a member? Consume the dangling invite and succeed idempotently.
  if (await isTripMember(invite.trip_id, user.email)) {
    await deleteInviteByToken(invite.trip_id, token);
    return invite.trip_id;
  }
  await upsertUser(user.email);
  await addTripMember(invite.trip_id, user.email, invite.invited_by_email);
  await deleteInviteByToken(invite.trip_id, token);
  return invite.trip_id;
}

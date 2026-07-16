import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { TripRow } from './_trips.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that trigger module eval
// ---------------------------------------------------------------------------

const { verifyToken, getUser } = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getUser: vi.fn(),
}));

const { execute, batch } = vi.hoisted(() => ({
  execute: vi.fn(),
  batch: vi.fn(),
}));

vi.mock('@clerk/backend', () => ({
  verifyToken,
  createClerkClient: () => ({ users: { getUser } }),
}));

vi.mock('./_db.js', () => ({ db: () => ({ execute, batch }) }));

// ---------------------------------------------------------------------------
// Environment — set before the module is imported so the module-level Set sees
// the right values (mirrors the pattern in _auth.test.ts)
// ---------------------------------------------------------------------------
process.env.CLERK_SECRET_KEY = 'sk_test_dummy';
process.env.OWNER_EMAILS = 'owner@example.com,owner2@example.com';

const { requireMember, requireCreator, transitionToPast } = await import(
  './_trips.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeReq(auth?: string): VercelRequest {
  return {
    headers: auth ? { authorization: auth } : {},
  } as unknown as VercelRequest;
}

type CapturingRes = VercelResponse & {
  statusCode: number;
  body: unknown;
};

function fakeRes(): CapturingRes {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as CapturingRes;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-abc-123';
const CREATOR_EMAIL = 'owner@example.com';
const EDITOR_EMAIL = 'editor@example.com';

const tripRow: TripRow = {
  id: TRIP_ID,
  creator_email: CREATOR_EMAIL,
  title: 'Test Trip',
  description: null,
  start_date: '2025-07-01',
  end_date: '2025-07-10',
  cover_image_url: null,
  status: 'planning',
  created_at: 1700000000000,
  marked_past_at: null,
};

// ---------------------------------------------------------------------------
// execute() call ordering inside requireMember:
//   - For an OWNER caller, getCurrentUser upserts a users row first, so the
//     order is: [users upsert, getTripRow, isTripMember].
//   - For a NON-OWNER caller, getCurrentUser does not write (#51 c4), so the
//     order is just: [getTripRow, isTripMember].
// ---------------------------------------------------------------------------

describe('requireMember', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
    execute.mockReset();
  });

  it('returns 401 and null for an anonymous caller', async () => {
    const res = fakeRes();
    const result = await requireMember(fakeReq(), res, TRIP_ID);
    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    // No db calls — getCurrentUser short-circuits before the upsert
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns context with isCreator:true when the creator calls their own trip', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_owner' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_owner',
      emailAddresses: [{ id: 'eid_owner', emailAddress: CREATOR_EMAIL }],
    });
    // call 1: upsert users
    execute.mockResolvedValueOnce({ rows: [] });
    // call 2: getTripRow
    execute.mockResolvedValueOnce({ rows: [tripRow] });
    // call 3: isTripMember → member
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] });

    const res = fakeRes();
    const result = await requireMember(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toEqual({
      email: CREATOR_EMAIL,
      role: 'owner',
      isCreator: true,
    });
    expect(res.statusCode).toBe(0); // no response written
  });

  it('returns context with isCreator:false when a non-creator member calls', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_editor' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_editor',
      emailAddresses: [{ id: 'eid_editor', emailAddress: EDITOR_EMAIL }],
    });
    // Non-owner: getCurrentUser does NOT upsert, so the first execute() is
    // getTripRow.
    // call 1: getTripRow
    execute.mockResolvedValueOnce({ rows: [tripRow] });
    // call 2: isTripMember → member
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] });

    const res = fakeRes();
    const result = await requireMember(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toEqual({
      email: EDITOR_EMAIL,
      role: 'editor',
      isCreator: false,
    });
    expect(res.statusCode).toBe(0);
  });

  it('returns 404 and null when the authenticated user is not a trip member', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_outsider' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_out',
      emailAddresses: [{ id: 'eid_out', emailAddress: 'outsider@example.com' }],
    });
    // Non-owner: no upsert. call 1: getTripRow → trip exists
    execute.mockResolvedValueOnce({ rows: [tripRow] });
    // call 2: isTripMember → not a member
    execute.mockResolvedValueOnce({ rows: [] });

    const res = fakeRes();
    const result = await requireMember(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });

  it('returns 404 and null when the trip does not exist', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_owner' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_owner',
      emailAddresses: [{ id: 'eid_owner', emailAddress: CREATOR_EMAIL }],
    });
    // call 1: upsert users
    execute.mockResolvedValueOnce({ rows: [] });
    // call 2: getTripRow → no trip
    execute.mockResolvedValueOnce({ rows: [] });
    // call 3: isTripMember (still runs even when trip is missing)
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] });

    const res = fakeRes();
    const result = await requireMember(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });
});

describe('requireCreator', () => {
  afterEach(() => {
    verifyToken.mockReset();
    getUser.mockReset();
    execute.mockReset();
  });

  it('returns 403 and null when the caller is a member but not the creator', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_editor' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_editor',
      emailAddresses: [{ id: 'eid_editor', emailAddress: EDITOR_EMAIL }],
    });
    // Non-owner: no upsert.
    execute.mockResolvedValueOnce({ rows: [tripRow] }); // getTripRow
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // isTripMember → member

    const res = fakeRes();
    const result = await requireCreator(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  it('returns context when the caller is the creator', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_owner' });
    getUser.mockResolvedValueOnce({
      primaryEmailAddressId: 'eid_owner',
      emailAddresses: [{ id: 'eid_owner', emailAddress: CREATOR_EMAIL }],
    });
    execute.mockResolvedValueOnce({ rows: [] }); // upsert users
    execute.mockResolvedValueOnce({ rows: [tripRow] }); // getTripRow
    execute.mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // isTripMember → member

    const res = fakeRes();
    const result = await requireCreator(fakeReq('Bearer tok'), res, TRIP_ID);

    expect(result).toEqual({
      email: CREATOR_EMAIL,
      role: 'owner',
      isCreator: true,
    });
    expect(res.statusCode).toBe(0);
  });

  it('returns 401 and null for an anonymous caller (propagated from requireMember)', async () => {
    const res = fakeRes();
    const result = await requireCreator(fakeReq(), res, TRIP_ID);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });
});

// ---------------------------------------------------------------------------
// transitionToPast — the status flip and every completion upsert must land in
// ONE atomic write batch, so a mid-write failure can never freeze the trip
// 'past' with partial completion state (the 409 guard would block any retry).
// ---------------------------------------------------------------------------

describe('transitionToPast', () => {
  afterEach(() => {
    execute.mockReset();
    batch.mockReset();
  });

  function activityRow(overrides: Record<string, unknown>) {
    return {
      trip_id: TRIP_ID,
      snapshot_json: '{}',
      added_by_email: EDITOR_EMAIL,
      added_at: 1,
      start_time: '09:00',
      display_order: 0,
      ...overrides,
    };
  }

  it('flips status and writes all completion upserts in a single batch', async () => {
    // getTripActivities SELECT: two eligible (scheduled, catalog-backed) rows.
    execute.mockResolvedValueOnce({
      rows: [
        activityRow({ id: 'ta-1', activity_id: 'act-1', day_index: 0 }),
        activityRow({ id: 'ta-2', activity_id: 'act-2', day_index: 1 }),
      ],
    });

    const result = await transitionToPast(tripRow, ['act-1']);

    // toMark = ['act-1'] (checked), toUnmark = ['act-2'] (eligible, unchecked)
    expect(result.completedActivityIds).toEqual(['act-1']);
    expect(result.uncompletedActivityIds).toEqual(['act-2']);
    expect(typeof result.markedPastAt).toBe('number');

    // The only execute() is the read; every write goes through one batch.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledTimes(1);

    type Stmt = { sql: string; args: unknown[] };
    const [stmts, mode] = batch.mock.calls[0] as [Stmt[], string];
    expect(mode).toBe('write');
    expect(stmts).toHaveLength(3); // status UPDATE + 1 mark + 1 unmark

    const statusStmt = stmts.find((s) =>
      /UPDATE trips SET status = 'past'/.test(s.sql),
    );
    expect(statusStmt).toBeDefined();
    expect(statusStmt?.args).toEqual([result.markedPastAt, TRIP_ID]);

    const markStmt = stmts.find(
      (s) => /VALUES \(\?, 1\)/.test(s.sql) && s.args[0] === 'act-1',
    );
    expect(markStmt).toBeDefined();

    const unmarkStmt = stmts.find(
      (s) => /VALUES \(\?, 0\)/.test(s.sql) && s.args[0] === 'act-2',
    );
    expect(unmarkStmt).toBeDefined();
  });

  it('rejects an already-past trip (409 CONFLICT) before touching the db', async () => {
    const pastTrip: TripRow = { ...tripRow, status: 'past' };
    await expect(transitionToPast(pastTrip, [])).rejects.toMatchObject({
      extensions: { code: 'CONFLICT' },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });
});
